"""Email verification: request, confirm, resend supersession, and replay."""

EMAIL = "seller@example.com"


def request_verification(auth_env, email=EMAIL):
    return auth_env.client.post("/api/v1/auth/verify-email/request", json={"email": email})


def confirm(auth_env, token):
    return auth_env.client.post("/api/v1/auth/verify-email/confirm", json={"token": token})


def test_registration_already_sends_a_usable_verification_link(auth_env):
    auth_env.register(EMAIL)
    response = confirm(auth_env, auth_env.email.last_token())
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "verified"
    assert body["user"]["emailVerified"] is True


def test_a_resend_produces_a_new_working_link(auth_env):
    auth_env.register(EMAIL)
    assert request_verification(auth_env).status_code == 200
    assert confirm(auth_env, auth_env.email.last_token()).status_code == 200


def test_a_resend_supersedes_the_previous_link(auth_env):
    auth_env.register(EMAIL)
    first_token = auth_env.email.last_token()
    request_verification(auth_env)
    second_token = auth_env.email.last_token()
    assert first_token != second_token

    stale = confirm(auth_env, first_token)
    assert stale.status_code == 400
    assert confirm(auth_env, second_token).status_code == 200


def test_a_token_cannot_be_replayed(auth_env):
    auth_env.register(EMAIL)
    token = auth_env.email.last_token()
    assert confirm(auth_env, token).status_code == 200
    replay = confirm(auth_env, token)
    assert replay.status_code == 400
    assert replay.json()["error"]["code"] in {"EXPIRED_TOKEN", "INVALID_TOKEN"}


def test_an_unknown_token_is_rejected_without_detail(auth_env):
    response = confirm(auth_env, "a" * 43)
    assert response.status_code == 400
    assert response.json()["error"]["code"] == "INVALID_TOKEN"


def test_a_malformed_token_is_rejected_before_any_lookup(auth_env):
    assert confirm(auth_env, "short").status_code == 422
    assert confirm(auth_env, "has spaces in it and is long enough").status_code == 400


def test_an_expired_token_is_rejected(auth_env):
    from datetime import timedelta

    from sqlalchemy import select

    from app.modules.auth.models import OneTimeTokenRecord
    from app.platform.clock import utc_now

    auth_env.register(EMAIL)
    token = auth_env.email.last_token()
    with auth_env.session_factory() as session:
        record = session.scalar(select(OneTimeTokenRecord))
        record.expires_at = utc_now() - timedelta(seconds=1)
        session.commit()

    response = confirm(auth_env, token)
    assert response.status_code == 400
    assert response.json()["error"]["code"] == "EXPIRED_TOKEN"


def test_requesting_for_an_unknown_address_looks_identical(auth_env):
    auth_env.register(EMAIL)
    known = request_verification(auth_env)
    unknown = request_verification(auth_env, "nobody@example.com")
    assert known.status_code == unknown.status_code == 200
    assert known.json() == unknown.json()


def test_requesting_for_an_already_verified_address_looks_identical(auth_env):
    auth_env.register(EMAIL)
    confirm(auth_env, auth_env.email.last_token())
    sent_before = len(auth_env.email.messages)
    response = request_verification(auth_env)
    assert response.status_code == 200
    assert len(auth_env.email.messages) == sent_before, "no new link is issued"


def test_the_link_uses_the_configured_origin_not_the_request_host(auth_env):
    auth_env.client.post(
        "/api/v1/auth/register",
        json={"email": EMAIL, "password": auth_env.DEFAULT_PASSWORD},
        headers={"Host": "evil.test", "Origin": "http://localhost:3000"},
    )
    link = auth_env.email.last_link()
    assert link.startswith(auth_env.settings.primary_origin)
    assert "evil.test" not in link


def test_delivery_is_reported_honestly_when_email_is_disabled(auth_env):
    auth_env.register(EMAIL)
    auth_env.email.set_available(False)
    body = request_verification(auth_env).json()
    assert body["delivery"] == "disabled"
    assert "not configured" in body["message"]


def test_a_delivery_failure_still_returns_a_generic_response(auth_env):
    auth_env.register(EMAIL)
    auth_env.email.fail_next = True
    response = request_verification(auth_env)
    assert response.status_code == 200
    assert response.json()["delivery"] == "failed"


def test_requests_and_confirmations_are_audited(auth_env):
    auth_env.register(EMAIL)
    confirm(auth_env, auth_env.email.last_token())
    confirm(auth_env, "a" * 43)
    events = [event.event for event in auth_env.security_events()]
    assert "email_verification.confirmed" in events
    assert "email_verification.rejected" in events


def test_no_audit_row_contains_a_token(auth_env):
    auth_env.register(EMAIL)
    token = auth_env.email.last_token()
    confirm(auth_env, token)
    rendered = str([(event.event, event.event_metadata) for event in auth_env.security_events()])
    assert token not in rendered
