"""Bounded, server-side read models for the operator control plane.

No Razorpay credentials or customer document contents are returned here.
Payment figures describe verified local charge records, not bank settlements.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from zoneinfo import ZoneInfo

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ...config import Settings
from ...models import BatchRecord
from ...platform.clock import as_utc
from ...platform.http.errors import ApiError
from ..audit.models import SecurityEventRecord
from ..auth.models import UserRecord
from ..billing.catalog import PLANS
from ..billing.models import (
    BillingChargeRecord,
    BillingSubscriptionRecord,
    BillingWebhookEventRecord,
)
from ..billing.service import plan_allowance
from ..credits.models import CreditGrantRecord
from ..credits.service import bonus_balance, used_credits

INDIA_TIME = ZoneInfo("Asia/Kolkata")


def _amount(value: int | None) -> int:
    return int(value or 0)


def _active_plan(rows: list[BillingSubscriptionRecord], now: datetime) -> str:
    active = [row for row in rows if row.paid_through and as_utc(row.paid_through) > now]
    if not active:
        return "Early access"
    active.sort(key=lambda row: tuple(PLANS).index(row.plan_code), reverse=True)
    return " + ".join(PLANS[row.plan_code].name for row in active)


def overview(session: Session) -> dict:
    now = datetime.now(UTC)
    today = now.astimezone(INDIA_TIME).date()
    start = datetime.combine(today - timedelta(days=13), datetime.min.time(), INDIA_TIME)
    start_utc = start.astimezone(UTC)
    total_users = _amount(
        session.scalar(select(func.count(UserRecord.id)).where(UserRecord.role == "user"))
    )
    paid_users = _amount(
        session.scalar(
            select(func.count(func.distinct(BillingSubscriptionRecord.user_id)))
            .join(UserRecord, UserRecord.id == BillingSubscriptionRecord.user_id)
            .where(
                UserRecord.role == "user",
                BillingSubscriptionRecord.paid_through > now,
            )
        )
    )
    gross_paise = _amount(session.scalar(select(func.sum(BillingChargeRecord.amount_paise))))
    refunded_paise = _amount(
        session.scalar(
            select(func.sum(BillingChargeRecord.amount_paise)).where(
                BillingChargeRecord.refunded_at.is_not(None)
            )
        )
    )
    daily = {
        (today - timedelta(days=offset)).isoformat(): {
            "date": (today - timedelta(days=offset)).isoformat(),
            "labels": 0,
            "batches": 0,
            "capturedPaise": 0,
            "refundsPaise": 0,
        }
        for offset in range(14)
    }
    for completed_at, labels in session.execute(
        select(BatchRecord.completed_at, BatchRecord.labels_ready).where(
            BatchRecord.status == "saved", BatchRecord.completed_at >= start_utc
        )
    ):
        if completed_at is None:
            continue
        bucket = daily.get(as_utc(completed_at).astimezone(INDIA_TIME).date().isoformat())
        if bucket is not None:
            bucket["labels"] += labels
            bucket["batches"] += 1
    for paid_at, refunded_at, amount in session.execute(
        select(
            BillingChargeRecord.paid_at,
            BillingChargeRecord.refunded_at,
            BillingChargeRecord.amount_paise,
        ).where(
            (BillingChargeRecord.paid_at >= start_utc)
            | (BillingChargeRecord.refunded_at >= start_utc)
        )
    ):
        paid_bucket = daily.get(as_utc(paid_at).astimezone(INDIA_TIME).date().isoformat())
        if paid_bucket is not None:
            paid_bucket["capturedPaise"] += amount
        if refunded_at is not None:
            refund_bucket = daily.get(as_utc(refunded_at).astimezone(INDIA_TIME).date().isoformat())
            if refund_bucket is not None:
                refund_bucket["refundsPaise"] += amount
    signups_7d = _amount(
        session.scalar(
            select(func.count(UserRecord.id)).where(
                UserRecord.role == "user", UserRecord.created_at >= now - timedelta(days=7)
            )
        )
    )
    unresolved_events = _amount(
        session.scalar(
            select(func.count(BillingWebhookEventRecord.event_id)).where(
                BillingWebhookEventRecord.status.in_(("pending", "processing", "retry", "rejected"))
            )
        )
    )
    return {
        "asOf": now.isoformat(),
        "customers": {"total": total_users, "paid": paid_users, "free": total_users - paid_users},
        "signups7d": signups_7d,
        "money": {
            "grossCapturedPaise": gross_paise,
            "fullyRefundedPaise": refunded_paise,
            "netAfterFullRefundsPaise": gross_paise - refunded_paise,
        },
        "labels14d": sum(day["labels"] for day in daily.values()),
        "billingItemsNeedingReview": unresolved_events,
        "daily": [daily[key] for key in sorted(daily)],
        "recentPayments": payment_rows(session, limit=5, offset=0)["items"],
    }


def user_rows(
    session: Session, settings: Settings, *, query: str | None, limit: int, offset: int
) -> dict:
    now = datetime.now(UTC)
    filters = [UserRecord.role == "user"]
    if query:
        escaped = query.strip().replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
        filters.append(UserRecord.email_canonical.ilike(f"%{escaped}%", escape="\\"))
    total = _amount(session.scalar(select(func.count(UserRecord.id)).where(*filters)))
    users = list(
        session.scalars(
            select(UserRecord)
            .where(*filters)
            .order_by(UserRecord.created_at.desc(), UserRecord.id.desc())
            .limit(limit)
            .offset(offset)
        )
    )
    if not users:
        return {"total": total, "items": [], "limit": limit, "offset": offset}
    ids = [user.id for user in users]
    subscriptions = list(
        session.scalars(
            select(BillingSubscriptionRecord).where(BillingSubscriptionRecord.user_id.in_(ids))
        )
    )
    by_user: dict[str, list[BillingSubscriptionRecord]] = {user_id: [] for user_id in ids}
    for row in subscriptions:
        by_user[row.user_id].append(row)
    items = []
    for user in users:
        _, daily_credits = plan_allowance(session, user.id, settings)
        used = used_credits(session, user_id=user.id, now=now)
        items.append(
            {
                "id": user.id,
                "email": user.email_display,
                "status": user.status,
                "emailVerified": user.email_verified,
                "plan": _active_plan(by_user[user.id], now),
                "dailyCredits": daily_credits,
                "usedToday": used,
                "bonusCredits": bonus_balance(session, user_id=user.id, now=now),
                "createdAt": user.created_at,
                "lastLoginAt": user.last_login_at,
            }
        )
    return {"total": total, "items": items, "limit": limit, "offset": offset}


def user_detail(session: Session, settings: Settings, user_id: str) -> dict:
    user = session.get(UserRecord, user_id)
    if user is None or user.role != "user":
        raise ApiError(status_code=404, code="NOT_FOUND", message="Customer not found.")
    subscriptions = list(
        session.scalars(
            select(BillingSubscriptionRecord)
            .where(BillingSubscriptionRecord.user_id == user_id)
            .order_by(BillingSubscriptionRecord.created_at.desc())
            .limit(30)
        )
    )
    _, daily_credits = plan_allowance(session, user_id, settings)
    used = used_credits(session, user_id=user_id)
    batches = _amount(
        session.scalar(
            select(func.count(BatchRecord.id)).where(
                BatchRecord.user_id == user_id, BatchRecord.status == "saved"
            )
        )
    )
    labels = _amount(
        session.scalar(
            select(func.sum(BatchRecord.labels_ready)).where(
                BatchRecord.user_id == user_id, BatchRecord.status == "saved"
            )
        )
    )
    payments = payment_rows(session, limit=20, offset=0, user_id=user_id)["items"]
    grants = list(
        session.scalars(
            select(CreditGrantRecord)
            .where(CreditGrantRecord.user_id == user_id)
            .order_by(CreditGrantRecord.created_at.desc(), CreditGrantRecord.id.desc())
            .limit(30)
        )
    )
    return {
        "id": user.id,
        "email": user.email_display,
        "status": user.status,
        "emailVerified": user.email_verified,
        "createdAt": user.created_at,
        "lastLoginAt": user.last_login_at,
        "plan": _active_plan(subscriptions, datetime.now(UTC)),
        "dailyCredits": daily_credits,
        "usedToday": used,
        "bonusCredits": bonus_balance(session, user_id=user_id),
        "savedBatches": batches,
        "totalLabels": labels,
        "subscriptions": [
            {
                "id": row.id,
                "providerId": row.provider_id,
                "plan": PLANS[row.plan_code].name,
                "status": row.status,
                "paidThrough": row.paid_through,
                "cancelAtCycleEnd": row.cancel_at_cycle_end,
                "createdAt": row.created_at,
            }
            for row in subscriptions
        ],
        "payments": payments,
        "creditGrants": [
            {
                "id": row.id,
                "amount": row.amount,
                "remaining": row.remaining,
                "reason": row.reason,
                "expiresAt": row.expires_at,
                "createdAt": row.created_at,
            }
            for row in grants
        ],
    }


def payment_rows(session: Session, *, limit: int, offset: int, user_id: str | None = None) -> dict:
    statement = (
        select(BillingChargeRecord, BillingSubscriptionRecord, UserRecord)
        .join(
            BillingSubscriptionRecord,
            BillingSubscriptionRecord.id == BillingChargeRecord.subscription_id,
        )
        .join(UserRecord, UserRecord.id == BillingSubscriptionRecord.user_id)
    )
    count_statement = select(func.count(BillingChargeRecord.id)).join(
        BillingSubscriptionRecord,
        BillingSubscriptionRecord.id == BillingChargeRecord.subscription_id,
    )
    if user_id:
        statement = statement.where(BillingSubscriptionRecord.user_id == user_id)
        count_statement = count_statement.where(BillingSubscriptionRecord.user_id == user_id)
    total = _amount(session.scalar(count_statement))
    rows = session.execute(
        statement.order_by(BillingChargeRecord.paid_at.desc(), BillingChargeRecord.id.desc())
        .limit(limit)
        .offset(offset)
    )
    return {
        "total": total,
        "limit": limit,
        "offset": offset,
        "items": [
            {
                "id": charge.id,
                "paymentId": charge.provider_payment_id,
                "subscriptionId": subscription.provider_id,
                "userId": user.id,
                "email": user.email_display,
                "plan": PLANS[subscription.plan_code].name,
                "amountPaise": charge.amount_paise,
                "paidAt": charge.paid_at,
                "periodEnd": charge.period_end,
                "refundedAt": charge.refunded_at,
            }
            for charge, subscription, user in rows
        ],
    }


def operations(session: Session) -> dict:
    now = datetime.now(UTC)
    statuses = dict(
        session.execute(
            select(
                BillingWebhookEventRecord.status, func.count(BillingWebhookEventRecord.event_id)
            ).group_by(BillingWebhookEventRecord.status)
        ).all()
    )
    oldest = session.scalar(
        select(func.min(BillingWebhookEventRecord.received_at)).where(
            BillingWebhookEventRecord.status.in_(("pending", "processing", "retry"))
        )
    )
    events = list(
        session.scalars(
            select(BillingWebhookEventRecord)
            .where(
                BillingWebhookEventRecord.status.in_(("pending", "processing", "retry", "rejected"))
            )
            .order_by(BillingWebhookEventRecord.received_at.desc())
            .limit(25)
        )
    )
    return {
        "asOf": now.isoformat(),
        "webhookCounts": {key: int(value) for key, value in statuses.items()},
        "oldestUnresolvedSeconds": (
            max(0, int((now - as_utc(oldest)).total_seconds())) if oldest else None
        ),
        "events": [
            {
                "id": row.event_id,
                "type": row.event_type,
                "status": row.status,
                "attempts": row.attempts,
                "lastError": row.last_error,
                "receivedAt": row.received_at,
            }
            for row in events
        ],
    }


def audit_rows(session: Session, *, limit: int, offset: int) -> dict:
    total = _amount(session.scalar(select(func.count(SecurityEventRecord.id))))
    rows = list(
        session.scalars(
            select(SecurityEventRecord)
            .order_by(SecurityEventRecord.created_at.desc(), SecurityEventRecord.id.desc())
            .limit(limit)
            .offset(offset)
        )
    )
    return {
        "total": total,
        "limit": limit,
        "offset": offset,
        "items": [
            {
                "id": row.id,
                "event": row.event,
                "outcome": row.outcome,
                "actorUserId": row.actor_user_id,
                "subjectUserId": row.subject_user_id,
                "requestId": row.request_id,
                "createdAt": row.created_at,
            }
            for row in rows
        ],
    }
