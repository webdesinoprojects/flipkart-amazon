"""Accounts, sessions, one-time tokens, and the security audit trail.

Revision ID: 0002_auth_foundation
Revises: 0001_core_baseline
Create Date: 2026-10-07

Additive only: no existing table or column is altered or dropped, so this
revision is safe to apply to a database that already holds batches.

``downgrade`` deliberately refuses to run. Dropping these tables would destroy
every account, credential, and audit record, and no code path can put them
back. Rollback is a database restore; the procedure is in ``docs/MIGRATIONS.md``.
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0002_auth_foundation"
down_revision: str | None = "0001_core_baseline"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

IRREVERSIBLE = (
    "Revision 0002_auth_foundation cannot be downgraded: dropping users, "
    "sessions, auth_one_time_tokens and security_events would destroy every "
    "account and its audit history. Restore the database from a verified "
    "backup instead. See docs/MIGRATIONS.md."
)


def upgrade() -> None:
    op.create_table(
        "users",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("email_display", sa.String(length=254), nullable=False),
        sa.Column("email_canonical", sa.String(length=254), nullable=False),
        sa.Column("password_hash", sa.String(length=255), nullable=False),
        sa.Column("role", sa.String(length=16), nullable=False),
        sa.Column("status", sa.String(length=16), nullable=False),
        sa.Column("email_verified_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("security_version", sa.Integer(), nullable=False),
        sa.Column("last_login_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint("role IN ('user', 'admin')", name="ck_users_role"),
        sa.CheckConstraint("status IN ('active', 'suspended')", name="ck_users_status"),
        sa.PrimaryKeyConstraint("id"),
    )
    # Unique index, not a unique constraint: account identity is the canonical
    # address, and the index is also the lookup path for every sign-in.
    op.create_index("ix_users_email_canonical", "users", ["email_canonical"], unique=True)
    op.create_index("ix_users_role", "users", ["role"])
    op.create_index("ix_users_status", "users", ["status"])

    # Existing pre-account batches remain nullable until their TTL cleanup.
    # Every batch created after this revision is assigned by the authenticated
    # API route, and all reads are scoped to the same user id.
    op.add_column("batches", sa.Column("user_id", sa.String(length=36), nullable=True))
    op.create_foreign_key(
        "fk_batches_user_id_users",
        "batches",
        "users",
        ["user_id"],
        ["id"],
        ondelete="CASCADE",
    )
    op.create_index("ix_batches_user_id", "batches", ["user_id"])

    op.create_table(
        "sessions",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("user_id", sa.String(length=36), nullable=False),
        sa.Column("token_digest", sa.String(length=64), nullable=False),
        sa.Column("csrf_token_digest", sa.String(length=64), nullable=True),
        sa.Column("security_version", sa.Integer(), nullable=False),
        sa.Column("device_summary", sa.String(length=80), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("last_seen_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("idle_expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("absolute_expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("revoked_reason", sa.String(length=40), nullable=True),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_sessions_token_digest", "sessions", ["token_digest"], unique=True)
    op.create_index("ix_sessions_user_id", "sessions", ["user_id"])
    op.create_index("ix_sessions_idle_expires_at", "sessions", ["idle_expires_at"])
    op.create_index("ix_sessions_absolute_expires_at", "sessions", ["absolute_expires_at"])

    op.create_table(
        "auth_one_time_tokens",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("user_id", sa.String(length=36), nullable=False),
        sa.Column("purpose", sa.String(length=32), nullable=False),
        sa.Column("token_digest", sa.String(length=64), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("consumed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint(
            "purpose IN ('email_verification', 'password_reset')",
            name="ck_one_time_tokens_purpose",
        ),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_one_time_tokens_token_digest",
        "auth_one_time_tokens",
        ["token_digest"],
        unique=True,
    )
    op.create_index(
        "ix_one_time_tokens_user_purpose", "auth_one_time_tokens", ["user_id", "purpose"]
    )
    op.create_index("ix_one_time_tokens_expires_at", "auth_one_time_tokens", ["expires_at"])

    op.create_table(
        "security_events",
        sa.Column(
            "id",
            sa.BigInteger().with_variant(sa.Integer(), "sqlite"),
            autoincrement=True,
            nullable=False,
        ),
        sa.Column("event", sa.String(length=48), nullable=False),
        sa.Column("outcome", sa.String(length=16), nullable=False),
        sa.Column("actor_user_id", sa.String(length=36), nullable=True),
        sa.Column("subject_user_id", sa.String(length=36), nullable=True),
        sa.Column("request_id", sa.String(length=36), nullable=True),
        sa.Column("ip_prefix", sa.String(length=45), nullable=True),
        sa.Column("device_summary", sa.String(length=80), nullable=True),
        sa.Column("metadata", sa.JSON(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    # Deliberately no foreign key to users: an audit row must survive an account
    # deletion, and a failed sign-in has no account to point at.
    op.create_index("ix_security_events_created_at", "security_events", ["created_at"])
    op.create_index("ix_security_events_actor_user_id", "security_events", ["actor_user_id"])
    op.create_index("ix_security_events_event", "security_events", ["event"])


def downgrade() -> None:
    raise RuntimeError(IRREVERSIBLE)
