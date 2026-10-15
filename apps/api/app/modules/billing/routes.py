from __future__ import annotations

import hashlib
import hmac
import json
import logging
from datetime import UTC, datetime
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, Request, Response
from pydantic import BaseModel, ConfigDict
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ...config import Settings
from ...database import get_session
from ...dependencies import settings_dependency
from ...modules.auth import rate_limits as limits
from ...modules.auth.cookies import no_store
from ...modules.auth.dependencies import (
    ContextDep,
    CurrentSessionDep,
    LimiterDep,
    ProtectedMutationDep,
)
from ...platform.http.errors import ApiError
from ...platform.rate_limit.limiter import RateLimitRule
from .gateway import RazorpayGateway, get_gateway
from .models import BillingSubscriptionRecord, BillingWebhookEventRecord
from .service import (
    cancel_renewal,
    public_status,
    start_checkout,
)

router = APIRouter(prefix="/api/v1/billing", tags=["billing"])
logger = logging.getLogger("app.billing")
SessionDep = Annotated[Session, Depends(get_session)]
SettingsDep = Annotated[Settings, Depends(settings_dependency)]


def gateway_dependency(settings: SettingsDep) -> RazorpayGateway:
    return get_gateway(settings)


GatewayDep = Annotated[RazorpayGateway, Depends(gateway_dependency)]


class CheckoutIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    plan: Literal["starter", "growth", "scale"]


@router.get("/subscription")
def subscription_status(
    response: Response, session: SessionDep, settings: SettingsDep, authenticated: CurrentSessionDep
) -> dict:
    no_store(response)
    return public_status(session, authenticated.user.id, settings)


@router.post("/subscriptions")
def create_checkout(
    body: CheckoutIn,
    session: SessionDep,
    settings: SettingsDep,
    gateway: GatewayDep,
    authenticated: ProtectedMutationDep,
    limiter: LimiterDep,
    context: ContextDep,
) -> dict:
    degraded = limits.enforce(
        limiter,
        [
            (RateLimitRule("billing_checkout_user", 6, 3600), authenticated.user.id),
            (RateLimitRule("billing_checkout_ip", 30, 3600), context.client_ip or ""),
        ],
    )
    if degraded:
        raise ApiError(
            status_code=503,
            code="BILLING_RATE_LIMIT_UNAVAILABLE",
            message="Billing is temporarily unavailable. Please try again shortly.",
        )
    if not authenticated.user.email_verified:
        raise ApiError(
            status_code=403,
            code="EMAIL_VERIFICATION_REQUIRED",
            message="Verify your email before starting a paid plan.",
        )
    return {
        "checkoutUrl": start_checkout(session, settings, gateway, authenticated.user.id, body.plan)
    }


@router.post("/subscription/cancel")
def cancel_subscription(
    session: SessionDep,
    settings: SettingsDep,
    gateway: GatewayDep,
    authenticated: ProtectedMutationDep,
    limiter: LimiterDep,
    context: ContextDep,
) -> dict:
    degraded = limits.enforce(
        limiter,
        [
            (RateLimitRule("billing_cancel_user", 6, 3600), authenticated.user.id),
            (RateLimitRule("billing_cancel_ip", 30, 3600), context.client_ip or ""),
        ],
    )
    if degraded:
        raise ApiError(
            status_code=503,
            code="BILLING_RATE_LIMIT_UNAVAILABLE",
            message="Billing is temporarily unavailable. Please try again shortly.",
        )
    cancel_renewal(session, settings, gateway, authenticated.user.id)
    return public_status(session, authenticated.user.id, settings)


