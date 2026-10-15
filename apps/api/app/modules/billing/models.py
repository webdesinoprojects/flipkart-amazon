from __future__ import annotations

from datetime import datetime
from uuid import uuid4

from sqlalchemy import DateTime, ForeignKey, Index, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from ...database import Base
from ...platform.clock import utc_now


class BillingSubscriptionRecord(Base):
    __tablename__ = "billing_subscriptions"
    __table_args__ = (
        Index("ix_billing_subscriptions_user_id", "user_id"),
        Index("ix_billing_subscriptions_provider_id", "provider_id", unique=True),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    plan_code: Mapped[str] = mapped_column(String(16))
    provider_id: Mapped[str] = mapped_column(String(80))
    provider_plan_id: Mapped[str] = mapped_column(String(80))
    status: Mapped[str] = mapped_column(String(32), default="created")
    checkout_url: Mapped[str] = mapped_column(String(512))
    paid_through: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    cancel_at_cycle_end: Mapped[bool] = mapped_column(default=False)
    next_reconcile_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_reconciled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)


class BillingChargeRecord(Base):
    __tablename__ = "billing_charges"
    __table_args__ = (
        Index("ix_billing_charges_payment_id", "provider_payment_id", unique=True),
        Index("ix_billing_charges_subscription", "subscription_id"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    subscription_id: Mapped[str] = mapped_column(
        ForeignKey("billing_subscriptions.id", ondelete="CASCADE")
    )
    provider_payment_id: Mapped[str] = mapped_column(String(80))
    amount_paise: Mapped[int] = mapped_column(Integer)
    paid_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    period_end: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    refunded_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class BillingWebhookEventRecord(Base):
    __tablename__ = "billing_webhook_events"
    __table_args__ = (Index("ix_billing_webhook_events_due", "status", "next_attempt_at"),)

    event_id: Mapped[str] = mapped_column(String(120), primary_key=True)
    event_type: Mapped[str] = mapped_column(String(64))
    subscription_provider_id: Mapped[str | None] = mapped_column(String(80))
    payment_id: Mapped[str | None] = mapped_column(String(80))
    period_start: Mapped[int | None] = mapped_column(Integer)
    period_end: Mapped[int | None] = mapped_column(Integer)
    status: Mapped[str] = mapped_column(String(16), default="pending")
    attempts: Mapped[int] = mapped_column(Integer, default=0)
    next_attempt_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_error: Mapped[str | None] = mapped_column(String(64))
    processed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    received_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
