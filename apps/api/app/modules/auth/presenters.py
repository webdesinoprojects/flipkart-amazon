"""The only place ORM records become response data.

Routes never return a ``UserRecord`` or ``SessionRecord``. Mapping lives here so
there is one reviewable list of the fields that are allowed to leave the
service, and so a new column cannot become public by accident.
"""

from __future__ import annotations

from ...platform.clock import as_utc
from .models import SessionRecord, UserRecord
from .schemas import SessionOut, UserOut


def present_user(user: UserRecord) -> UserOut:
    return UserOut(
        id=user.id,
        email=user.email_display,
        role="admin" if user.is_admin else "user",
        emailVerified=user.email_verified,
        # Timestamps always leave as UTC with an explicit offset, whichever
        # driver read them, so clients never have to guess a zone.
        createdAt=as_utc(user.created_at),
        lastLoginAt=as_utc(user.last_login_at) if user.last_login_at else None,
    )


def present_session(record: SessionRecord, *, current_session_id: str) -> SessionOut:
    return SessionOut(
        id=record.id,
        deviceSummary=record.device_summary,
        createdAt=as_utc(record.created_at),
        lastSeenAt=as_utc(record.last_seen_at),
        expiresAt=record.expires_at(),
        current=record.id == current_session_id,
    )
