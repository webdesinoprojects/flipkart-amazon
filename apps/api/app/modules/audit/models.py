"""Sanitized authentication and security audit trail.

This table is deliberately narrow. It records *that* a security-relevant thing
happened to *which internal account*, not what the customer's documents
contained. It is the boundary the future admin operational view will read from;
it is **not** the general application log sink, which stays in structured server
logs so an unbounded table cannot grow from every exception.

Forbidden content (enforced by :mod:`app.modules.audit.service` and tested):
passwords, password hashes, raw or hashed session/CSRF/verification/reset
tokens, cookie values, full IP addresses, raw User-Agent strings, customer PDF
content, filenames, addresses, barcode payloads, and provider secrets.
"""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import JSON, BigInteger, DateTime, Index, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from ...database import Base
from ...platform.clock import utc_now


class SecurityEventRecord(Base):
    __tablename__ = "security_events"
    __table_args__ = (
        Index("ix_security_events_created_at", "created_at"),
        Index("ix_security_events_actor_user_id", "actor_user_id"),
        Index("ix_security_events_event", "event"),
    )

    # SQLite only auto-increments a plain INTEGER primary key, so the test
    # suite's throwaway databases need the variant. PostgreSQL keeps BIGINT:
    # this table grows with every sign-in attempt.
    id: Mapped[int] = mapped_column(
        BigInteger().with_variant(Integer, "sqlite"), primary_key=True, autoincrement=True
    )
    event: Mapped[str] = mapped_column(String(48))
    outcome: Mapped[str] = mapped_column(String(16))
    actor_user_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    """Internal account id. Null for an attempt that matched no account."""
    subject_user_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    """Account acted upon, when different from the actor (admin actions)."""
    request_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    ip_prefix: Mapped[str | None] = mapped_column(String(45), nullable=True)
    """Truncated network prefix, only when AUTH_AUDIT_STORE_IP_PREFIX is on."""
    device_summary: Mapped[str | None] = mapped_column(String(80), nullable=True)
    event_metadata: Mapped[dict | None] = mapped_column("metadata", JSON, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
