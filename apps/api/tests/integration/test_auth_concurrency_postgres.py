"""Races that only a real database can decide.

Each test runs genuine concurrent transactions against PostgreSQL. These cannot
be replaced by mocks: the point is that a unique index, a conditional UPDATE, or
row locking — not application code — picks the winner.
"""

from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta

import pytest
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError

from app.modules.auth.cleanup import purge_expired_auth_rows
from app.modules.auth.models import OneTimeTokenRecord, SessionRecord, UserRecord
from app.modules.auth.repository import AuthRepository
from app.modules.auth.tokens import digest_token, generate_token
from app.platform.clock import utc_now
from tests.integration.conftest import requires_postgres

pytestmark = requires_postgres

SECRET = "integration-only-auth-secret-at-least-32-characters"
CANONICAL = "seller@example.com"


def make_user(session, *, email: str = CANONICAL, role: str = "user") -> UserRecord:
    user = UserRecord(
        email_display=email,
        email_canonical=email,
        password_hash="$argon2id$placeholder",
        role=role,
        status="active",
    )
    session.add(user)
    session.commit()
    return user


def make_token(session, user_id: str, *, purpose: str, ttl_seconds: int = 900) -> str:
    token = generate_token()
    now = utc_now()
    session.add(
        OneTimeTokenRecord(
            user_id=user_id,
            purpose=purpose,
            token_digest=digest_token(token, secret=SECRET),
            created_at=now,
            expires_at=now + timedelta(seconds=ttl_seconds),
        )
    )
    session.commit()
    return token


def test_normalized_email_uniqueness_holds_under_concurrent_inserts(migrated_postgres):
    _, factory, _ = migrated_postgres

    def attempt(_index: int) -> str:
        with factory() as session:
            session.add(
                UserRecord(
                    email_display=CANONICAL,
                    email_canonical=CANONICAL,
                    password_hash="$argon2id$placeholder",
                    role="user",
                    status="active",
                )
            )
            try:
                session.commit()
                return "created"
            except IntegrityError:
                session.rollback()
                return "conflict"

    with ThreadPoolExecutor(max_workers=8) as pool:
        outcomes = list(pool.map(attempt, range(8)))

    assert outcomes.count("created") == 1
    assert outcomes.count("conflict") == 7
    with factory() as session:
        assert session.scalar(select(func.count(UserRecord.id))) == 1


def test_a_case_variant_address_also_collides(migrated_postgres):
    _, factory, _ = migrated_postgres
    with factory() as session:
        make_user(session)
    with factory() as session:
        session.add(
            UserRecord(
                email_display="Seller@Example.com",
                email_canonical=CANONICAL,
                password_hash="$argon2id$placeholder",
                role="user",
                status="active",
            )
        )
        with pytest.raises(IntegrityError):
            session.commit()


@pytest.mark.parametrize("purpose", ["email_verification", "password_reset"])
def test_a_one_time_token_is_consumed_exactly_once_under_concurrency(migrated_postgres, purpose):
    _, factory, _ = migrated_postgres
    with factory() as session:
        user = make_user(session)
        token = make_token(session, user.id, purpose=purpose)
    digest = digest_token(token, secret=SECRET)

    def attempt(_index: int) -> str | None:
        with factory() as session:
            owner = AuthRepository(session).consume_one_time_token(
                digest, purpose=purpose, now=utc_now()
            )
            session.commit()
            return owner

    with ThreadPoolExecutor(max_workers=8) as pool:
        results = list(pool.map(attempt, range(8)))

    assert sum(1 for result in results if result is not None) == 1


def test_a_session_revoke_beats_a_concurrent_touch(migrated_postgres):
    """The conditional UPDATE means a touch cannot resurrect a revoked session."""
    _, factory, _ = migrated_postgres
    token = generate_token()
    now = utc_now()
    with factory() as session:
        user = make_user(session)
        record = SessionRecord(
            user_id=user.id,
            token_digest=digest_token(token, secret=SECRET),
            security_version=user.security_version,
            created_at=now,
            last_seen_at=now,
            idle_expires_at=now + timedelta(hours=1),
            absolute_expires_at=now + timedelta(days=1),
        )
        session.add(record)
        session.commit()
        session_id, user_id = record.id, user.id

    def revoke() -> bool:
        with factory() as session:
            result = AuthRepository(session).revoke_session(
                session_id, user_id=user_id, now=utc_now(), reason="user_revoked"
            )
            session.commit()
            return result

    def touch() -> None:
        with factory() as session:
            AuthRepository(session).touch_session(session_id, now=utc_now(), idle_seconds=3600)
            session.commit()

    with ThreadPoolExecutor(max_workers=2) as pool:
        revoked = pool.submit(revoke)
        pool.submit(touch)
        assert revoked.result() is True

    with factory() as session:
        lookup = AuthRepository(session).find_live_session_by_digest(
            digest_token(token, secret=SECRET), now=utc_now()
        )
    assert lookup is None, "a revoked session must never resolve again"


def test_only_one_of_two_concurrent_revocations_reports_success(migrated_postgres):
    _, factory, _ = migrated_postgres
    now = utc_now()
    with factory() as session:
        user = make_user(session)
        record = SessionRecord(
            user_id=user.id,
            token_digest=digest_token(generate_token(), secret=SECRET),
            security_version=1,
            created_at=now,
            last_seen_at=now,
            idle_expires_at=now + timedelta(hours=1),
            absolute_expires_at=now + timedelta(days=1),
        )
        session.add(record)
        session.commit()
        session_id, user_id = record.id, user.id

    def revoke(_index: int) -> bool:
        with factory() as session:
            result = AuthRepository(session).revoke_session(
                session_id, user_id=user_id, now=utc_now(), reason="user_revoked"
            )
            session.commit()
            return result

    with ThreadPoolExecutor(max_workers=4) as pool:
        assert sum(pool.map(revoke, range(4))) == 1


