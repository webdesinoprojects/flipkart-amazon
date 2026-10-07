"""CSRF token binding and Origin validation, without an HTTP client."""

import pytest
from starlette.datastructures import Headers
from starlette.requests import Request

from app.config import Settings
from app.modules.auth.csrf import (
    assert_csrf_token,
    assert_trusted_origin,
    ensure_csrf_token,
    issue_csrf_token,
    request_origin,
)
from app.modules.auth.errors import CsrfValidationError
from app.modules.auth.models import SessionRecord
from app.platform.clock import utc_now

SETTINGS = Settings(
    environment="test",
    auth_secret="test-only-auth-secret-value-at-least-32-chars",
    app_public_origins="http://localhost:3000,http://localhost:8080",
)


def build_request(
    *, method: str = "POST", headers: dict[str, str] | None = None, cookies: str = ""
) -> Request:
    raw = dict(headers or {})
    if cookies:
        raw["cookie"] = cookies
    scope = {
        "type": "http",
        "method": method,
        "path": "/api/v1/auth/logout",
        "headers": Headers(raw).raw,
        "query_string": b"",
        "state": {},
    }
    return Request(scope)


def new_session() -> SessionRecord:
    now = utc_now()
    return SessionRecord(
        user_id="user-1",
        token_digest="d" * 64,
        created_at=now,
        last_seen_at=now,
        idle_expires_at=now,
        absolute_expires_at=now,
    )


def test_a_matching_header_is_accepted():
    session = new_session()
    token = issue_csrf_token(session, secret=SETTINGS.auth_secret)
    request = build_request(headers={"x-csrf-token": token})
    assert_csrf_token(request, session=session, settings=SETTINGS)


def test_a_missing_header_is_rejected():
    session = new_session()
    issue_csrf_token(session, secret=SETTINGS.auth_secret)
    with pytest.raises(CsrfValidationError):
        assert_csrf_token(build_request(), session=session, settings=SETTINGS)


def test_a_wrong_header_is_rejected():
    session = new_session()
    issue_csrf_token(session, secret=SETTINGS.auth_secret)
    request = build_request(headers={"x-csrf-token": "a" * 48})
    with pytest.raises(CsrfValidationError):
        assert_csrf_token(request, session=session, settings=SETTINGS)


def test_a_token_from_another_session_is_rejected():
    mine = new_session()
    theirs = new_session()
    issue_csrf_token(mine, secret=SETTINGS.auth_secret)
    other_token = issue_csrf_token(theirs, secret=SETTINGS.auth_secret)
    request = build_request(headers={"x-csrf-token": other_token})
    with pytest.raises(CsrfValidationError):
        assert_csrf_token(request, session=mine, settings=SETTINGS)


def test_a_session_without_a_bound_token_cannot_pass():
    session = new_session()
    request = build_request(headers={"x-csrf-token": "a" * 48})
    with pytest.raises(CsrfValidationError):
        assert_csrf_token(request, session=session, settings=SETTINGS)


def test_header_and_cookie_must_agree_when_both_are_present():
    session = new_session()
    token = issue_csrf_token(session, secret=SETTINGS.auth_secret)
    request = build_request(
        headers={"x-csrf-token": token}, cookies=f"{SETTINGS.csrf_cookie_name}=different"
    )
    with pytest.raises(CsrfValidationError):
        assert_csrf_token(request, session=session, settings=SETTINGS)


def test_safe_methods_are_not_checked():
    session = new_session()
    assert_csrf_token(build_request(method="GET"), session=session, settings=SETTINGS)
    assert_trusted_origin(build_request(method="GET"), settings=SETTINGS)


def test_an_allowlisted_origin_passes():
    request = build_request(headers={"origin": "http://localhost:3000"})
    assert_trusted_origin(request, settings=SETTINGS)


@pytest.mark.parametrize(
    "origin",
    [
        "http://evil.test",
        "http://localhost:3000.evil.test",
        "https://localhost:3000",
        "null",
    ],
)
def test_a_foreign_or_null_origin_is_rejected(origin):
    request = build_request(headers={"origin": origin})
    with pytest.raises(CsrfValidationError):
        assert_trusted_origin(request, settings=SETTINGS)


def test_a_mutation_without_origin_or_referer_is_rejected():
    with pytest.raises(CsrfValidationError):
        assert_trusted_origin(build_request(), settings=SETTINGS)


def test_referer_is_reduced_to_an_origin_when_origin_is_absent():
    request = build_request(headers={"referer": "http://localhost:8080/login?next=/dashboard"})
    assert request_origin(request) == "http://localhost:8080"
    assert_trusted_origin(request, settings=SETTINGS)


def test_ensure_returns_the_existing_cookie_value_without_rotating():
    session = new_session()
    token = issue_csrf_token(session, secret=SETTINGS.auth_secret)
    request = build_request(method="GET", cookies=f"{SETTINGS.csrf_cookie_name}={token}")
    returned, rotated = ensure_csrf_token(request, session=session, settings=SETTINGS)
    assert returned == token
    assert rotated is False


def test_ensure_rotates_when_the_cookie_is_missing_or_stale():
    session = new_session()
    issue_csrf_token(session, secret=SETTINGS.auth_secret)
    returned, rotated = ensure_csrf_token(
        build_request(method="GET"), session=session, settings=SETTINGS
    )
    assert rotated is True
    assert len(returned) >= 43
