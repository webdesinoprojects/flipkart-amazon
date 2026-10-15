"""Add durable Razorpay subscription, charge and webhook event records.

Revision ID: 0005_billing_subscriptions
Revises: 0004_output_layout
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0005_billing_subscriptions"
down_revision: str | None = "0004_output_layout"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "billing_subscriptions",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column(
            "user_id", sa.String(36), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column("plan_code", sa.String(16), nullable=False),
        sa.Column("provider_id", sa.String(80), nullable=False),
        sa.Column("provider_plan_id", sa.String(80), nullable=False),
        sa.Column("status", sa.String(32), nullable=False),
        sa.Column("checkout_url", sa.String(512), nullable=False),
        sa.Column("paid_through", sa.DateTime(timezone=True)),
        sa.Column("cancel_at_cycle_end", sa.Boolean(), nullable=False),
        sa.Column("next_reconcile_at", sa.DateTime(timezone=True)),
        sa.Column("last_reconciled_at", sa.DateTime(timezone=True)),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_billing_subscriptions_user_id", "billing_subscriptions", ["user_id"])
    op.create_index(
        "ix_billing_subscriptions_provider_id",
        "billing_subscriptions",
        ["provider_id"],
        unique=True,
    )
    op.create_table(
        "billing_charges",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column(
            "subscription_id",
            sa.String(36),
            sa.ForeignKey("billing_subscriptions.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("provider_payment_id", sa.String(80), nullable=False),
        sa.Column("amount_paise", sa.Integer(), nullable=False),
        sa.Column("paid_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("period_end", sa.DateTime(timezone=True), nullable=False),
        sa.Column("refunded_at", sa.DateTime(timezone=True)),
    )
    op.create_index(
        "ix_billing_charges_payment_id", "billing_charges", ["provider_payment_id"], unique=True
    )
    op.create_index("ix_billing_charges_subscription", "billing_charges", ["subscription_id"])
    op.create_table(
        "billing_webhook_events",
        sa.Column("event_id", sa.String(120), primary_key=True),
        sa.Column("event_type", sa.String(64), nullable=False),
        sa.Column("subscription_provider_id", sa.String(80)),
        sa.Column("payment_id", sa.String(80)),
        sa.Column("period_start", sa.Integer()),
        sa.Column("period_end", sa.Integer()),
        sa.Column("status", sa.String(16), nullable=False),
        sa.Column("attempts", sa.Integer(), nullable=False),
        sa.Column("next_attempt_at", sa.DateTime(timezone=True)),
        sa.Column("last_error", sa.String(64)),
        sa.Column("processed_at", sa.DateTime(timezone=True)),
        sa.Column("received_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index(
        "ix_billing_webhook_events_due", "billing_webhook_events", ["status", "next_attempt_at"]
    )


def downgrade() -> None:
    raise RuntimeError("Billing records may contain payment history; restore from backup instead.")