def test_a_password_reset_revokes_every_session_atomically(migrated_postgres):
    _, factory, _ = migrated_postgres
    now = utc_now()
    with factory() as session:
        user = make_user(session)
        for _ in range(5):
            session.add(
                SessionRecord(
                    user_id=user.id,
                    token_digest=digest_token(generate_token(), secret=SECRET),
                    security_version=user.security_version,
                    created_at=now,
                    last_seen_at=now,
                    idle_expires_at=now + timedelta(hours=1),
                    absolute_expires_at=now + timedelta(days=1),
                )
            )
        session.commit()
        user_id = user.id

    with factory() as session:
        repository = AuthRepository(session)
        revoked = repository.revoke_all_sessions(user_id, now=utc_now(), reason="password_reset")
        session.get(UserRecord, user_id).security_version += 1
        session.commit()

    assert revoked == 5
    with factory() as session:
        assert AuthRepository(session).list_live_sessions(user_id, now=utc_now()) == []


def test_a_security_version_bump_alone_invalidates_a_surviving_session(
    migrated_postgres,
):
    """Defence in depth: even an unrevoked row stops resolving after a bump."""
    _, factory, _ = migrated_postgres
    token = generate_token()
    now = utc_now()
    with factory() as session:
        user = make_user(session)
        session.add(
            SessionRecord(
                user_id=user.id,
                token_digest=digest_token(token, secret=SECRET),
                security_version=user.security_version,
                created_at=now,
                last_seen_at=now,
                idle_expires_at=now + timedelta(hours=1),
                absolute_expires_at=now + timedelta(days=1),
            )
        )
        session.commit()
        user_id = user.id

    with factory() as session:
        assert AuthRepository(session).find_live_session_by_digest(
            digest_token(token, secret=SECRET), now=utc_now()
        )

    with factory() as session:
        session.get(UserRecord, user_id).security_version += 1
        session.commit()

    with factory() as session:
        assert (
            AuthRepository(session).find_live_session_by_digest(
                digest_token(token, secret=SECRET), now=utc_now()
            )
            is None
        )


def test_public_registration_cannot_produce_an_admin_row(migrated_postgres):
    """The check constraint plus the service's fixed role are both enforced."""
    from app.config import Settings
    from app.modules.auth.passwords import password_service_from_parameters
    from app.modules.auth.service import AuthService, RequestContext

    _, factory, _ = migrated_postgres
    settings = Settings(environment="test", auth_secret=SECRET)
    passwords = password_service_from_parameters(
        time_cost=1, memory_kib=8192, parallelism=1, min_length=10, max_bytes=1024
    )
    with factory() as session:
        service = AuthService(session=session, settings=settings, passwords=passwords)
        outcome = service.register(
            email="newcomer@example.com",
            password="correct horse battery staple",
            context=RequestContext(),
        )
        session.commit()
        assert outcome.user.role == "user"
        assert (
            session.scalar(select(func.count(UserRecord.id)).where(UserRecord.role == "admin")) == 0
        )


def test_an_invalid_role_is_refused_by_the_database(migrated_postgres):
    _, factory, _ = migrated_postgres
    with factory() as session:
        session.add(
            UserRecord(
                email_display="rogue@example.com",
                email_canonical="rogue@example.com",
                password_hash="$argon2id$placeholder",
                role="super_admin",
                status="active",
            )
        )
        with pytest.raises(IntegrityError):
            session.commit()


def test_expired_cleanup_is_idempotent(migrated_postgres):
    _, factory, _ = migrated_postgres
    old = utc_now() - timedelta(days=30)
    with factory() as session:
        user = make_user(session)
        session.add(
            SessionRecord(
                user_id=user.id,
                token_digest=digest_token(generate_token(), secret=SECRET),
                security_version=1,
                created_at=old,
                last_seen_at=old,
                idle_expires_at=old,
                absolute_expires_at=old,
            )
        )
        session.add(
            OneTimeTokenRecord(
                user_id=user.id,
                purpose="password_reset",
                token_digest=digest_token(generate_token(), secret=SECRET),
                created_at=old,
                expires_at=old,
            )
        )
        session.commit()

    with factory() as session:
        first = purge_expired_auth_rows(session, retain_seconds=60)
    with factory() as session:
        second = purge_expired_auth_rows(session, retain_seconds=60)

    assert (first.sessions_removed, first.tokens_removed) == (1, 1)
    assert (second.sessions_removed, second.tokens_removed) == (0, 0)


def test_cleanup_leaves_live_rows_alone(migrated_postgres):
    _, factory, _ = migrated_postgres
    now = utc_now()
    with factory() as session:
        user = make_user(session)
        session.add(
            SessionRecord(
                user_id=user.id,
                token_digest=digest_token(generate_token(), secret=SECRET),
                security_version=1,
                created_at=now,
                last_seen_at=now,
                idle_expires_at=now + timedelta(hours=1),
                absolute_expires_at=now + timedelta(days=1),
            )
        )
        session.commit()
        user_id = user.id

    with factory() as session:
        report = purge_expired_auth_rows(session, retain_seconds=60)
    assert report.sessions_removed == 0
    with factory() as session:
        assert len(AuthRepository(session).list_live_sessions(user_id, now=utc_now())) == 1
