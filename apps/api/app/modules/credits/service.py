from __future__ import annotations

from datetime import UTC, datetime, time, timedelta
from zoneinfo import ZoneInfo

from sqlalchemy import case, func, select
from sqlalchemy.orm import Session

from ...models import BatchRecord
from ...platform.clock import as_utc
from ...platform.http.errors import ApiError
from ..auth.models import UserRecord
from .models import CreditGrantRecord, CreditSpendRecord

INDIA_TIME = ZoneInfo("Asia/Kolkata")
EARLY_ACCESS_PLAN = "Early access"


def allowance_window(now: datetime | None = None) -> tuple[datetime, datetime]:
    """Return the current Asia/Kolkata calendar-day window in UTC."""
    instant = as_utc(now or datetime.now(UTC))
    local_day = instant.astimezone(INDIA_TIME).date()
    local_start = datetime.combine(local_day, time.min, tzinfo=INDIA_TIME)
    return local_start.astimezone(UTC), (local_start + timedelta(days=1)).astimezone(UTC)


def used_credits(session: Session, *, user_id: str, now: datetime | None = None) -> int:
    start, end = allowance_window(now)
    value = session.scalar(
        select(func.coalesce(func.sum(BatchRecord.labels_ready), 0)).where(
            BatchRecord.user_id == user_id,
            BatchRecord.status == "saved",
            BatchRecord.completed_at >= start,
            BatchRecord.completed_at < end,
        )
    )
    return int(value or 0)


def available_credits(
    session: Session, *, user_id: str, daily_limit: int, now: datetime | None = None
) -> int:
    instant = as_utc(now or datetime.now(UTC))
    daily_used = max(
        0,
        used_credits(session, user_id=user_id, now=instant)
        - bonus_spent_today(session, user_id=user_id, now=instant),
    )
    return max(0, daily_limit - daily_used) + bonus_balance(session, user_id=user_id, now=instant)


def bonus_balance(session: Session, *, user_id: str, now: datetime | None = None) -> int:
    instant = as_utc(now or datetime.now(UTC))
    value = session.scalar(
        select(func.coalesce(func.sum(CreditGrantRecord.remaining), 0)).where(
            CreditGrantRecord.user_id == user_id,
            CreditGrantRecord.expires_at > instant,
            CreditGrantRecord.remaining > 0,
        )
    )
    return int(value or 0)


def bonus_spent_today(session: Session, *, user_id: str, now: datetime | None = None) -> int:
    start, end = allowance_window(now)
    by_batch = (
        select(
            CreditSpendRecord.batch_id.label("batch_id"),
            func.sum(CreditSpendRecord.amount).label("spent"),
        )
        .where(
            CreditSpendRecord.user_id == user_id,
            CreditSpendRecord.consumed_at >= start,
            CreditSpendRecord.consumed_at < end,
            CreditSpendRecord.batch_id.is_not(None),
        )
        .group_by(CreditSpendRecord.batch_id)
        .subquery()
    )
    value = session.scalar(
        select(
            func.coalesce(
                func.sum(
                    case(
                        (by_batch.c.spent < BatchRecord.labels_ready, by_batch.c.spent),
                        else_=BatchRecord.labels_ready,
                    )
                ),
                0,
            )
        )
        .select_from(by_batch)
        .join(BatchRecord, BatchRecord.id == by_batch.c.batch_id)
        .where(
            BatchRecord.status == "saved",
        )
    )
    return int(value or 0)


def lock_account_for_credit_check(session: Session, *, user_id: str) -> None:
    """Serialize credit checks for one account inside the caller's transaction."""
    exists = session.scalar(select(UserRecord.id).where(UserRecord.id == user_id).with_for_update())
    if exists is None:
        raise ApiError(status_code=404, code="NOT_FOUND", message="Account not found.")


