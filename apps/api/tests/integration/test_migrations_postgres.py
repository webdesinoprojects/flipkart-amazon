"""Migration behaviour against a real PostgreSQL server."""

import pytest
from alembic import command
from sqlalchemy import create_engine, inspect, text

from app.database import Base
from app.models_registry import import_all_models
from app.platform.database.migrations import (
    alembic_config,
    current_revision,
    head_revision,
    migration_status,
)
from tests.integration.conftest import requires_postgres

pytestmark = requires_postgres

EXPECTED_TABLES = {
    "batches",
    "documents",
    "processing_events",
    "layout_templates",
    "users",
    "sessions",
    "auth_one_time_tokens",
    "security_events",
}


def test_an_empty_database_migrates_from_zero_to_head(postgres_url):
    engine = create_engine(postgres_url)
    assert migration_status(engine) == "not_initialized"

    command.upgrade(alembic_config(postgres_url), "head")

    assert migration_status(engine) == "up_to_date"
    assert current_revision(engine) == head_revision()
    assert EXPECTED_TABLES.issubset(set(inspect(engine).get_table_names()))
    engine.dispose()


def test_the_migrated_schema_matches_the_orm_metadata(postgres_url):
    """No drift: autogenerate must find nothing to do after upgrading to head."""
    from alembic.autogenerate import compare_metadata
    from alembic.runtime.migration import MigrationContext

    import_all_models()
    command.upgrade(alembic_config(postgres_url), "head")
    engine = create_engine(postgres_url)
    with engine.connect() as connection:
        context = MigrationContext.configure(connection)
        differences = compare_metadata(context, Base.metadata)
    engine.dispose()
    assert differences == [], f"schema drift detected: {differences}"


def test_a_create_all_database_is_adopted_by_stamping_without_losing_data(postgres_url):
    """The documented adoption path for a database built before Alembic existed."""
    engine = create_engine(postgres_url)

    # Reproduce the exact legacy installation. Current ORM metadata contains
    # the new user ownership FK, so it cannot truthfully stand in for the old
    # schema. Revision 0001 is the frozen schema contract for that release.
    config = alembic_config(postgres_url)
    command.upgrade(config, "0001_core_baseline")
    with engine.begin() as connection:
        connection.execute(text("DROP TABLE alembic_version"))
        connection.execute(
            text(
                "INSERT INTO batches (id, status, created_at, updated_at, expires_at) "
                "VALUES ('legacy-batch', 'ready', NOW(), NOW(), NOW() + INTERVAL '1 hour')"
            )
        )

    command.stamp(config, "0001_core_baseline")
    assert migration_status(engine) == "pending"

    command.upgrade(config, "head")

    assert migration_status(engine) == "up_to_date"
    with engine.connect() as connection:
        preserved = connection.execute(
            text("SELECT status FROM batches WHERE id = 'legacy-batch'")
        ).scalar_one()
        assert preserved == "ready", "adoption must not touch existing rows"
        assert connection.execute(text("SELECT count(*) FROM users")).scalar_one() == 0
    engine.dispose()


def test_upgrading_twice_is_a_no_op(postgres_url):
    config = alembic_config(postgres_url)
    command.upgrade(config, "head")
    command.upgrade(config, "head")
    engine = create_engine(postgres_url)
    assert migration_status(engine) == "up_to_date"
    engine.dispose()


def test_the_auth_revision_refuses_to_downgrade(postgres_url):
    """Rollback is a restore, not a downgrade; the script must say so loudly."""
    config = alembic_config(postgres_url)
    command.upgrade(config, "head")
    with pytest.raises(RuntimeError, match="cannot be downgraded"):
        command.downgrade(config, "0001_core_baseline")

    engine = create_engine(postgres_url)
    assert "users" in inspect(engine).get_table_names(), "nothing was dropped"
    engine.dispose()


def test_the_api_never_creates_schema_at_startup(postgres_url):
    """Starting the app against an unmigrated database must not create tables."""
    import app.main as main_module

    engine = create_engine(postgres_url)
    source = __import__("inspect").getsource(main_module.lifespan).replace(" ", "").lower()
    assert ".create_all(" not in source
    assert inspect(engine).get_table_names() == []
    engine.dispose()
