"""Registration contract: validation, enumeration safety, and role safety."""

from sqlalchemy import func, select

from app.modules.auth.models import UserRecord

EMAIL = "seller@example.com"
PASSWORD = "correct horse battery staple"


def user_count(auth_env) -> int:
    with auth_env.session_factory() as session:
        return session.scalar(select(func.count(UserRecord.id)))


def test_registration_accepts_a_new_account_and_sends_a_verification_link(auth_env):
    response = auth_env.register(EMAIL)
    assert response.status_code == 202
    body = response.json()
    assert body["status"] == "accepted"
    assert body["delivery"] == "sent"
    assert "six-digit verification code" in body["message"]
    assert user_count(auth_env) == 1
    assert auth_env.email.messages[-1].to == EMAIL
    assert "verify-email?token=" in auth_env.email.last_link()
    assert auth_env.email.last_code().isdigit()
    assert len(auth_env.email.last_code()) == 6
    assert auth_env.email.messages[-1].html_body is not None
    assert "SELLERLABEL" in auth_env.email.messages[-1].html_body


def test_registration_never_returns_a_session(auth_env):
    response = auth_env.register(EMAIL)
    assert auth_env.settings.session_cookie_name not in response.cookies
    assert auth_env.session_cookie() is None


def test_a_duplicate_address_is_indistinguishable_from_a_new_one(auth_env):
    first = auth_env.register(EMAIL)
    second = auth_env.register(EMAIL)
    assert first.status_code == second.status_code == 202
    assert first.json() == second.json()
    assert user_count(auth_env) == 1


def test_a_case_variant_address_cannot_create_a_second_account(auth_env):
    assert auth_env.register(EMAIL).status_code == 202
    assert auth_env.register("Seller@EXAMPLE.com").status_code == 202
    assert user_count(auth_env) == 1


def test_the_real_owner_is_told_about_a_duplicate_attempt(auth_env):
    auth_env.register(EMAIL)
    auth_env.register(EMAIL)
    assert "already exists" in auth_env.email.messages[-1].text_body
    assert "token=" not in auth_env.email.messages[-1].text_body


def test_public_registration_cannot_choose_a_role(auth_env):
    response = auth_env.client.post(
        "/api/v1/auth/register",
        json={"email": EMAIL, "password": PASSWORD, "role": "admin"},
    )
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "VALIDATION_ERROR"
    assert user_count(auth_env) == 0


def test_a_registered_account_is_always_an_unverified_active_user(auth_env):
    auth_env.register(EMAIL)
    with auth_env.session_factory() as session:
        user = session.scalar(select(UserRecord))
    assert user.role == "user"
    assert user.status == "active"
    assert user.email_verified_at is None
    assert user.security_version == 1


def test_other_server_owned_fields_are_also_rejected(auth_env):
    for field, value in [
        ("status", "active"),
        ("security_version", 9),
        ("email_verified_at", "2026-01-01T00:00:00Z"),
        ("id", "chosen-id"),
    ]:
        response = auth_env.client.post(
            "/api/v1/auth/register",
            json={"email": EMAIL, "password": PASSWORD, field: value},
        )
        assert response.status_code == 422, field


def test_an_invalid_address_returns_a_field_error(auth_env):
    response = auth_env.register("not-an-email")
    assert response.status_code == 422
    body = response.json()["error"]
    assert body["code"] == "VALIDATION_ERROR"
    assert "email" in body["fields"]


def test_a_short_password_returns_a_field_error_and_no_account(auth_env):
    response = auth_env.register(EMAIL, "short")
    assert response.status_code == 422
    assert "password" in response.json()["error"]["fields"]
    assert user_count(auth_env) == 0


def test_an_oversized_password_is_rejected_without_truncation(auth_env):
    response = auth_env.register(EMAIL, "a" * 5000)
    assert response.status_code == 422
    assert user_count(auth_env) == 0


def test_responses_are_never_cached(auth_env):
    response = auth_env.register(EMAIL)
    assert response.headers["cache-control"] == "no-store"


def test_a_request_id_is_returned_for_correlation(auth_env):
    response = auth_env.register("not-an-email")
    assert response.headers["x-request-id"]
    assert response.json()["error"]["requestId"] == response.headers["x-request-id"]


def test_delivery_is_reported_honestly_when_email_is_disabled(auth_env):
    auth_env.email.set_available(False)
    body = auth_env.register(EMAIL).json()
    assert body["delivery"] == "disabled"
    assert "not configured" in body["message"]
    assert "sent" not in body["message"].lower().split("not configured")[0]


def test_an_audit_row_records_the_registration_without_the_address(auth_env):
    auth_env.register(EMAIL)
    events = [event for event in auth_env.security_events() if "registration" in event.event]
    assert [event.event for event in events] == ["registration.succeeded"]
    assert EMAIL not in str(events[0].event_metadata)
    assert events[0].event_metadata["emailDomain"] == "example.com"


def test_a_duplicate_attempt_is_audited_as_a_conflict(auth_env):
    auth_env.register(EMAIL)
    auth_env.register(EMAIL)
    events = [event.event for event in auth_env.security_events()]
    assert "registration.conflict" in events
