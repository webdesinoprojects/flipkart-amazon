"""Durable billing inbox and provider reconciliation; only trusted backend workers run this."""

from __future__ import annotations

import logging
from datetime import UTC, datetime, timedelta

from sqlalchemy import and_, delete, or_, select
from sqlalchemy.orm import Session, sessionmaker

from ...platform.clock import as_utc
from ...platform.http.errors import ApiError
from .gateway import RazorpayGateway
from .models import BillingChargeRecord, BillingSubscriptionRecord, BillingWebhookEventRecord
from .service import accept_charge, revoke_fully_refunded_charge

logger = logging.getLogger("app.billing")
RETRY_FOR = timedelta(hours=24)


def _finish(event: BillingWebhookEventRecord, status: str, error: str | None = None) -> None:
    event.status = status
    event.last_error = error
    event.processed_at = datetime.now(UTC) if status in {"done", "ignored", "rejected"} else None
    event.next_attempt_at = None


def _retry(event: BillingWebhookEventRecord, error: str) -> None:
    event.attempts += 1
    if event.attempts == 1:
        logger.warning(
            "billing_event_retry",
            extra={"event_id": event.event_id, "reason": error},
        )
    if as_utc(event.received_at) + RETRY_FOR <= datetime.now(UTC):
        _finish(event, "rejected", error)
        logger.error("billing_event_rejected", extra={"event_id": event.event_id, "reason": error})
        return
    event.status = "retry"
    event.last_error = error
    event.next_attempt_at = datetime.now(UTC) + timedelta(
        seconds=min(3600, 30 * 2 ** min(event.attempts, 7))
    )


def process_one_event(
    session_factory: sessionmaker[Session], gateway: RazorpayGateway, event_id: str
) -> str:
    """Claim an event, then fetch remote evidence without holding a row lock."""
    with session_factory() as session:
        event = session.scalar(
            select(BillingWebhookEventRecord)
            .where(BillingWebhookEventRecord.event_id == event_id)
            .with_for_update(skip_locked=True)
        )
        if (
            event is None
            or event.status not in {"pending", "retry", "processing"}
            or (
                event.next_attempt_at is not None
                and as_utc(event.next_attempt_at) > datetime.now(UTC)
            )
        ):
            return "skipped"
        event.status = "processing"
        event.next_attempt_at = datetime.now(UTC) + timedelta(minutes=10)
        event_type = event.event_type
        subscription_id = event.subscription_provider_id
        payment_id = event.payment_id
        period_start = event.period_start
        period_end = event.period_end
        known = bool(
            subscription_id
            and session.scalar(
                select(BillingSubscriptionRecord.id).where(
                    BillingSubscriptionRecord.provider_id == subscription_id
                )
            )
        )
        session.commit()

    if event_type.startswith("subscription.") and not known:
        with session_factory() as session:
            event = session.get(BillingWebhookEventRecord, event_id, with_for_update=True)
            if event and event.status == "processing":
                _retry(event, "UNKNOWN_SUBSCRIPTION")
                session.commit()
        return "retry"

    try:
        remote_sub = gateway.get_subscription(subscription_id) if subscription_id else None
        remote_payment = gateway.get_payment(payment_id) if payment_id else None
        invoice = None
        if event_type in {"subscription.charged", "refund.processed"} and remote_payment:
            invoice_id = remote_payment.get("invoice_id")
            if isinstance(invoice_id, str) and invoice_id.startswith("inv_"):
                invoice = gateway.get_invoice(invoice_id)
    except ApiError as error:
        with session_factory() as session:
            event = session.get(BillingWebhookEventRecord, event_id, with_for_update=True)
            if event and event.status == "processing":
                _retry(event, error.code)
                session.commit()
        return "retry"

    with session_factory() as session:
        event = session.get(BillingWebhookEventRecord, event_id, with_for_update=True)
        if event is None or event.status != "processing":
            return "skipped"
        try:
            if event_type == "refund.processed":
                if not remote_payment or not payment_id:
                    raise ValueError("INVALID_PAYMENT")
                if invoice is None:
                    local_charge = session.scalar(
                        select(BillingChargeRecord.id).where(
                            BillingChargeRecord.provider_payment_id == payment_id
                        )
                    )
                    if local_charge is None:
                        _finish(event, "ignored", "NON_SUBSCRIPTION_REFUND")
                        session.commit()
                        return "ignored"
                    raise ValueError("REFUND_INVOICE_UNVERIFIED")
                if invoice.get("payment_id") != payment_id:
                    raise ValueError("REFUND_INVOICE_UNVERIFIED")
                invoice_subscription_id = invoice.get("subscription_id")
                local_invoice_subscription = session.scalar(
                    select(BillingSubscriptionRecord.id).where(
                        BillingSubscriptionRecord.provider_id == invoice_subscription_id
                    )
                )
                if local_invoice_subscription is None:
                    _finish(event, "ignored", "NON_SELLERLABEL_REFUND")
                    session.commit()
                    return "ignored"
                local_charge = session.scalar(
                    select(BillingChargeRecord).where(
                        BillingChargeRecord.provider_payment_id == payment_id
                    )
                )
                if local_charge is not None and (
                    type(remote_payment.get("amount_refunded")) is int
                    and 0 < remote_payment["amount_refunded"] < local_charge.amount_paise
                ):
                    _finish(event, "ignored", "PARTIAL_REFUND_MANUAL_REVIEW")
                    logger.warning(
                        "billing_partial_refund_manual_review",
                        extra={"event_id": event_id, "payment_id": payment_id},
                    )
                    session.commit()
                    return "ignored"
                if not revoke_fully_refunded_charge(session, payment_id, remote_payment):
                    raise ValueError("REFUND_NOT_CONFIRMED")
            elif subscription_id:
                row = session.scalar(
                    select(BillingSubscriptionRecord)
                    .where(BillingSubscriptionRecord.provider_id == subscription_id)
                    .with_for_update()
                )
                if row is None:
                    raise ValueError("UNKNOWN_SUBSCRIPTION")
                if (
                    not remote_sub
                    or remote_sub.get("id") != row.provider_id
                    or remote_sub.get("plan_id") != row.provider_plan_id
                ):
                    raise ValueError("SUBSCRIPTION_MISMATCH")
                if event_type == "subscription.charged":
                    if not remote_payment or not invoice:
                        raise ValueError("MISSING_INVOICE")
                    accept_charge(
                        session, row, remote_sub, remote_payment, invoice, period_start, period_end
                    )
                elif event_type in {
                    "subscription.authenticated",
                    "subscription.pending",
                    "subscription.activated",
                    "subscription.resumed",
                    "subscription.cancelled",
                    "subscription.completed",
                    "subscription.halted",
                    "subscription.paused",
                }:
                    row.status = str(remote_sub.get("status", row.status))[:32]
                    if row.status in {"cancelled", "completed"}:
                        row.cancel_at_cycle_end = True
            _finish(
                event,
                "done"
                if event_type in {"subscription.charged", "refund.processed"} or subscription_id
                else "ignored",
            )
            session.commit()
            return event.status
        except (ApiError, ValueError) as error:
            session.rollback()
            event = session.get(BillingWebhookEventRecord, event_id, with_for_update=True)
            if event and event.status == "processing":
                _retry(event, error.code if isinstance(error, ApiError) else str(error))
                session.commit()
            return "retry"


