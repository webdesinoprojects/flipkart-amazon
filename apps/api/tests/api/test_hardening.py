"""Malformed input, oversized payloads, dependency failures, and rate limits."""

import pytest

EMAIL = "seller@example.com"
PASSWORD = "correct horse battery staple"


def test_malformed_json_is_a_clean_422_not_a_stack_trace(auth_env):
    response = auth_env.client.post(
        "/api/v1/auth/login",
        content=b"{not json",
        headers={"Content-Type": "application/json"},
    )
    assert response.status_code == 422
    assert "Traceback" not in response.text
    assert response.json()["error"]["code"] == "VALIDATION_ERROR"


def test_a_wrong_content_type_is_rejected(auth_env):
    response = auth_env.client.post(
        "/api/v1/auth/login",
        content=b"email=a&password=b",
        headers={"Content-Type": "application/x-www-form-urlencoded"},
    )
    assert response.status_code in {415, 422}


def test_an_oversized_json_body_is_rejected_before_parsing(auth_env):
    response = auth_env.client.post(
        "/api/v1/auth/login",
        content=b'{"email":"a@b.co","password":"' + b"x" * 200_000 + b'"}',
        headers={"Content-Type": "application/json"},
    )
    assert response.status_code == 413
    assert response.json()["error"]["code"] == "PAYLOAD_TOO_LARGE"


def test_a_missing_body_is_a_validation_error(auth_env):
    response = auth_env.client.post("/api/v1/auth/login")
    assert response.status_code == 422


def test_an_unexpected_server_error_returns_a_generic_message(auth_env, monkeypatch):
    from fastapi.testclient import TestClient

    from app.main import app
    from app.modules.auth import service as service_module
    from tests.conftest import TEST_ORIGIN

    def explode(*args, **kwargs):
        raise RuntimeError("postgresql://labels:labels@postgres:5432/labels connection refused")

    monkeypatch.setattr(service_module.AuthService, "register", explode)
    # The default test client re-raises server exceptions; this one exercises
    # the response a browser would actually receive.
    client = TestClient(app, headers={"Origin": TEST_ORIGIN}, raise_server_exceptions=False)
    response = client.post(
        "/api/v1/auth/register",
        json={"email": EMAIL, "password": PASSWORD},
    )
    assert response.status_code == 500
    body = response.json()["error"]
    assert body["code"] == "INTERNAL_ERROR"
    assert "postgresql" not in response.text
    assert "Traceback" not in response.text
    assert body["requestId"], "support still gets a correlation id"


def test_an_email_provider_failure_does_not_break_registration(auth_env):
    auth_env.email.fail_next = True
    response = auth_env.register(EMAIL)
    assert response.status_code == 202
    assert response.json()["delivery"] == "failed"
    assert auth_env.login(EMAIL).status_code == 200


def test_a_disabled_email_provider_does_not_break_registration(auth_env):
    auth_env.email.set_available(False)
    assert auth_env.register(EMAIL).status_code == 202
    assert auth_env.login(EMAIL).status_code == 200


# --- rate limiting -----------------------------------------------------
def test_login_is_limited_per_account_and_returns_retry_after(auth_env):
    auth_env.register(EMAIL)
    auth_env.limiter.enabled = True
    maximum = auth_env.settings.rate_limit_login_account_max

    for _ in range(maximum):
        assert auth_env.login(EMAIL, "wrong password entirely").status_code == 401

    blocked = auth_env.login(EMAIL, "wrong password entirely")
    assert blocked.status_code == 429
    assert blocked.json()["error"]["code"] == "RATE_LIMITED"
    assert int(blocked.headers["retry-after"]) > 0


def test_a_rate_limited_response_does_not_reveal_whether_the_account_exists(auth_env):
    auth_env.register(EMAIL)
    auth_env.limiter.enabled = True
    maximum = auth_env.settings.rate_limit_login_account_max

    for _ in range(maximum + 1):
        auth_env.login(EMAIL, "wrong password entirely")
    known = auth_env.login(EMAIL, "wrong password entirely")

    for _ in range(maximum + 1):
        auth_env.login("nobody@example.com", "wrong password entirely")
    unknown = auth_env.login("nobody@example.com", "wrong password entirely")

    assert known.status_code == unknown.status_code == 429
    assert known.json()["error"]["message"] == unknown.json()["error"]["message"]


def test_the_correct_password_is_still_blocked_once_the_limit_is_reached(auth_env):
    auth_env.register(EMAIL)
    auth_env.limiter.enabled = True
    for _ in range(auth_env.settings.rate_limit_login_account_max):
        auth_env.login(EMAIL, "wrong password entirely")
    assert auth_env.login(EMAIL).status_code == 429


def test_registration_is_limited_per_ip(auth_env):
    auth_env.limiter.enabled = True
    maximum = auth_env.settings.rate_limit_register_ip_max
    for index in range(maximum):
        assert auth_env.register(f"seller{index}@example.com").status_code == 202
    assert auth_env.register("seller-extra@example.com").status_code == 429


@pytest.mark.parametrize(
    "path", ["/api/v1/auth/password/forgot", "/api/v1/auth/verify-email/request"]
)
def test_email_sending_endpoints_are_limited(auth_env, path):
    auth_env.register(EMAIL)
    auth_env.limiter.enabled = True
    maximum = auth_env.settings.rate_limit_email_account_max
    for _ in range(maximum):
        assert auth_env.client.post(path, json={"email": EMAIL}).status_code == 200
    assert auth_env.client.post(path, json={"email": EMAIL}).status_code == 429


def test_an_unavailable_limiter_fails_open_and_records_the_degradation(auth_env):
    """Documented policy: a broker outage must not lock customers out."""
    auth_env.register(EMAIL)
    auth_env.limiter.enabled = True
    auth_env.limiter.degraded = True
    assert auth_env.login(EMAIL).status_code == 200
    assert "rate_limit.degraded" in [event.event for event in auth_env.security_events()]


def test_admin_bootstrap_is_not_reachable_over_http(auth_env):
    """There must be no route that can grant the admin role."""
    schema = auth_env.client.get("/openapi.json").json()
    for path, operations in schema["paths"].items():
        for method, operation in operations.items():
            rendered = str(operation).lower()
            assert "create-admin" not in path
            assert "promote" not in path
            assert "bootstrap" not in path
            assert '"role"' not in rendered or "admin/access-check" in path, (
                f"{method.upper()} {path} appears to accept a role"
            )
