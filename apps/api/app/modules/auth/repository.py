"""All SQL for accounts, sessions, and one-time tokens.

State transitions that two requests could race are expressed as a single
conditional ``UPDATE ... RETURNING`` so PostgreSQL, not application code,
decides the winner. That covers one-time token consumption, session revocation,
and the idle-expiry refresh.
"""

from __future__ import annotations

from datetime import datetime, timedelta

from sqlalchemy import select, update
from sqlalchemy.orm import Session

from .models import OneTimeTokenRecord, SessionRecord, UserRecord


class AuthRepository:
    def __init__(self, session: Session) -> None:
        self._session = session

    # --- users ----------------------------------------------------------
    def find_user_by_canonical_email(self, canonical_email: str) -> UserRecord | None:
        return self._session.scalar(
            select(UserRecord).where(UserRecord.email_canonical == canonical_email)
        )

    def get_user(self, user_id: str) -> UserRecord | None:
        return self._session.get(UserRecord, user_id)

    def add_user(self, user: UserRecord) -> UserRecord:
        self._session.add(user)
        self._session.flush()
        return user

    def count_admins(self) -> int:
        return len(
            self._session.scalars(select(UserRecord.id).where(UserRecord.role == "admin")).all()
        )

    # --- sessions -------------------------------------------------------
    def add_session(self, record: SessionRecord) -> SessionRecord:
        self._session.add(record)
        self._session.flush()
        return record

    def find_live_session_by_digest(
        self, token_digest: str, *, now: datetime
    ) -> SessionRecord | None:
        """Return a session that is unrevoked, unexpired, and not superseded.

        Joining on ``users.security_version`` means a password reset that bumped
        the version invalidates every outstanding session immediately, even if a
        bulk revocation row-update were ever to miss one.
        """
        return self._session.scalar(
            select(SessionRecord)
            .join(UserRecord, UserRecord.id == SessionRecord.user_id)
            .where(
                SessionRecord.token_digest == token_digest,
                SessionRecord.revoked_at.is_(None),
                SessionRecord.idle_expires_at > now,
                SessionRecord.absolute_expires_at > now,
                SessionRecord.security_version == UserRecord.security_version,
            )
        )

    def list_live_sessions(self, user_id: str, *, now: datetime) -> list[SessionRecord]:
        return list(
            self._session.scalars(
                select(SessionRecord)
                .where(
                    SessionRecord.user_id == user_id,
                    SessionRecord.revoked_at.is_(None),
                    SessionRecord.idle_expires_at > now,
                    SessionRecord.absolute_expires_at > now,
                )
                .order_by(SessionRecord.last_seen_at.desc())
            ).all()
        )

    def touch_session(self, session_id: str, *, now: datetime, idle_seconds: int) -> None:
        """Extend idle expiry for a session that is still live.

        The condition on ``revoked_at`` means a revocation that commits between
        the lookup and this update wins: the touch simply affects no rows.
        """
        self._session.execute(
            update(SessionRecord)
            .where(SessionRecord.id == session_id, SessionRecord.revoked_at.is_(None))
            .values(last_seen_at=now, idle_expires_at=now + timedelta(seconds=idle_seconds))
            .execution_options(synchronize_session=False)
        )

    def revoke_session(self, session_id: str, *, user_id: str, now: datetime, reason: str) -> bool:
        """Revoke one session owned by ``user_id``. Returns whether it changed."""
        result = self._session.execute(
            update(SessionRecord)
            .where(
                SessionRecord.id == session_id,
                SessionRecord.user_id == user_id,
                SessionRecord.revoked_at.is_(None),
            )
            .values(revoked_at=now, revoked_reason=reason[:40])
            .returning(SessionRecord.id)
            .execution_options(synchronize_session=False)
        )
        return result.first() is not None

    def revoke_all_sessions(
        self, user_id: str, *, now: datetime, reason: str, keep_session_id: str | None = None
    ) -> int:
        statement = (
            update(SessionRecord)
            .where(SessionRecord.user_id == user_id, SessionRecord.revoked_at.is_(None))
            .values(revoked_at=now, revoked_reason=reason[:40])
            .returning(SessionRecord.id)
            .execution_options(synchronize_session=False)
        )
        if keep_session_id:
            statement = statement.where(SessionRecord.id != keep_session_id)
        return len(self._session.execute(statement).all())

    def delete_expired_sessions(self, *, now: datetime, retain_seconds: int) -> int:
        """Remove sessions that expired long enough ago to be uninteresting."""
        cutoff = now - timedelta(seconds=retain_seconds)
        stale = self._session.scalars(
            select(SessionRecord.id).where(
                SessionRecord.absolute_expires_at < cutoff,
            )
        ).all()
        for session_id in stale:
            record = self._session.get(SessionRecord, session_id)
            if record is not None:
                self._session.delete(record)
        return len(stale)

    # --- one-time tokens -------------------------------------------------
    def add_one_time_token(self, record: OneTimeTokenRecord) -> OneTimeTokenRecord:
        self._session.add(record)
        self._session.flush()
        return record

    def revoke_outstanding_tokens(self, user_id: str, *, purpose: str, now: datetime) -> int:
        """Supersede older outstanding tokens for one purpose.

        Policy: requesting a new verification or reset link invalidates every
        previous unused link for that purpose, so an intercepted older email
        stops working as soon as the person asks for a new one.
        """
        result = self._session.execute(
            update(OneTimeTokenRecord)
            .where(
                OneTimeTokenRecord.user_id == user_id,
                OneTimeTokenRecord.purpose == purpose,
                OneTimeTokenRecord.consumed_at.is_(None),
                OneTimeTokenRecord.revoked_at.is_(None),
            )
            .values(revoked_at=now)
            .returning(OneTimeTokenRecord.id)
            .execution_options(synchronize_session=False)
        )
        return len(result.all())

    def consume_one_time_token(
        self, token_digest: str, *, purpose: str, now: datetime
    ) -> str | None:
        """Atomically mark a token used and return its owner id.

        Two concurrent requests presenting the same token cause two conditional
        updates; only one can match ``consumed_at IS NULL`` and the loser gets
        ``None``.
        """
        result = self._session.execute(
            update(OneTimeTokenRecord)
            .where(
                OneTimeTokenRecord.token_digest == token_digest,
                OneTimeTokenRecord.purpose == purpose,
                OneTimeTokenRecord.consumed_at.is_(None),
                OneTimeTokenRecord.revoked_at.is_(None),
                OneTimeTokenRecord.expires_at > now,
            )
            .values(consumed_at=now)
            .returning(OneTimeTokenRecord.user_id)
            .execution_options(synchronize_session=False)
        )
        row = result.first()
        return row[0] if row else None

    def token_exists(self, token_digest: str, *, purpose: str) -> bool:
        """Whether a token row exists at all, regardless of state.

        Used only to distinguish "expired" from "never valid" for the audit
        trail. The distinction is never returned to the browser.
        """
        return (
            self._session.scalar(
                select(OneTimeTokenRecord.id).where(
                    OneTimeTokenRecord.token_digest == token_digest,
                    OneTimeTokenRecord.purpose == purpose,
                )
            )
            is not None
        )

    def delete_expired_tokens(self, *, now: datetime, retain_seconds: int) -> int:
        cutoff = now - timedelta(seconds=retain_seconds)
        stale = self._session.scalars(
            select(OneTimeTokenRecord.id).where(OneTimeTokenRecord.expires_at < cutoff)
        ).all()
        for token_id in stale:
            record = self._session.get(OneTimeTokenRecord, token_id)
            if record is not None:
                self._session.delete(record)
        return len(stale)
