"""Baseline the tables that Base.metadata.create_all used to build.

Revision ID: 0001_core_baseline
Revises:
Create Date: 2026-10-07

This revision reproduces the schema that earlier releases created implicitly at
API startup, so a brand-new database can migrate from zero to head.

An existing database that was built by ``create_all`` must be **adopted**, not
upgraded: run ``alembic stamp 0001_core_baseline`` once, then
``alembic upgrade head``. Stamping writes only the ``alembic_version`` row and
touches no table or data. See ``docs/MIGRATIONS.md``.
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0001_core_baseline"
down_revision: str | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "batches",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("status", sa.String(length=32), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_batches_status", "batches", ["status"])
    op.create_index("ix_batches_expires_at", "batches", ["expires_at"])

    op.create_table(
        "documents",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("batch_id", sa.String(length=36), nullable=False),
        sa.Column("safe_name", sa.String(length=180), nullable=False),
        sa.Column("storage_key", sa.String(length=500), nullable=False),
        sa.Column("sha256", sa.String(length=64), nullable=False),
        sa.Column("size_bytes", sa.BigInteger(), nullable=False),
        sa.Column("page_count", sa.Integer(), nullable=True),
        sa.Column("status", sa.String(length=32), nullable=False),
        sa.Column("error_code", sa.String(length=80), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["batch_id"], ["batches.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("storage_key"),
    )
    op.create_index("ix_documents_batch_id", "documents", ["batch_id"])
    op.create_index("ix_documents_sha256", "documents", ["sha256"])
    op.create_index("ix_documents_status", "documents", ["status"])

    op.create_table(
        "processing_events",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("batch_id", sa.String(length=36), nullable=False),
        sa.Column("document_id", sa.String(length=36), nullable=True),
        sa.Column("page_id", sa.String(length=80), nullable=True),
        sa.Column("sequence", sa.Integer(), nullable=False),
        sa.Column("stage", sa.String(length=20), nullable=False),
        sa.Column("status", sa.String(length=20), nullable=False),
        sa.Column("progress", sa.Float(), nullable=True),
        sa.Column("message", sa.String(length=240), nullable=False),
        sa.Column("metadata", sa.JSON(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["batch_id"], ["batches.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("batch_id", "sequence"),
    )
    op.create_index("ix_processing_events_batch_id", "processing_events", ["batch_id"])
    op.create_index("ix_processing_events_document_id", "processing_events", ["document_id"])
    op.create_index("ix_processing_events_stage", "processing_events", ["stage"])

    op.create_table(
        "layout_templates",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("marketplace", sa.String(length=32), nullable=False),
        sa.Column("adapter_version", sa.String(length=32), nullable=False),
        sa.Column("fingerprint", sa.String(length=160), nullable=False),
        sa.Column("status", sa.String(length=20), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("fingerprint"),
    )
    op.create_index("ix_layout_templates_marketplace", "layout_templates", ["marketplace"])


def downgrade() -> None:
    """Drop the baseline tables.

    Only meaningful for a throwaway database. On any installation with real
    batches this destroys data; recover from a backup instead.
    """
    op.drop_index("ix_layout_templates_marketplace", table_name="layout_templates")
    op.drop_table("layout_templates")
    op.drop_index("ix_processing_events_stage", table_name="processing_events")
    op.drop_index("ix_processing_events_document_id", table_name="processing_events")
    op.drop_index("ix_processing_events_batch_id", table_name="processing_events")
    op.drop_table("processing_events")
    op.drop_index("ix_documents_status", table_name="documents")
    op.drop_index("ix_documents_sha256", table_name="documents")
    op.drop_index("ix_documents_batch_id", table_name="documents")
    op.drop_table("documents")
    op.drop_index("ix_batches_expires_at", table_name="batches")
    op.drop_index("ix_batches_status", table_name="batches")
    op.drop_table("batches")
