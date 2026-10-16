"""Issue audited one-time credits without touching provider billing state."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ...platform.clock import as_utc
from ...platform.http.errors import ApiError
from ..audit import service as audit
from ..auth.models import UserRecord
from ..credits.models import CreditGrantRecord
from ..credits.service import lock_account_for_credit_check
from .schemas import CreditGrantIn


def issue_credit_grant(
    session: Session,
    *,
    user_id: str,
    admin_user_id: str,
    body: CreditGrantIn,
    audit_request_id: str | None,
    device_summary: str | None,
) -> tuple[CreditGrantRecord, bool]:
    """Return the existing grant for a repeat request, never issue it twice."""
    now = datetime.now(UTC)
    if body.expiresAt.tzinfo is None or not (
        now + timedelta(hours=1) <= body.expiresAt <= now + timedelta(days=365)
    ):
        raise ApiError(
            status_code=422,
            code="INVALID_CREDIT_EXPIRY",
            message="Choose an expiry between one hour and one year from now.",
        )
    reason = body.reason.strip()
    if len(reason) < 8:
        raise ApiError(
            status_code=422,
            code="INVALID_CREDIT_REASON",
            message="Give a reason of at least 8 characters.",
        )
    lock_account_for_credit_check(session, user_id=user_id)
    customer = session.get(UserRecord, user_id)
    if customer is None or customer.role != "user":
        raise ApiError(status_code=404, code="NOT_FOUND", message="Customer not found.")
    existing = session.scalar(
        select(CreditGrantRecord).where(CreditGrantRecord.request_id == str(body.requestId))
    )
    if existing is not None:
        if (existing.user_id, existing.amount, existing.reason, as_utc(existing.expires_at)) != (
            user_id,
            body.amount,
            reason,
            as_utc(body.expiresAt),
        ):
            raise ApiError(
                status_code=409,
                code="CREDIT_GRANT_ID_REUSED",
                message="This grant request ID was already used.",
            )
        return existing, False
    grant = CreditGrantRecord(
        user_id=user_id,
        granted_by_user_id=admin_user_id,
        request_id=str(body.requestId),
        amount=body.amount,
        remaining=body.amount,
        reason=reason,
        expires_at=body.expiresAt,
    )
    session.add(grant)
    try:
        session.flush()
        audit.record_security_event(
            session,
            event=audit.CREDITS_GRANTED,
            outcome="success",
            actor_user_id=admin_user_id,
            subject_user_id=user_id,
            request_id=audit_request_id,
            device_summary=device_summary,
            metadata={"source": "admin-dashboard"},
        )
        session.commit()
    except IntegrityError as error:
        session.rollback()
        raise ApiError(
            status_code=409,
            code="CREDIT_GRANT_ID_REUSED",
            message="This grant request ID was already used.",
        ) from error
    return grant, True
