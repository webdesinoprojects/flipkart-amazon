from collections.abc import Iterator
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.capabilities.email.provider import EmailDeliveryError, EmailMessage
from app.config import Settings
from app.database import Base, get_session
from app.dependencies import (
    get_email_provider,
    get_password_service,
    get_queue,
    get_rate_limiter,
    get_storage,
    settings_dependency,
)
from app.main import app
from app.models_registry import import_all_models
from app.modules.auth.passwords import password_service_from_parameters
from app.platform.rate_limit.limiter import RateLimiter
from app.providers.storage import LocalTempStorage

TEST_ORIGIN = "http://localhost:3000"
TEST_AUTH_SECRET = "test-only-auth-secret-value-at-least-32-chars"

import_all_models()


class FakeQueue:
    id = "fake"

    def __init__(self):
        self.document_ids: list[str] = []

    def enqueue_document(self, document_id: str) -> str:
        self.document_ids.append(document_id)
        return "test-task"


class CapturingEmailProvider:
    """Collects messages instead of sending them.

    ``available`` and ``fail_next`` let a test exercise the disabled-delivery
    and failed-delivery branches without a real SMTP server.
    """

    id = "capturing"

    def __init__(self, *, available: bool = True) -> None:
        self.messages: list[EmailMessage] = []
        self._available = available
        self.fail_next = False

    @property
    def available(self) -> bool:
        return self._available

    def set_available(self, value: bool) -> None:
        self._available = value

    def send(self, message: EmailMessage) -> None:
        self.messages.append(message)
        if self.fail_next:
            self.fail_next = False
            raise EmailDeliveryError("injected failure")

    def last_link(self) -> str:
        """Extract the single URL from the most recent message body."""
        body = self.messages[-1].text_body
        for word in body.split():
            if word.startswith("http"):
                return word
        raise AssertionError("No link found in the captured email.")

    def last_token(self) -> str:
        link = self.last_link()
        return link.split("token=", 1)[1]


class CountingRateLimiter(RateLimiter):
    """In-test limiter with a controllable clock and no Valkey dependency.

    Deliberately not an in-process production fallback: it exists only so the
    suite can assert the exact request that trips a boundary.
    """

    def __init__(self, *, secret: str) -> None:
        super().__init__(client=None, secret=secret, enabled=False)
        self.counts: dict[tuple[str, str], int] = {}
        self.enabled = False
        self.degraded = False

    @property
    def available(self) -> bool:
        return self.enabled and not self.degraded

    def check(self, rule, identifier, *, now):  # type: ignore[override]
        from app.platform.rate_limit.limiter import ALLOWED_UNLIMITED, RateLimitDecision

        if not self.enabled or not identifier:
            return ALLOWED_UNLIMITED
        if self.degraded:
            return RateLimitDecision(
                allowed=True, bucket=rule.bucket, retry_after_seconds=0, degraded=True
            )
        key = (rule.bucket, identifier)
        self.counts[key] = self.counts.get(key, 0) + 1
        if self.counts[key] > rule.max_requests:
            return RateLimitDecision(
                allowed=False, bucket=rule.bucket, retry_after_seconds=rule.window_seconds
            )
        return RateLimitDecision(allowed=True, bucket=rule.bucket, retry_after_seconds=0)


def build_test_settings(tmp_path: Path, **overrides) -> Settings:
    values = {
        "environment": "test",
        "database_url": "sqlite+pysqlite:///:memory:",
        "local_storage_root": tmp_path,
        "max_file_bytes": 4096,
        "auth_secret": TEST_AUTH_SECRET,
        "app_public_origins": f"{TEST_ORIGIN},http://localhost:8080",
        # Argon2 is deliberately cheap in tests. Production parameters are
        # asserted separately in tests/auth/test_passwords.py.
        "auth_argon2_time_cost": 1,
        "auth_argon2_memory_kib": 8192,
        "auth_argon2_parallelism": 1,
        "rate_limit_enabled": False,
    }
    values.update(overrides)
    return Settings(**values)


