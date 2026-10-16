from __future__ import annotations

from datetime import UTC, datetime, timedelta
from urllib.parse import urlsplit

from sqlalchemy import select
from sqlalchemy.orm import Session

from ...config import Settings
from ...platform.clock import as_utc
from ...platform.http.errors import ApiError
from ..credits.service import lock_account_for_credit_check
from .catalog import PLANS, provider_plan_id
from .gateway import RazorpayGateway
from .models import BillingChargeRecord, BillingSubscriptionRecord


def _rows(session: Session, user_id: str) -> list[BillingSubscriptionRecord]:
    return list(
        session.scalars(
            select(BillingSubscriptionRecord)
            .where(BillingSubscriptionRecord.user_id == user_id)
            .order_by(BillingSubscriptionRecord.created_at.desc())
        )
    )


def active_subscription(
    session: Session, user_id: str, now: datetime | None = None
) -> BillingSubscriptionRecord | None:
    instant = as_utc(now or datetime.now(UTC))
    for row in _rows(session, user_id):
        if row.paid_through and as_utc(row.paid_through) > instant:
            return row
    return None


def active_paid_subscriptions(
    session: Session, user_id: str, now: datetime | None = None
) -> list[BillingSubscriptionRecord]:
    instant = as_utc(now or datetime.now(UTC))
    return [
        row
        for row in _rows(session, user_id)
        if row.paid_through and as_utc(row.paid_through) > instant
    ]


def _plan_rank(code: str) -> int:
    return tuple(PLANS).index(code)


def plan_allowance(session: Session, user_id: str, settings: Settings) -> tuple[str, int]:
    rows = active_paid_subscriptions(session, user_id)
    if rows:
        plans = [
            PLANS[row.plan_code]
            for row in sorted(rows, key=lambda row: _plan_rank(row.plan_code), reverse=True)
        ]
        return " + ".join(plan.name for plan in plans), sum(plan.daily_credits for plan in plans)
    return "Early access", settings.early_access_daily_credits


def public_status(session: Session, user_id: str, settings: Settings) -> dict:
    paid = active_paid_subscriptions(session, user_id)
    paid.sort(key=lambda row: _plan_rank(row.plan_code), reverse=True)
    current = paid[0] if paid else None
    previous_plan_renewal_pending = bool(
        current and any(not row.cancel_at_cycle_end for row in paid[1:])
    )
    paid_ids = {row.id for row in paid}
    pending = next(
        (
            row
            for row in _rows(session, user_id)
            if row.status in {"created", "authenticated", "pending", "active", "halted", "paused"}
            and row.id not in paid_ids
            and not row.cancel_at_cycle_end
        ),
        None,
    )
    return {
        "available": settings.billing_configured,
        "activePlan": PLANS[current.plan_code].name if current else "Early access",
        "activePlans": [
            {
                "name": PLANS[row.plan_code].name,
                "dailyCredits": PLANS[row.plan_code].daily_credits,
                "paidThrough": row.paid_through.isoformat(),
            }
            for row in paid
        ],
        "currentStatus": current.status if current else None,
        "dailyCredits": sum(PLANS[row.plan_code].daily_credits for row in paid)
        if current
        else settings.early_access_daily_credits,
        "paidThrough": current.paid_through.isoformat() if current else None,
        "renews": bool(current and not current.cancel_at_cycle_end and current.status == "active"),
        "pendingPlan": PLANS[pending.plan_code].name if pending else None,
        "pendingStatus": pending.status if pending else None,
        "pendingCheckoutUrl": pending.checkout_url
        if pending and pending.status == "created"
        else None,
        "canCancelCheckout": bool(pending and pending.status == "created"),
        "canCancelRenewal": bool(
            not previous_plan_renewal_pending
            and (not pending or not current)
            and (
                (
                    current
                    and not current.cancel_at_cycle_end
                    and current.status in {"active", "pending", "halted", "paused"}
                )
                or (pending and pending.status in {"active", "pending", "halted", "paused"})
            )
        ),
        "previousPlanRenewalPending": previous_plan_renewal_pending,
    }


