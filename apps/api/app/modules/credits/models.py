"""Auditable one-time bonus-credit grants and their batch-level consumption."""

from __future__ import annotations

from datetime import datetime
from uuid import uuid4

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Index, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from ...database import Base
from ...platform.clock import utc_now


class CreditGrantRecord(Base):
    __tablename__ = "credit_grants"
    __table_args__ = (
        CheckConstraint("amount > 0", name="ck_credit_grants_amount"),
        CheckConstraint(
            "remaining >= 0 AND remaining <= amount", name="ck_credit_grants_remaining"
        ),
        Index("ix_credit_grants_user_expiry", "user_id", "expires_at"),
        Index("ix_credit_grants_request_id", "request_id", unique=True),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    granted_by_user_id: Mapped[str] = mapped_column(ForeignKey("users.id"))
    request_id: Mapped[str] = mapped_column(String(36))
    amount: Mapped[int] = mapped_column(Integer)
    remaining: Mapped[int] = mapped_column(Integer)
    reason: Mapped[str] = mapped_column(String(200))
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)


class CreditSpendRecord(Base):
    __tablename__ = "credit_spends"
    __table_args__ = (
        CheckConstraint("amount > 0", name="ck_credit_spends_amount"),
        Index("ix_credit_spends_user_at", "user_id", "consumed_at"),
        Index("ix_credit_spends_batch_at", "batch_id", "consumed_at"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    grant_id: Mapped[str] = mapped_column(ForeignKey("credit_grants.id", ondelete="CASCADE"))
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    batch_id: Mapped[str | None] = mapped_column(
        ForeignKey("batches.id", ondelete="SET NULL"), nullable=True
    )
    amount: Mapped[int] = mapped_column(Integer)
    consumed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
