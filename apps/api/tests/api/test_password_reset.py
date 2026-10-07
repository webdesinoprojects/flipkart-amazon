"""Forgot/reset password: enumeration resistance, replay, and session revocation."""

EMAIL = "seller@example.com"
OLD_PASSWORD = "correct horse battery staple"
NEW_PASSWORD = "a completely different passphrase"


def forgot(auth_env, email=EMAIL):
    return auth_env.client.post("/api/v1/auth/password/forgot", json={"email": email})


def reset(auth_env, token, password=NEW_PASSWORD):
    return auth_env.client.post(
        "/api/v1/auth/password/reset", json={"token": token, "password": password}
    )


def test_a_reset_link_lets_the_person_choose_a_new_password(auth_env):
    auth_env.register(EMAIL)
    assert forgot(auth_env).status_code == 200
    response = reset(auth_env, auth_env.email.last_token())
    assert response.status_code == 200
    assert response.json()["status"] == "password_updated"

    assert auth_env.login(EMAIL, OLD_PASSWORD).status_code == 401
    assert auth_env.login(EMAIL, NEW_PASSWORD).status_code == 200


def test_an_unknown_address_gets_an_identical_response(auth_env):
    auth_env.register(EMAIL)
    known = forgot(auth_env)
    unknown = forgot(auth_env, "nobody@example.com")
    assert known.status_code == unknown.status_code == 200
    assert known.json() == unknown.json()


def test_a_suspended_account_gets_an_identical_response_and_no_link(auth_env):
    auth_env.register(EMAIL)
    auth_env.suspend(EMAIL)
    sent_before = len(auth_env.email.messages)
    response = forgot(auth_env)
    assert response.status_code == 200
    assert len(auth_env.email.messages) == sent_before


def test_a_reset_token_cannot_be_replayed(auth_env):
    auth_env.register(EMAIL)
    forgot(auth_env)
    token = auth_env.email.last_token()
    assert reset(auth_env, token).status_code == 200
    assert reset(auth_env, token, "yet another different passphrase").status_code == 400
    assert auth_env.login(EMAIL, NEW_PASSWORD).status_code == 200


def test_a_second_request_supersedes_the_first_link(auth_env):
    auth_env.register(EMAIL)
    forgot(auth_env)
    first = auth_env.email.last_token()
    forgot(auth_env)
    second = auth_env.email.last_token()
    assert reset(auth_env, first).status_code == 400
    assert reset(auth_env, second).status_code == 200


def test_an_invalid_token_is_rejected(auth_env):
    assert reset(auth_env, "a" * 43).status_code == 400


def test_an_expired_token_is_rejected(auth_env):
    from datetime import timedelta

    from sqlalchemy import select

    from app.modules.auth.models import OneTimeTokenRecord
    from app.platform.clock import utc_now

    auth_env.register(EMAIL)
    forgot(auth_env)
    token = auth_env.email.last_token()
    with auth_env.session_factory() as session:
        record = session.scalars(
            select(OneTimeTokenRecord).where(OneTimeTokenRecord.purpose == "password_reset")
        ).one()
        record.expires_at = utc_now() - timedelta(seconds=1)
        session.commit()
    response = reset(auth_env, token)
    assert response.status_code == 400
    assert response.json()["error"]["code"] == "EXPIRED_TOKEN"
    assert auth_env.login(EMAIL, OLD_PASSWORD).status_code == 200


def test_a_weak_new_password_is_rejected_and_the_token_survives(auth_env):
    auth_env.register(EMAIL)
    forgot(auth_env)
    token = auth_env.email.last_token()
    response = reset(auth_env, token, "short")
    assert response.status_code == 422
    assert "password" in response.json()["error"]["fields"]
    assert reset(auth_env, token).status_code == 200, "the link is still usable"


def test_a_reset_revokes_every_existing_session(auth_env):
    auth_env.create_account(EMAIL)
    first_cookie = auth_env.session_cookie()
    auth_env.clear_cookies()
    auth_env.login(EMAIL)
    second_cookie = auth_env.session_cookie()

    forgot(auth_env)
    reset(auth_env, auth_env.email.last_token())

    for cookie in (first_cookie, second_cookie):
        auth_env.clear_cookies()
        auth_env.client.cookies.set(auth_env.settings.session_cookie_name, cookie)
        assert auth_env.client.get("/api/v1/auth/me").status_code == 401


def test_a_reset_bumps_the_security_version(auth_env):
    from sqlalchemy import select

    from app.modules.auth.models import UserRecord

    auth_env.register(EMAIL)
    forgot(auth_env)
    reset(auth_env, auth_env.email.last_token())
    with auth_env.session_factory() as session:
        assert session.scalar(select(UserRecord)).security_version == 2


def test_a_reset_verifies_the_address_because_the_email_was_received(auth_env):
    auth_env.register(EMAIL)
    forgot(auth_env)
    reset(auth_env, auth_env.email.last_token())
    assert auth_env.login(EMAIL, NEW_PASSWORD).json()["user"]["emailVerified"] is True


def test_a_reset_invalidates_outstanding_verification_links(auth_env):
    auth_env.register(EMAIL)
    verification_token = auth_env.email.last_token()
    forgot(auth_env)
    reset(auth_env, auth_env.email.last_token())
    stale = auth_env.client.post(
        "/api/v1/auth/verify-email/confirm", json={"token": verification_token}
    )
    assert stale.status_code == 400


def test_the_link_uses_the_configured_origin(auth_env):
    auth_env.register(EMAIL)
    auth_env.client.post(
        "/api/v1/auth/password/forgot",
        json={"email": EMAIL},
        headers={"Host": "evil.test", "Origin": "http://localhost:3000"},
    )
    assert auth_env.email.last_link().startswith(auth_env.settings.primary_origin)


def test_the_whole_flow_is_audited(auth_env):
    auth_env.register(EMAIL)
    forgot(auth_env)
    reset(auth_env, auth_env.email.last_token())
    events = [event.event for event in auth_env.security_events()]
    assert "password_reset.requested" in events
    assert "password_reset.completed" in events
    assert "password.changed" in events


def test_no_audit_row_contains_the_new_password_or_the_token(auth_env):
    auth_env.register(EMAIL)
    forgot(auth_env)
    token = auth_env.email.last_token()
    reset(auth_env, token)
    rendered = str([(event.event, event.event_metadata) for event in auth_env.security_events()])
    assert token not in rendered
    assert NEW_PASSWORD not in rendered