def _safe_checkout_url(value: object) -> str:
    if not isinstance(value, str):
        raise ApiError(
            status_code=503,
            code="BILLING_PROVIDER_UNAVAILABLE",
            message="Checkout is unavailable right now.",
        )
    parsed = urlsplit(value)
    if parsed.scheme != "https" or parsed.netloc != "rzp.io":
        raise ApiError(
            status_code=503,
            code="BILLING_PROVIDER_UNAVAILABLE",
            message="Checkout is unavailable right now.",
        )
    return value


def start_checkout(
    session: Session, settings: Settings, gateway: RazorpayGateway, user_id: str, code: str
) -> str:
    if not settings.billing_configured:
        raise ApiError(
            status_code=503, code="BILLING_NOT_READY", message="Paid plans are not open yet."
        )
    plan = PLANS[code]
    provider_id = provider_plan_id(settings, code)
    remote_plan = gateway.get_plan(provider_id)
    item = remote_plan.get("item") or {}
    if (
        not isinstance(item, dict)
        or remote_plan.get("id") != provider_id
        or remote_plan.get("period") != "monthly"
        or remote_plan.get("interval") != 1
        or item.get("amount") != plan.amount_paise
        or item.get("currency") != "INR"
    ):
        raise ApiError(
            status_code=503,
            code="BILLING_PLAN_MISMATCH",
            message="This plan is temporarily unavailable.",
        )
    prior_rows = [(row.id, row.provider_id, row.status) for row in _rows(session, user_id)]
    session.rollback()  # Release the connection before provider network calls.
    remote_rows = {
        row_id: gateway.get_subscription(remote_id)
        for row_id, remote_id, status in prior_rows
        if status in {"created", "authenticated", "pending", "active", "halted", "paused"}
    }
    lock_account_for_credit_check(session, user_id=user_id)
    rows = _rows(session, user_id)
    paid = [
        row for row in rows if row.paid_through and as_utc(row.paid_through) > datetime.now(UTC)
    ]
    if paid and (
        _plan_rank(code) <= max(_plan_rank(row.plan_code) for row in paid)
        or any(row.status not in {"active", "cancelled"} for row in paid)
    ):
        raise ApiError(
            status_code=409,
            code="PLAN_ALREADY_ACTIVE",
            message="Choose a higher tier than your current paid plan to add capacity.",
        )
    if paid and any(
        not row.cancel_at_cycle_end
        and as_utc(row.paid_through) - datetime.now(UTC) < timedelta(hours=24)
        for row in paid
    ):
        raise ApiError(
            status_code=409,
            code="UPGRADE_TOO_CLOSE_TO_RENEWAL",
            message="A plan is close to renewal. Contact support before upgrading.",
        )
    for row in rows:
        if row.status in {"created", "authenticated", "pending", "active", "halted", "paused"}:
            remote = remote_rows.get(row.id)
            if remote is None:
                # A concurrent checkout committed while provider reads were in
                # flight; retry rather than creating a second subscription.
                raise ApiError(
                    status_code=409,
                    code="CHECKOUT_ALREADY_OPEN",
                    message="A checkout is already open. Refresh this page.",
                )
            if remote.get("id") != row.provider_id or remote.get("plan_id") != row.provider_plan_id:
                raise ApiError(
                    status_code=503,
                    code="BILLING_PROVIDER_UNAVAILABLE",
                    message="Subscription state could not be confirmed.",
                )
            if row in paid:
                if (
                    remote.get("status")
                    not in {"active", "pending", "halted", "paused", "cancelled", "completed"}
                    or type(remote.get("paid_count")) is not int
                    or remote["paid_count"] < 1
                ):
                    raise ApiError(
                        status_code=409,
                        code="UPGRADE_NEEDS_REVIEW",
                        message=(
                            "Your current payment state needs review. "
                            "Contact support before upgrading."
                        ),
                    )
                continue
            if remote.get("status") in {
                "created",
                "authenticated",
                "pending",
                "active",
                "halted",
                "paused",
            }:
                if remote.get("status") == "created" and row.plan_code == code and row.checkout_url:
                    return _safe_checkout_url(row.checkout_url)
                raise ApiError(
                    status_code=409,
                    code="CHECKOUT_ALREADY_OPEN",
                    message=(
                        "Finish or cancel your existing subscription before choosing another plan."
                    ),
                )
            row.status = str(remote.get("status", "unknown"))[:32]
    remote = gateway.create_subscription(provider_id, user_id)
    if (
        remote.get("plan_id") != provider_id
        or remote.get("quantity") != 1
        or remote.get("status") != "created"
    ):
        raise ApiError(
            status_code=503,
            code="BILLING_PROVIDER_UNAVAILABLE",
            message="Checkout is unavailable right now.",
        )
    remote_id = remote.get("id")
    if not isinstance(remote_id, str) or not remote_id.startswith("sub_"):
        raise ApiError(
            status_code=503,
            code="BILLING_PROVIDER_UNAVAILABLE",
            message="Checkout is unavailable right now.",
        )
    checkout_url = _safe_checkout_url(remote.get("short_url"))
    session.add(
        BillingSubscriptionRecord(
            user_id=user_id,
            plan_code=code,
            provider_id=remote_id,
            provider_plan_id=provider_id,
            status="created",
            checkout_url=checkout_url,
        )
    )
    session.commit()
    return checkout_url