def assert_daily_allowance(
    session: Session,
    *,
    user_id: str,
    requested_labels: int,
    daily_limit: int,
    replaced_batch: BatchRecord | None = None,
    now: datetime | None = None,
) -> int:
    """Return bonus credits required, or reject an unaffordable save.

    The caller must hold the user-row lock and consume this amount in the same
    transaction as the batch write. Bonus credits never refresh at midnight.
    """
    instant = as_utc(now or datetime.now(UTC))
    start, end = allowance_window(instant)
    used = used_credits(session, user_id=user_id, now=instant)
    spent = bonus_spent_today(session, user_id=user_id, now=instant)
    same_day_replacement = (
        replaced_batch is not None
        and replaced_batch.completed_at is not None
        and start <= as_utc(replaced_batch.completed_at) < end
    )
    refundable = 0
    prior_spend = 0
    if same_day_replacement:
        used -= replaced_batch.labels_ready
        prior_spend = int(
            session.scalar(
                select(func.coalesce(func.sum(CreditSpendRecord.amount), 0)).where(
                    CreditSpendRecord.batch_id == replaced_batch.id,
                    CreditSpendRecord.consumed_at >= start,
                    CreditSpendRecord.consumed_at < end,
                )
            )
            or 0
        )
        refundable = int(
            session.scalar(
                select(func.coalesce(func.sum(CreditSpendRecord.amount), 0))
                .join(CreditGrantRecord, CreditGrantRecord.id == CreditSpendRecord.grant_id)
                .where(
                    CreditSpendRecord.batch_id == replaced_batch.id,
                    CreditSpendRecord.consumed_at >= start,
                    CreditSpendRecord.consumed_at < end,
                    CreditGrantRecord.expires_at > instant,
                )
            )
            or 0
        )
        spent -= min(prior_spend, replaced_batch.labels_ready)

    base_used = max(0, used - spent)
    bonus_needed = max(0, base_used + requested_labels - daily_limit)
    # An expired grant cannot be refunded into a spendable balance. Preserve
    # its already-spent allocation when editing this same day's batch.
    locked_expired = prior_spend - refundable if same_day_replacement else 0
    new_bonus_needed = max(0, bonus_needed - locked_expired)
    available_bonus = bonus_balance(session, user_id=user_id, now=instant) + refundable
    if new_bonus_needed <= available_bonus:
        return new_bonus_needed

    _, resets_at = allowance_window(instant)
    retry_after = max(1, int((resets_at - instant).total_seconds()))
    raise ApiError(
        status_code=429,
        code="DAILY_CREDIT_LIMIT_REACHED",
        message=(
            f"This batch needs {requested_labels} credits, but only "
            f"{max(0, daily_limit - base_used) + available_bonus + locked_expired} remain today."
        ),
        headers={"Retry-After": str(retry_after)},
    )


def spend_bonus_for_batch(
    session: Session,
    *,
    user_id: str,
    batch_id: str,
    amount: int,
    now: datetime,
    replace_same_day: bool = False,
) -> None:
    """Atomically reallocate a batch's bonus spend, earliest expiry first."""
    if replace_same_day:
        start, end = allowance_window(now)
        previous = list(
            session.scalars(
                select(CreditSpendRecord).where(
                    CreditSpendRecord.batch_id == batch_id,
                    CreditSpendRecord.consumed_at >= start,
                    CreditSpendRecord.consumed_at < end,
                )
            )
        )
        for spend in previous:
            grant = session.get(CreditGrantRecord, spend.grant_id)
            if grant is None or as_utc(grant.expires_at) <= now:
                continue
            grant.remaining += spend.amount
            session.delete(spend)
        session.flush()

    remaining = amount
    for grant in session.scalars(
        select(CreditGrantRecord)
        .where(
            CreditGrantRecord.user_id == user_id,
            CreditGrantRecord.expires_at > now,
            CreditGrantRecord.remaining > 0,
        )
        .order_by(CreditGrantRecord.expires_at, CreditGrantRecord.created_at, CreditGrantRecord.id)
    ):
        take = min(remaining, grant.remaining)
        if not take:
            continue
        grant.remaining -= take
        session.add(
            CreditSpendRecord(
                grant_id=grant.id,
                user_id=user_id,
                batch_id=batch_id,
                amount=take,
                consumed_at=now,
            )
        )
        remaining -= take
        if remaining == 0:
            break
    if remaining:
        raise ApiError(
            status_code=409,
            code="CREDIT_BALANCE_CHANGED",
            message="Credits changed while saving. Please try again.",
        )
