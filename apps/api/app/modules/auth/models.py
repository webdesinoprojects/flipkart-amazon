"""Persistence model for accounts, sessions, and one-time tokens.

Invariants enforced by the database rather than by application code:

* an account's canonical email is unique;
* ``role`` can only be ``user`` or ``admin`` (there is no ``super_admin``);
* ``status`` can only be ``active`` or ``suspended``;
* a session or one-time token digest is unique, so a replayed digest cannot be
  inserted twice;
* a one-time token's purpose is constrained to the two supported lifecycles.

No raw session or one-time token is ever stored. Only the keyed digest from
:mod:`app.modules.auth.tokens` is persisted.
"""

from __future__ import annotations

from datetime import datetime
from typing import Literal, get_args
from uuid import uuid4

from sqlalchemy import (
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from ...database import Base
from ...platform.clock import as_utc, utc_now

Role = Literal["user", "admin"]
"""The complete authorization model. Adding a third role is a product decision."""

AccountStatus = Literal["active", "suspended"]

TokenPurpose = Literal["email_verification", "password_reset"]

ROLES: tuple[str, ...] = get_args(Role)
ACCOUNT_STATUSES: tuple[str, ...] = get_args(AccountStatus)
TOKEN_PURPOSES: tuple[str, ...] = get_args(TokenPurpose)


def _new_id() -> str:
    return str(uuid4())


def _in_clause(column: str, values: tuple[str, ...]) -> str:
    rendered = ", ".join(f"'{value}'" for value in values)
    return f"{column} IN ({rendered})"


class UserRecord(Base):
    __tablename__ = "users"
    __table_args__ = (
        CheckConstraint(_in_clause("role", ROLES), name="ck_users_role"),
        CheckConstraint(_in_clause("status", ACCOUNT_STATUSES), name="ck_users_status"),
        Index("ix_users_email_canonical", "email_canonical", unique=True),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_new_id)
    email_display: Mapped[str] = mapped_column(String(254))
    email_canonical: Mapped[str] = mapped_column(String(254))
    password_hash: Mapped[str] = mapped_column(String(255))
    role: Mapped[str] = mapped_column(String(16), default="user", index=True)
    status: Mapped[str] = mapped_column(String(16), default="active", index=True)
    email_verified_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    security_version: Mapped[int] = mapped_column(Integer, default=1)
    """Bumped on password reset so every issued credential can be invalidated."""
    last_login_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utc_now, onupdate=utc_now
    )

    sessions: Mapped[list[SessionRecord]] = relationship(
        back_populates="user", cascade="all, delete-orphan"
    )
    one_time_tokens: Mapped[list[OneTimeTokenRecord]] = relationship(
        back_populates="user", cascade="all, delete-orphan"
    )

    @property
    def is_admin(self) -> bool:
        return self.role == "admin"

    @property
    def is_active(self) -> bool:
        return self.status == "active"

    @property
    def email_verified(self) -> bool:
        return self.email_verified_at is not None


class SessionRecord(Base):
    __tablename__ = "sessions"
    __table_args__ = (
        Index("ix_sessions_token_digest", "token_digest", unique=True),
        Index("ix_sessions_user_id", "user_id"),
        Index("ix_sessions_absolute_expires_at", "absolute_expires_at"),
        Index("ix_sessions_idle_expires_at", "idle_expires_at"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_new_id)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    token_digest: Mapped[str] = mapped_column(String(64))
    csrf_token_digest: Mapped[str | None] = mapped_column(String(64), nullable=True)
    security_version: Mapped[int] = mapped_column(Integer, default=1)
    """Copy of ``users.security_version`` at issuance; a bump invalidates this row."""
    device_summary: Mapped[str] = mapped_column(String(80), default="Unknown device")
    """Coarse browser/platform family only. Never the raw User-Agent string."""
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    last_seen_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    idle_expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    absolute_expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    revoked_reason: Mapped[str | None] = mapped_column(String(40), nullable=True)

    user: Mapped[UserRecord] = relationship(back_populates="sessions")

    def expires_at(self) -> datetime:
        return min(as_utc(self.idle_expires_at), as_utc(self.absolute_expires_at))

    def is_live(self, now: datetime) -> bool:
        return self.revoked_at is None and as_utc(now) < self.expires_at()


class OneTimeTokenRecord(Base):
    __tablename__ = "auth_one_time_tokens"
    __table_args__ = (
        CheckConstraint(_in_clause("purpose", TOKEN_PURPOSES), name="ck_one_time_tokens_purpose"),
        Index("ix_one_time_tokens_token_digest", "token_digest", unique=True),
        Index("ix_one_time_tokens_user_purpose", "user_id", "purpose"),
        Index("ix_one_time_tokens_expires_at", "expires_at"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_new_id)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    purpose: Mapped[str] = mapped_column(String(32))
    token_digest: Mapped[str] = mapped_column(String(64))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    consumed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    user: Mapped[UserRecord] = relationship(back_populates="one_time_tokens")
