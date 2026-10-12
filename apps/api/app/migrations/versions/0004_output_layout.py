"""Record which output layout a saved batch PDF was imposed with.

Revision ID: 0004_output_layout
Revises: 0003_saved_batch_history
Create Date: 2026-10-08

Additive and backfill-safe. Every row that existed before this revision was
produced by the one-label-per-page assembler, so the server default and the
backfill both use ``label_100x150``; that keeps the previous invariant
``output_page_count == labels_ready`` true for historical rows.

``downgrade`` drops only the column this revision added, which loses the layout
of any A4 four-up batch saved in the meantime but destroys no PDF and no row.

The ``CHECK`` constraint is added only on dialects that support
``ALTER TABLE ... ADD CONSTRAINT``. SQLite does not, and emulating it in batch
mode would rebuild ``batches`` by copy-and-move — which on SQLite risks silently
dropping the other check constraints that cannot be reflected. SQLite is only
the local development/test database here; a database created from scratch still
gets the constraint from the model metadata, and the value is additionally
constrained by the ``OutputLayout`` literal at the API boundary.
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0004_output_layout"
down_revision: str | None = "0003_saved_batch_history"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

LAYOUT_CHECK = "ck_batches_output_layout"
DEFAULT_LAYOUT = "label_100x150"


def upgrade() -> None:
    # server_default makes the add safe on a non-empty table; it is kept so an
    # older API process writing during a rolling deploy still produces a valid
    # row. Application code always sets the value explicitly.
    op.add_column(
        "batches",
        sa.Column(
            "output_layout",
            sa.String(length=16),
            nullable=False,
            server_default=DEFAULT_LAYOUT,
        ),
    )
    op.execute(
        sa.text(
            "UPDATE batches SET output_layout = :layout WHERE output_layout IS NULL"
        ).bindparams(layout=DEFAULT_LAYOUT)
    )
    if _supports_add_constraint():
        op.create_check_constraint(
            LAYOUT_CHECK, "batches", "output_layout IN ('label_100x150', 'a4_4up')"
        )


def downgrade() -> None:
    if _supports_add_constraint():
        op.drop_constraint(LAYOUT_CHECK, "batches", type_="check")
    op.drop_column("batches", "output_layout")


def _supports_add_constraint() -> bool:
    return op.get_bind().dialect.name != "sqlite"