def process_due_events(
    session_factory: sessionmaker[Session], gateway: RazorpayGateway, *, limit: int = 50
) -> dict[str, int]:
    now = datetime.now(UTC)
    with session_factory() as session:
        event_ids = list(
            session.scalars(
                select(BillingWebhookEventRecord.event_id)
                .where(
                    BillingWebhookEventRecord.status.in_({"pending", "retry", "processing"}),
                    or_(
                        BillingWebhookEventRecord.next_attempt_at.is_(None),
                        BillingWebhookEventRecord.next_attempt_at <= now,
                    ),
                )
                .order_by(BillingWebhookEventRecord.received_at)
                .limit(limit)
            )
        )
    result = {"done": 0, "retry": 0, "ignored": 0, "skipped": 0}
    for event_id in event_ids:
        try:
            result[process_one_event(session_factory, gateway, event_id)] += 1
        except Exception as error:  # noqa: BLE001 - one poison event must not stall the inbox
            logger.exception(
                "billing_event_worker_failed",
                extra={"event_id": event_id, "error_type": type(error).__name__},
            )
            with session_factory() as session:
                event = session.get(BillingWebhookEventRecord, event_id, with_for_update=True)
                if event and event.status == "processing":
                    _retry(event, "PROCESSING_FAILURE")
                    session.commit()
            result["retry"] += 1
    return result