def cancel_renewal(
    session: Session, settings: Settings, gateway: RazorpayGateway, user_id: str
) -> None:
    if not settings.razorpay_configured:
        raise ApiError(
            status_code=503, code="BILLING_NOT_READY", message="Billing is unavailable right now."
        )
    lock_account_for_credit_check(session, user_id=user_id)
    current = active_subscription(session, user_id)
    pending_checkout = next(
        (
            row
            for row in _rows(session, user_id)
            if row.status in {"created", "authenticated", "pending", "active", "halted", "paused"}
            and not row.paid_through
            and not row.cancel_at_cycle_end
        ),
        None,
    )
    target = pending_checkout or current
    if target is None:
        target = next(
            (
                row
                for row in _rows(session, user_id)
                if row.status
                in {"created", "authenticated", "pending", "active", "halted", "paused"}
                and not row.cancel_at_cycle_end
            ),
            None,
        )
        if target is None:
            raise ApiError(status_code=404, code="NO_PAID_PLAN", message="No subscription is open.")
    if target.cancel_at_cycle_end:
        return
    # The webhook for activation can arrive before the charge webhook. Never
    # infer "unpaid" from our local paid_through field.
    remote_before = gateway.get_subscription(target.provider_id)
    if (
        remote_before.get("id") != target.provider_id
        or remote_before.get("plan_id") != target.provider_plan_id
    ):
        raise ApiError(
            status_code=503,
            code="BILLING_PROVIDER_UNAVAILABLE",
            message="Cancellation could not be confirmed.",
        )
    remote_status = remote_before.get("status")
    paid_count = remote_before.get("paid_count")
    if remote_status == "created" and type(paid_count) is int and paid_count == 0:
        remote = gateway.cancel_now(target.provider_id)
        if remote.get("id") != target.provider_id or remote.get("status") != "cancelled":
            raise ApiError(
                status_code=503,
                code="BILLING_PROVIDER_UNAVAILABLE",
                message="Cancellation could not be confirmed.",
            )
        target.status = "cancelled"
        target.cancel_at_cycle_end = True
        session.commit()
        return
    if remote_status not in {"active", "pending", "halted", "paused"}:
        raise ApiError(
            status_code=409,
            code="CANCELLATION_NEEDS_REVIEW",
            message="We could not confirm this subscription's payment state. Contact support.",
        )
    remote = gateway.cancel_at_cycle_end(target.provider_id)
    if remote.get("id") != target.provider_id:
        raise ApiError(
            status_code=503,
            code="BILLING_PROVIDER_UNAVAILABLE",
            message="Cancellation could not be confirmed.",
        )
    target.cancel_at_cycle_end = True
    target.status = str(remote.get("status", target.status))[:32]
    session.commit()


