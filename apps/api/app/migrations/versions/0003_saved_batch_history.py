"""Add owner-scoped saved batch history and generated-output metadata.

Revision ID: 0003_saved_batch_history
Revises: 0002_auth_foundation
Create Date: 2026-10-07

This migration is additive. Existing server-fallback batches remain valid with
zero counters and no client batch id. Generated PDFs are private storage
objects; original marketplace PDFs are not copied into this history model.
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0003_saved_batch_history"
down_revision: str | None = "0002_auth_foundation"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

IRREVERSIBLE = (
    "0003_saved_batch_history contains user history and generated outputs. "
    "Keep the additive schema when rolling application code back, or restore "
    "from a verified backup instead of dropping user data."
)


def upgrade() -> None:
    recreate = "always" if op.get_bind().dialect.name == "sqlite" else "auto"
    with op.batch_alter_table("batches", recreate=recreate) as batch:
        batch.add_column(sa.Column("client_batch_id", sa.String(length=80), nullable=True))
        batch.add_column(sa.Column("request_digest", sa.String(length=64), nullable=True))
        batch.add_column(
            sa.Column("source_document_count", sa.Integer(), nullable=False, server_default="0")
        )
        batch.add_column(
            sa.Column("source_page_count", sa.Integer(), nullable=False, server_default="0")
        )
        batch.add_column(
            sa.Column("labels_discovered", sa.Integer(), nullable=False, server_default="0")
        )
        batch.add_column(
            sa.Column("labels_ready", sa.Integer(), nullable=False, server_default="0")
        )
        batch.add_column(
            sa.Column("review_required", sa.Integer(), nullable=False, server_default="0")
        )
        batch.add_column(
            sa.Column("labels_failed", sa.Integer(), nullable=False, server_default="0")
        )
        batch.add_column(
            sa.Column("duplicate_warnings", sa.Integer(), nullable=False, server_default="0")
        )
        batch.add_column(
            sa.Column("output_page_count", sa.Integer(), nullable=False, server_default="0")
        )
        batch.add_column(sa.Column("marketplace_counts", sa.JSON(), nullable=True))
        batch.add_column(sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True))
        batch.create_unique_constraint(
            "uq_batches_user_client_batch", ["user_id", "client_batch_id"]
        )
        for name, column in (
            ("ck_batches_source_documents", "source_document_count"),
            ("ck_batches_source_pages", "source_page_count"),
            ("ck_batches_labels_discovered", "labels_discovered"),
            ("ck_batches_labels_ready", "labels_ready"),
            ("ck_batches_review_required", "review_required"),
            ("ck_batches_labels_failed", "labels_failed"),
            ("ck_batches_duplicate_warnings", "duplicate_warnings"),
            ("ck_batches_output_pages", "output_page_count"),
        ):
            batch.create_check_constraint(name, f"{column} >= 0")
    op.create_index("ix_batches_user_completed_at", "batches", ["user_id", "completed_at"])

    op.create_table(
        "saved_outputs",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("batch_id", sa.String(length=36), nullable=False),
        sa.Column("user_id", sa.String(length=36), nullable=False),
        sa.Column("storage_key", sa.String(length=500), nullable=False),
        sa.Column("storage_provider", sa.String(length=24), nullable=False),
        sa.Column("sha256", sa.String(length=64), nullable=False),
        sa.Column("size_bytes", sa.BigInteger(), nullable=False),
        sa.Column("page_count", sa.Integer(), nullable=False),
        sa.Column("filename", sa.String(length=100), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint("page_count > 0", name="ck_saved_outputs_pages"),
        sa.CheckConstraint("size_bytes > 0", name="ck_saved_outputs_size"),
        sa.ForeignKeyConstraint(["batch_id"], ["batches.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("storage_key"),
    )
    op.create_index(
        "ix_saved_outputs_batch_id", "saved_outputs", ["batch_id"], unique=True
    )
    op.create_index("ix_saved_outputs_user_id", "saved_outputs", ["user_id"])
    op.create_index("ix_saved_outputs_sha256", "saved_outputs", ["sha256"])
    op.create_index("ix_saved_outputs_expires_at", "saved_outputs", ["expires_at"])
    op.create_index(
        "ix_saved_outputs_user_created_at", "saved_outputs", ["user_id", "created_at"]
    )


def downgrade() -> None:
    raise RuntimeError(IRREVERSIBLE)