@router.post("/webhook")
async def webhook(request: Request, session: SessionDep, settings: SettingsDep) -> dict:
    if not settings.razorpay_configured:
        raise ApiError(status_code=503, code="BILLING_NOT_READY", message="Billing is unavailable.")
    raw = await request.body()
    signature = request.headers.get("X-Razorpay-Signature", "")
    expected = hmac.new(settings.razorpay_webhook_secret.encode(), raw, hashlib.sha256).hexdigest()
    if not hmac.compare_digest(signature, expected):
        raise ApiError(
            status_code=401, code="INVALID_WEBHOOK_SIGNATURE", message="Invalid webhook signature."
        )
    # Razorpay signs the body, not the event-id header. Hash the signed bytes so
    # changing an unsigned header cannot bypass deduplication.
    event_id = hashlib.sha256(raw).hexdigest()
    if session.get(BillingWebhookEventRecord, event_id):
        return {"status": "duplicate"}
    try:
        body = json.loads(raw)
    except ValueError:
        body = {}
    event = body.get("event") if isinstance(body, dict) and body.get("entity") == "event" else None
    payload = body.get("payload") if isinstance(body, dict) else None
    payload = payload if isinstance(payload, dict) else {}
    sub_payload = payload.get("subscription")
    sub_entity = sub_payload.get("entity") if isinstance(sub_payload, dict) else None
    sub_entity = sub_entity if isinstance(sub_entity, dict) else {}
    payment_payload = payload.get("payment")
    payment_entity = payment_payload.get("entity") if isinstance(payment_payload, dict) else None
    payment_entity = payment_entity if isinstance(payment_entity, dict) else {}
    status = "pending"
    error = None
    sub_id = sub_entity.get("id")
    payment_id = payment_entity.get("id")
    if event == "refund.processed":
        refund_payload = payload.get("refund")
        refund = refund_payload.get("entity") if isinstance(refund_payload, dict) else None
        refund = refund if isinstance(refund, dict) else {}
        payment_id = refund.get("payment_id")
        if (
            refund.get("status") != "processed"
            or not isinstance(payment_id, str)
            or not payment_id.startswith("pay_")
            or payment_entity.get("id") != payment_id
        ):
            status, error = "rejected", "INVALID_REFUND"
    elif isinstance(event, str) and event.startswith("subscription."):
        if not isinstance(sub_id, str) or not sub_id.startswith("sub_"):
            status, error = "rejected", "INVALID_SUBSCRIPTION"
        else:
            notes = sub_entity.get("notes")
            claimed = isinstance(notes, dict) and bool(notes.get("sellerlabel_user_id"))
            if not claimed and not session.scalar(
                select(BillingSubscriptionRecord.id).where(
                    BillingSubscriptionRecord.provider_id == sub_id
                )
            ):
                status = "ignored"  # Another product on the same Razorpay account.
        if event == "subscription.charged":
            if not isinstance(payment_id, str) or not payment_id.startswith("pay_"):
                status, error = "rejected", "INVALID_PAYMENT"
    else:
        status = "ignored" if isinstance(event, str) else "rejected"
        error = None if isinstance(event, str) else "INVALID_EVENT"
    session.add(
        BillingWebhookEventRecord(
            event_id=event_id,
            event_type=event[:64] if isinstance(event, str) else "invalid",
            subscription_provider_id=sub_id
            if isinstance(sub_id, str) and sub_id.startswith("sub_")
            else None,
            payment_id=payment_id
            if isinstance(payment_id, str) and payment_id.startswith("pay_")
            else None,
            period_start=sub_entity.get("current_start")
            if type(sub_entity.get("current_start")) is int
            else None,
            period_end=sub_entity.get("current_end")
            if type(sub_entity.get("current_end")) is int
            else None,
            status=status,
            attempts=0,
            last_error=error,
            processed_at=datetime.now(UTC) if status in {"ignored", "rejected"} else None,
        )
    )
    try:
        session.commit()
    except IntegrityError:
        session.rollback()
        return {"status": "duplicate"}
    if status == "rejected":
        logger.error("billing_webhook_rejected", extra={"event_id": event_id, "reason": error})
    # Beat drains the committed inbox even when Valkey was unavailable during
    # this request; no provider network call can delay the webhook response.
    return {"status": "accepted" if status == "pending" else status}