def accept_charge(
    session: Session,
    subscription: BillingSubscriptionRecord,
    remote_subscription: dict,
    remote_payment: dict,
    invoice: dict,
    period_start_timestamp: object,
    period_end_timestamp: object,
) -> None:
    payment_id = remote_payment.get("id")
    if not isinstance(payment_id, str) or not payment_id.startswith("pay_"):
        raise ApiError(
            status_code=409,
            code="BILLING_CHARGE_UNVERIFIED",
            message="Charge could not be verified.",
        )
    existing = session.scalar(
        select(BillingChargeRecord).where(BillingChargeRecord.provider_payment_id == payment_id)
    )
    if existing:
        if existing.subscription_id != subscription.id:
            raise ApiError(
                status_code=409,
                code="BILLING_CHARGE_UNVERIFIED",
                message="Charge could not be verified.",
            )
        return
    plan = PLANS[subscription.plan_code]
    now_timestamp = int(datetime.now(UTC).timestamp())
    line_items = invoice.get("line_items")
    plan_line = line_items[0] if isinstance(line_items, list) and len(line_items) == 1 else None
    if (
        remote_subscription.get("id") != subscription.provider_id
        or remote_subscription.get("plan_id") != subscription.provider_plan_id
        or remote_subscription.get("quantity") != 1
        or remote_payment.get("id") != payment_id
        or remote_payment.get("status") != "captured"
        or remote_payment.get("captured") is not True
        or remote_payment.get("amount") != plan.amount_paise
        or remote_payment.get("currency") != "INR"
        or not isinstance(remote_payment.get("invoice_id"), str)
        or invoice.get("id") != remote_payment.get("invoice_id")
        or invoice.get("subscription_id") != subscription.provider_id
        or invoice.get("payment_id") != payment_id
        or invoice.get("status") != "paid"
        or invoice.get("type") != "invoice"
        or invoice.get("amount_paid") != plan.amount_paise
        or invoice.get("currency") != "INR"
        or not isinstance(plan_line, dict)
        or plan_line.get("type") != "plan"
        or plan_line.get("quantity") != 1
        or plan_line.get("amount") != plan.amount_paise
        or plan_line.get("currency") != "INR"
        or invoice.get("billing_start") != period_start_timestamp
        or invoice.get("billing_end") != period_end_timestamp
        or type(period_start_timestamp) is not int
        or type(period_end_timestamp) is not int
        or not (
            0 < period_start_timestamp <= now_timestamp + 3600
            and period_start_timestamp < period_end_timestamp < 4_102_444_800
        )
    ):
        raise ApiError(
            status_code=409,
            code="BILLING_CHARGE_UNVERIFIED",
            message="Charge could not be verified.",
        )
    period_end = datetime.fromtimestamp(period_end_timestamp, UTC)
    session.add(
        BillingChargeRecord(
            subscription_id=subscription.id,
            provider_payment_id=payment_id,
            amount_paise=plan.amount_paise,
            paid_at=datetime.now(UTC),
            period_end=period_end,
        )
    )
    if not subscription.paid_through or period_end > as_utc(subscription.paid_through):
        subscription.paid_through = period_end
    subscription.status = str(remote_subscription.get("status", "active"))[:32]


def revoke_fully_refunded_charge(session: Session, payment_id: str, remote: dict) -> bool:
    charge = session.scalar(
        select(BillingChargeRecord).where(BillingChargeRecord.provider_payment_id == payment_id)
    )
    if charge is None:
        return False  # A refund can arrive before its charge webhook.
    # Always lock subscription before charge, matching reconciliation and
    # charge processing; opposite lock orders can deadlock on Postgres.
    subscription = session.get(
        BillingSubscriptionRecord, charge.subscription_id, with_for_update=True
    )
    charge = session.scalar(
        select(BillingChargeRecord)
        .where(BillingChargeRecord.provider_payment_id == payment_id)
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    if charge.refunded_at is not None:
        return True
    if (
        remote.get("id") != payment_id
        or remote.get("status") != "refunded"
        or remote.get("amount_refunded") != charge.amount_paise
    ):
        return False  # Retry provider propagation; partial refunds remain an operator decision.
    charge.refunded_at = datetime.now(UTC)
    remaining = session.scalars(
        select(BillingChargeRecord).where(
            BillingChargeRecord.subscription_id == charge.subscription_id,
            BillingChargeRecord.refunded_at.is_(None),
            BillingChargeRecord.id != charge.id,
        )
    ).all()
    subscription.paid_through = max((row.period_end for row in remaining), default=None)
    return True
