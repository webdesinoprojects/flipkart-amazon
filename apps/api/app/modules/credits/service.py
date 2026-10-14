from __future__ import annotations

from datetime import UTC, datetime, time, timedelta
from zoneinfo import ZoneInfo

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ...models import BatchRecord
from ...platform.clock import as_utc
from ...platform.http.errors import ApiError
from ..auth.models import UserRecord

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
    return max(0, daily_limit - used_credits(session, user_id=user_id, now=now))


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
) -> None:
    """Reject a save that would exceed the account's current daily allowance."""
    instant = as_utc(now or datetime.now(UTC))
    start, end = allowance_window(instant)
    used = used_credits(session, user_id=user_id, now=instant)
    if (
        replaced_batch is not None
        and replaced_batch.completed_at is not None
        and start <= as_utc(replaced_batch.completed_at) < end
    ):
        used = max(0, used - replaced_batch.labels_ready)

    if used + requested_labels <= daily_limit:
        return

    _, resets_at = allowance_window(instant)
    retry_after = max(1, int((resets_at - instant).total_seconds()))
    raise ApiError(
        status_code=429,
        code="DAILY_CREDIT_LIMIT_REACHED",
        message=(
            f"This batch needs {requested_labels} credits, but only "
            f"{max(0, daily_limit - used)} remain today."
        ),
        headers={"Retry-After": str(retry_after)},
    )
