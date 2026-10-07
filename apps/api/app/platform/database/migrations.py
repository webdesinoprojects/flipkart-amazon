"""Programmatic access to the Alembic revision graph.

Used by readiness so an instance can report whether the database schema matches
the code it is running, and by tests that migrate a throwaway database from
zero to head. The head revision is read from the script directory rather than
hard-coded, so adding a revision cannot leave a stale constant behind.
"""

from __future__ import annotations

from pathlib import Path
from typing import Literal

from alembic.config import Config
from alembic.runtime.migration import MigrationContext
from alembic.script import ScriptDirectory
from sqlalchemy import Engine, inspect

MigrationStatus = Literal["up_to_date", "pending", "not_initialized", "unknown"]

MIGRATIONS_PACKAGE = Path(__file__).resolve().parents[2] / "migrations"
VERSION_TABLE = "alembic_version"


def alembic_config(database_url: str | None = None) -> Config:
    """Build an Alembic config without requiring a working directory."""
    config = Config()
    config.set_main_option("script_location", str(MIGRATIONS_PACKAGE))
    if database_url:
        # Escaped because Alembic runs the value through configparser
        # interpolation, and a password may legitimately contain '%'.
        config.set_main_option("sqlalchemy.url", database_url.replace("%", "%%"))
    return config


def head_revision() -> str:
    script = ScriptDirectory.from_config(alembic_config())
    return script.get_current_head() or ""


def current_revision(engine: Engine) -> str | None:
    with engine.connect() as connection:
        return MigrationContext.configure(connection).get_current_revision()


def migration_status(engine: Engine) -> MigrationStatus:
    """Compare the database's stamped revision with the code's head.

    ``not_initialized`` means the version table is absent, which is what a
    brand-new database or a legacy ``create_all`` database looks like. The
    adoption procedure in ``docs/MIGRATIONS.md`` turns the latter into
    ``up_to_date`` without touching data.
    """
    try:
        if not inspect(engine).has_table(VERSION_TABLE):
            return "not_initialized"
        stamped = current_revision(engine)
        return "up_to_date" if stamped and stamped == head_revision() else "pending"
    except Exception:  # noqa: BLE001 - readiness must never raise
        return "unknown"