@pytest.fixture
def client(tmp_path: Path):
    engine = create_engine(
        "sqlite+pysqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    TestingSession = sessionmaker(bind=engine, expire_on_commit=False)
    Base.metadata.create_all(engine)
    settings = build_test_settings(tmp_path)
    storage = LocalTempStorage(tmp_path)
    queue = FakeQueue()

    def session_override():
        with TestingSession() as session:
            yield session

    app.dependency_overrides[get_session] = session_override
    app.dependency_overrides[settings_dependency] = lambda: settings
    app.dependency_overrides[get_storage] = lambda: storage
    app.dependency_overrides[get_queue] = lambda: queue
    test_client = TestClient(app)
    yield test_client, queue, tmp_path
    test_client.close()
    app.dependency_overrides.clear()


@pytest.fixture
def auth_env(tmp_path: Path) -> Iterator["AuthEnvironment"]:
    """A full authentication stack wired to a throwaway SQLite database."""
    engine = create_engine(
        "sqlite+pysqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    TestingSession = sessionmaker(bind=engine, expire_on_commit=False)
    Base.metadata.create_all(engine)
    settings = build_test_settings(tmp_path)
    passwords = password_service_from_parameters(
        time_cost=1,
        memory_kib=8192,
        parallelism=1,
        min_length=settings.auth_password_min_length,
        max_bytes=settings.auth_password_max_bytes,
    )
    email_provider = CapturingEmailProvider()
    limiter = CountingRateLimiter(secret=settings.auth_secret)

    def session_override():
        with TestingSession() as session:
            yield session

    app.dependency_overrides[get_session] = session_override
    app.dependency_overrides[settings_dependency] = lambda: settings
    app.dependency_overrides[get_password_service] = lambda: passwords
    app.dependency_overrides[get_email_provider] = lambda: email_provider
    app.dependency_overrides[get_rate_limiter] = lambda: limiter
    storage = LocalTempStorage(tmp_path)
    queue = FakeQueue()
    app.dependency_overrides[get_storage] = lambda: storage
    app.dependency_overrides[get_queue] = lambda: queue

    test_client = TestClient(app, headers={"Origin": TEST_ORIGIN})
    environment = AuthEnvironment(
        client=test_client,
        settings=settings,
        email=email_provider,
        limiter=limiter,
        session_factory=TestingSession,
        passwords=passwords,
        engine=engine,
        storage_root=tmp_path,
        queue=queue,
    )
    yield environment
    test_client.close()
    app.dependency_overrides.clear()


class AuthEnvironment:
    """Test helper that drives the real HTTP surface, not internal functions."""

    DEFAULT_PASSWORD = "correct horse battery staple"

    def __init__(
        self,
        *,
        client,
        settings,
        email,
        limiter,
        session_factory,
        passwords,
        engine,
        storage_root,
        queue,
    ) -> None:
        self.client = client
        self.settings = settings
        self.email = email
        self.limiter = limiter
        self.session_factory = session_factory
        self.passwords = passwords
        self.engine = engine
        self.storage_root = storage_root
        self.queue = queue

    # --- flows ----------------------------------------------------------
    def register(self, email: str, password: str | None = None, **kwargs):
        return self.client.post(
            "/api/v1/auth/register",
            json={"email": email, "password": password or self.DEFAULT_PASSWORD},
            **kwargs,
        )

    def login(self, email: str, password: str | None = None, **kwargs):
        return self.client.post(
            "/api/v1/auth/login",
            json={"email": email, "password": password or self.DEFAULT_PASSWORD},
            **kwargs,
        )

    def create_account(self, email: str, password: str | None = None) -> str:
        """Register and sign in, returning the CSRF token for mutations."""
        assert self.register(email, password).status_code == 202
        response = self.login(email, password)
        assert response.status_code == 200, response.text
        return response.json()["csrfToken"]

    def csrf_headers(self, token: str) -> dict[str, str]:
        return {"X-CSRF-Token": token}

    def promote_to_admin(self, email: str) -> None:
        from app.modules.auth.email_address import normalize_email
        from app.modules.auth.repository import AuthRepository

        canonical = normalize_email(email).canonical
        with self.session_factory() as session:
            user = AuthRepository(session).find_user_by_canonical_email(canonical)
            assert user is not None
            user.role = "admin"
            session.commit()

    def suspend(self, email: str) -> None:
        from app.modules.auth.email_address import normalize_email
        from app.modules.auth.repository import AuthRepository

        canonical = normalize_email(email).canonical
        with self.session_factory() as session:
            user = AuthRepository(session).find_user_by_canonical_email(canonical)
            assert user is not None
            user.status = "suspended"
            session.commit()

    def security_events(self) -> list:
        from sqlalchemy import select

        from app.modules.audit.models import SecurityEventRecord

        with self.session_factory() as session:
            return list(
                session.scalars(select(SecurityEventRecord).order_by(SecurityEventRecord.id)).all()
            )

    def session_cookie(self) -> str | None:
        return self.client.cookies.get(self.settings.session_cookie_name)

    def clear_cookies(self) -> None:
        self.client.cookies.clear()
