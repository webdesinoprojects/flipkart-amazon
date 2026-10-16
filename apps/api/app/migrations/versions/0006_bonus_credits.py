"""Add expiring one-time admin bonus-credit grants and spends.

Revision ID: 0006_bonus_credits
Revises: 0005_billing_subscriptions
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0006_bonus_credits"
down_revision: str | None = "0005_billing_subscriptions"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "credit_grants",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column(
            "user_id", sa.String(36), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column("granted_by_user_id", sa.String(36), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("request_id", sa.String(36), nullable=False),
        sa.Column("amount", sa.Integer(), nullable=False),
        sa.Column("remaining", sa.Integer(), nullable=False),
        sa.Column("reason", sa.String(200), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint("amount > 0", name="ck_credit_grants_amount"),
        sa.CheckConstraint(
            "remaining >= 0 AND remaining <= amount", name="ck_credit_grants_remaining"
        ),
    )
    op.create_index("ix_credit_grants_user_expiry", "credit_grants", ["user_id", "expires_at"])
    op.create_index("ix_credit_grants_request_id", "credit_grants", ["request_id"], unique=True)
    op.create_table(
        "credit_spends",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column(
            "grant_id",
            sa.String(36),
            sa.ForeignKey("credit_grants.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "user_id", sa.String(36), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column("batch_id", sa.String(36), sa.ForeignKey("batches.id", ondelete="SET NULL")),
        sa.Column("amount", sa.Integer(), nullable=False),
        sa.Column("consumed_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint("amount > 0", name="ck_credit_spends_amount"),
    )
    op.create_index("ix_credit_spends_user_at", "credit_spends", ["user_id", "consumed_at"])
    op.create_index("ix_credit_spends_batch_at", "credit_spends", ["batch_id", "consumed_at"])


def downgrade() -> None:
    raise RuntimeError("Credit grants may have been spent; restore from backup instead.")