def reconcile_one_subscription(
    session_factory: sessionmaker[Session], gateway: RazorpayGateway, provider_id: str
) -> dict[str, int]:
    """Backfill signed-webhook gaps from Razorpay's subscription invoices.

    Invoice membership, period, paid status and payment capture are all fetched
    afresh. Unique payment IDs make repeat reconciliation harmless.
    """
    with session_factory() as session:
        row = session.scalar(
            select(BillingSubscriptionRecord).where(
                BillingSubscriptionRecord.provider_id == provider_id
            )
        )
        if row is None:
            raise ValueError("Unknown local subscription")
    remote_sub = gateway.get_subscription(provider_id)
    if remote_sub.get("id") != provider_id or remote_sub.get("plan_id") != row.provider_plan_id:
        raise ValueError("Razorpay subscription does not match local plan")
    report = {"checked": 0, "recovered": 0, "refunded": 0, "flagged": 0}
    for skip in range(0, 1000, 100):
        page = gateway.get_invoices(provider_id, skip=skip)
        items = page.get("items")
        if not isinstance(items, list):
            raise ValueError("Razorpay invoice listing was incomplete")
        for invoice in items:
            if not isinstance(invoice, dict) or invoice.get("status") != "paid":
                continue
            payment_id = invoice.get("payment_id")
            if not isinstance(payment_id, str) or not payment_id.startswith("pay_"):
                report["flagged"] += 1
                continue
            report["checked"] += 1
            remote_payment = gateway.get_payment(payment_id)
            with session_factory() as session:
                current = session.scalar(
                    select(BillingSubscriptionRecord)
                    .where(BillingSubscriptionRecord.provider_id == provider_id)
                    .with_for_update()
                )
                if current is None:
                    raise ValueError("Local subscription was removed during reconciliation")
                existing = session.scalar(
                    select(BillingChargeRecord).where(
                        BillingChargeRecord.provider_payment_id == payment_id
                    )
                )
                if existing is None:
                    try:
                        accept_charge(
                            session,
                            current,
                            remote_sub,
                            remote_payment,
                            invoice,
                            invoice.get("billing_start"),
                            invoice.get("billing_end"),
                        )
                    except ApiError:
                        report["flagged"] += 1
                        logger.error(
                            "billing_reconciliation_unverified",
                            extra={"subscription_id": provider_id, "payment_id": payment_id},
                        )
                        continue
                    report["recovered"] += 1
                elif existing.subscription_id != current.id:
                    report["flagged"] += 1
                    logger.error(
                        "billing_payment_subscription_mismatch",
                        extra={"subscription_id": provider_id, "payment_id": payment_id},
                    )
                elif existing.refunded_at is None and remote_payment.get("status") == "refunded":
                    if revoke_fully_refunded_charge(session, payment_id, remote_payment):
                        report["refunded"] += 1
                session.commit()
        if len(items) < 100:
            break
    else:
        raise ValueError("Razorpay invoice pagination exceeded the safety bound")
    with session_factory() as session:
        current = session.scalar(
            select(BillingSubscriptionRecord)
            .where(BillingSubscriptionRecord.provider_id == provider_id)
            .with_for_update()
        )
        if current is None:
            raise ValueError("Local subscription was removed during reconciliation")
        current.status = str(remote_sub.get("status", current.status))[:32]
        if current.status in {"cancelled", "completed"}:
            current.cancel_at_cycle_end = True
        now = datetime.now(UTC)
        current.last_reconciled_at = now
        if current.status in {"cancelled", "completed", "expired"} and (
            current.paid_through is None or as_utc(current.paid_through) <= now
        ):
            current.next_reconcile_at = None
        else:
            current.next_reconcile_at = now + timedelta(hours=1)
        session.commit()
    return report


def reconcile_due_subscriptions(
    session_factory: sessionmaker[Session], gateway: RazorpayGateway, *, limit: int = 25
) -> dict[str, int]:
    with session_factory() as session:
        rows = list(
            session.scalars(
                select(BillingSubscriptionRecord)
                .where(
                    or_(
                        and_(
                            BillingSubscriptionRecord.next_reconcile_at.is_(None),
                            BillingSubscriptionRecord.last_reconciled_at.is_(None),
                        ),
                        BillingSubscriptionRecord.next_reconcile_at <= datetime.now(UTC),
                    )
                )
                .order_by(
                    BillingSubscriptionRecord.next_reconcile_at,
                    BillingSubscriptionRecord.created_at,
                )
                .limit(limit)
                .with_for_update(skip_locked=True)
            )
        )
        ids = [row.provider_id for row in rows]
        for row in rows:
            row.next_reconcile_at = datetime.now(UTC) + timedelta(minutes=15)
        session.commit()
    report = {"checked": 0, "recovered": 0, "refunded": 0, "flagged": 0}
    for provider_id in ids:
        try:
            one = reconcile_one_subscription(session_factory, gateway, provider_id)
            for key, value in one.items():
                report[key] += value
        except (ApiError, ValueError) as error:
            logger.error(
                "billing_reconciliation_failed",
                extra={"subscription_id": provider_id, "error_type": type(error).__name__},
            )
            with session_factory() as session:
                row = session.scalar(
                    select(BillingSubscriptionRecord)
                    .where(BillingSubscriptionRecord.provider_id == provider_id)
                    .with_for_update()
                )
                if row:
                    row.next_reconcile_at = datetime.now(UTC) + timedelta(minutes=15)
                    session.commit()
    return report


def prune_processed_events(session_factory: sessionmaker[Session]) -> int:
    """Bound the webhook inbox; charge/payment unique keys outlive event rows."""
    cutoff = datetime.now(UTC) - timedelta(days=90)
    with session_factory() as session:
        result = session.execute(
            delete(BillingWebhookEventRecord).where(
                BillingWebhookEventRecord.status.in_({"done", "ignored", "rejected"}),
                BillingWebhookEventRecord.processed_at < cutoff,
            )
        )
        session.commit()
        return result.rowcount or 0
