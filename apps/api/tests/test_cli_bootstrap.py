"""The first-admin bootstrap: non-HTTP, idempotent, and without default credentials."""

from pathlib import Path

import pytest
from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app import cli
from app.config import Settings
from app.database import Base
from app.modules.audit.models import SecurityEventRecord
from app.modules.auth.models import UserRecord
from app.modules.auth.passwords import password_service_from_parameters

STRONG_PASSWORD = "a sufficiently long operator passphrase"


@pytest.fixture
def bootstrap(tmp_path: Path, monkeypatch):
    engine = create_engine(
        "sqlite+pysqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    factory = sessionmaker(bind=engine, expire_on_commit=False)
    settings = Settings(
        environment="test",
        auth_secret="test-only-auth-secret-value-at-least-32-chars",
        auth_argon2_time_cost=1,
        auth_argon2_memory_kib=8192,
        auth_argon2_parallelism=1,
    )
    monkeypatch.setattr(cli, "SessionLocal", factory)
    monkeypatch.setattr(cli, "get_settings", lambda: settings)
    monkeypatch.setattr(
        cli,
        "build_password_service",
        lambda _settings: password_service_from_parameters(
            time_cost=1, memory_kib=8192, parallelism=1, min_length=10, max_bytes=1024
        ),
    )
    return factory, settings, tmp_path


def password_file(tmp_path: Path, value: str = STRONG_PASSWORD) -> str:
    path = tmp_path / "admin-password"
    path.write_text(value + "\n", encoding="utf-8")
    return str(path)


def users(factory) -> list[UserRecord]:
    with factory() as session:
        return list(session.scalars(select(UserRecord)).all())


def test_the_first_admin_is_created_with_a_secret_file(bootstrap, capsys):
    factory, _, tmp_path = bootstrap
    code = cli.main(
        [
            "create-admin",
            "--email",
            "Owner@Example.com",
            "--password-file",
            password_file(tmp_path),
        ]
    )
    assert code == 0
    created = users(factory)
    assert len(created) == 1
    assert created[0].role == "admin"
    assert created[0].status == "active"
    assert created[0].email_canonical == "owner@example.com"
    assert created[0].email_verified_at is not None
    assert "Administrator created" in capsys.readouterr().out


def test_the_password_is_hashed_and_never_printed(bootstrap, capsys):
    factory, _, tmp_path = bootstrap
    cli.main(
        ["create-admin", "--email", "owner@example.com", "--password-file", password_file(tmp_path)]
    )
    stored = users(factory)[0]
    assert stored.password_hash.startswith("$argon2id$")
    assert STRONG_PASSWORD not in stored.password_hash
    output = capsys.readouterr()
    assert STRONG_PASSWORD not in output.out
    assert STRONG_PASSWORD not in output.err


def test_only_the_first_line_of_the_secret_file_is_used(bootstrap):
    factory, _, tmp_path = bootstrap
    path = tmp_path / "multi-line"
    path.write_text(f"{STRONG_PASSWORD}\nignored second line\n", encoding="utf-8")
    cli.main(["create-admin", "--email", "owner@example.com", "--password-file", str(path)])

    service = password_service_from_parameters(
        time_cost=1, memory_kib=8192, parallelism=1, min_length=10, max_bytes=1024
    )
    assert service.verify(password_hash=users(factory)[0].password_hash, password=STRONG_PASSWORD)


def test_running_twice_is_safe_and_reports_nothing_to_do(bootstrap, capsys):
    factory, _, tmp_path = bootstrap
    secret = password_file(tmp_path)
    cli.main(["create-admin", "--email", "owner@example.com", "--password-file", secret])
    original_hash = users(factory)[0].password_hash

    assert cli.main(["create-admin", "--email", "owner@example.com"]) == 0
    assert "already an administrator" in capsys.readouterr().out
    assert len(users(factory)) == 1
    assert users(factory)[0].password_hash == original_hash


def test_an_existing_user_is_promoted_only_with_explicit_confirmation(bootstrap):
    factory, settings, tmp_path = bootstrap
    with factory() as session:
        session.add(
            UserRecord(
                email_display="seller@example.com",
                email_canonical="seller@example.com",
                password_hash="$argon2id$placeholder",
                role="user",
                status="active",
            )
        )
        session.commit()

    assert cli.main(["create-admin", "--email", "seller@example.com"]) == cli.EXIT_ABORTED
    assert users(factory)[0].role == "user"

    assert cli.main(["create-admin", "--email", "seller@example.com", "--yes"]) == 0
    assert users(factory)[0].role == "admin"


def test_promotion_records_an_audit_event_with_the_previous_role(bootstrap):
    factory, _, tmp_path = bootstrap
    with factory() as session:
        session.add(
            UserRecord(
                email_display="seller@example.com",
                email_canonical="seller@example.com",
                password_hash="$argon2id$placeholder",
                role="user",
                status="active",
            )
        )
        session.commit()
    cli.main(["create-admin", "--email", "seller@example.com", "--yes"])

    with factory() as session:
        events = list(session.scalars(select(SecurityEventRecord)).all())
    assert [event.event for event in events] == ["admin.bootstrap"]
    assert events[0].event_metadata["previousRole"] == "user"
    assert events[0].event_metadata["role"] == "admin"
    assert events[0].event_metadata["source"] == "cli"


def test_resetting_the_password_revokes_existing_sessions(bootstrap):
    factory, _, tmp_path = bootstrap
    secret = password_file(tmp_path)
    cli.main(["create-admin", "--email", "owner@example.com", "--password-file", secret])
    first_hash = users(factory)[0].password_hash

    new_secret = tmp_path / "replacement-password"
    new_secret.write_text("another operator passphrase entirely\n", encoding="utf-8")
    cli.main(
        [
            "create-admin",
            "--email",
            "owner@example.com",
            "--password-file",
            str(new_secret),
            "--yes",
            "--reset-password",
        ]
    )
    updated = users(factory)[0]
    assert updated.password_hash != first_hash
    assert updated.security_version == 2


def test_a_weak_password_is_refused(bootstrap, tmp_path):
    factory, _, _ = bootstrap
    path = tmp_path / "weak"
    path.write_text("short\n", encoding="utf-8")
    assert (
        cli.main(["create-admin", "--email", "owner@example.com", "--password-file", str(path)])
        == cli.EXIT_USAGE
    )
    assert users(factory) == []


def test_an_invalid_address_is_refused(bootstrap):
    factory, _, tmp_path = bootstrap
    assert (
        cli.main(
            ["create-admin", "--email", "not-an-email", "--password-file", password_file(tmp_path)]
        )
        == cli.EXIT_USAGE
    )
    assert users(factory) == []


def test_production_requires_five_characters_for_admin_bootstrap(bootstrap, monkeypatch, tmp_path):
    factory, _, _ = bootstrap
    monkeypatch.setattr(
        cli,
        "get_settings",
        lambda: Settings(
            environment="production",
            auth_secret="x" * 48,
            auth_cookie_secure=True,
            app_public_origins="https://labels.example",
        ),
    )
    monkeypatch.setattr(
        cli,
        "build_password_service",
        lambda _settings: password_service_from_parameters(
            time_cost=1, memory_kib=8192, parallelism=1, min_length=4, max_bytes=1024
        ),
    )
    path = tmp_path / "short"
    path.write_text("four\n", encoding="utf-8")
    assert (
        cli.main(["create-admin", "--email", "owner@example.com", "--password-file", str(path)])
        == cli.EXIT_USAGE
    )
    assert users(factory) == []

    path.write_text("fives\n", encoding="utf-8")
    assert (
        cli.main(["create-admin", "--email", "owner@example.com", "--password-file", str(path)])
        == cli.EXIT_OK
    )
    assert users(factory)[0].role == "admin"


def test_a_missing_secret_file_exits_without_creating_anything(bootstrap):
    factory, _, tmp_path = bootstrap
    with pytest.raises(SystemExit):
        cli.main(
            [
                "create-admin",
                "--email",
                "owner@example.com",
                "--password-file",
                str(tmp_path / "absent"),
            ]
        )
    assert users(factory) == []


def test_the_cli_never_accepts_a_password_as_an_argument(capsys):
    """A password in argv would land in shell history and the process table."""
    parser = cli.build_parser()
    with pytest.raises(SystemExit):
        parser.parse_args(["create-admin", "--email", "a@b.co", "--password", "secret"])
    assert "unrecognized arguments: --password" in capsys.readouterr().err


def test_there_is_no_default_admin_account(bootstrap):
    factory, _, _ = bootstrap
    assert users(factory) == [], "nothing may exist before the operator acts"
