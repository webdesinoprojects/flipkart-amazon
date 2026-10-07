"""Shared fixtures for tests that need real PostgreSQL and Valkey semantics.

These tests are skipped unless the services are reachable, because concurrency,
unique-constraint, and counter behaviour cannot be faithfully simulated:

    docker compose up -d postgres valkey
    set TEST_DATABASE_URL=postgresql+psycopg://labels:labels@localhost:5432/labels_test
    set TEST_VALKEY_URL=redis://localhost:6379/9
    pytest tests/integration

``docs/MIGRATIONS.md`` documents the full command for Windows and POSIX shells.
"""

from __future__ import annotations

import os
import uuid

import pytest
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker

from app.platform.database.migrations import alembic_config

TEST_DATABASE_URL = os.environ.get("TEST_DATABASE_URL", "")
TEST_VALKEY_URL = os.environ.get("TEST_VALKEY_URL", "")

requires_postgres = pytest.mark.skipif(
    not TEST_DATABASE_URL,
    reason="Set TEST_DATABASE_URL to a PostgreSQL database to run integration tests.",
)
requires_valkey = pytest.mark.skipif(
    not TEST_VALKEY_URL,
    reason="Set TEST_VALKEY_URL to a Valkey instance to run integration tests.",
)


def _admin_url(url: str) -> tuple[str, str]:
    """Split a URL into a server-level URL and the database name."""
    base, _, database = url.rpartition("/")
    return f"{base}/postgres", database


@pytest.fixture
def postgres_url() -> str:
    """A freshly created, empty PostgreSQL database dropped after the test."""
    if not TEST_DATABASE_URL:
        pytest.skip("TEST_DATABASE_URL is not set")
    server_url, _ = _admin_url(TEST_DATABASE_URL)
    database = f"labels_test_{uuid.uuid4().hex[:12]}"
    admin = create_engine(server_url, isolation_level="AUTOCOMMIT")
    with admin.connect() as connection:
        connection.execute(text(f'CREATE DATABASE "{database}"'))
    target = f"{server_url.rsplit('/', 1)[0]}/{database}"
    try:
        yield target
    finally:
        with admin.connect() as connection:
            connection.execute(
                text(
                    "SELECT pg_terminate_backend(pid) FROM pg_stat_activity "
                    "WHERE datname = :name AND pid <> pg_backend_pid()"
                ),
                {"name": database},
            )
            connection.execute(text(f'DROP DATABASE IF EXISTS "{database}"'))
        admin.dispose()


@pytest.fixture
def migrated_postgres(postgres_url: str):
    """A PostgreSQL database migrated from zero to head."""
    from alembic import command

    config = alembic_config(postgres_url)
    command.upgrade(config, "head")
    engine = create_engine(postgres_url, pool_pre_ping=True)
    yield engine, sessionmaker(bind=engine, expire_on_commit=False), postgres_url
    engine.dispose()
