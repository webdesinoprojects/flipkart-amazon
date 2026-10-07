"""Current-session endpoint, logout, session listing, revocation, and CSRF."""

EMAIL = "seller@example.com"
OTHER = "other@example.com"
PASSWORD = "correct horse battery staple"


def test_me_requires_a_session(auth_env):
    response = auth_env.client.get("/api/v1/auth/me")
    assert response.status_code == 401
    assert response.json()["error"]["code"] == "UNAUTHENTICATED"


def test_me_returns_the_signed_in_account(auth_env):
    auth_env.create_account(EMAIL)
    response = auth_env.client.get("/api/v1/auth/me")
    assert response.status_code == 200
    assert response.json()["user"]["email"] == EMAIL
    assert response.headers["cache-control"] == "no-store"


def test_an_unknown_session_cookie_is_rejected(auth_env):
    auth_env.client.cookies.set(auth_env.settings.session_cookie_name, "a" * 43)
    assert auth_env.client.get("/api/v1/auth/me").status_code == 401


def test_logout_revokes_the_session_and_clears_the_cookies(auth_env):
    token = auth_env.create_account(EMAIL)
    response = auth_env.client.post("/api/v1/auth/logout", headers=auth_env.csrf_headers(token))
    assert response.status_code == 200
    assert response.json() == {"status": "signed_out"}
    assert auth_env.client.get("/api/v1/auth/me").status_code == 401


def test_a_second_logout_is_unauthenticated_not_an_error(auth_env):
    token = auth_env.create_account(EMAIL)
    auth_env.client.post("/api/v1/auth/logout", headers=auth_env.csrf_headers(token))
    repeat = auth_env.client.post("/api/v1/auth/logout", headers=auth_env.csrf_headers(token))
    assert repeat.status_code == 401


def test_a_revoked_session_cookie_stops_working_immediately(auth_env):
    token = auth_env.create_account(EMAIL)
    cookie = auth_env.session_cookie()
    auth_env.client.post("/api/v1/auth/logout", headers=auth_env.csrf_headers(token))
    auth_env.clear_cookies()
    auth_env.client.cookies.set(auth_env.settings.session_cookie_name, cookie)
    assert auth_env.client.get("/api/v1/auth/me").status_code == 401


# --- CSRF ---------------------------------------------------------------
def test_a_mutation_without_a_csrf_header_is_forbidden(auth_env):
    auth_env.create_account(EMAIL)
    response = auth_env.client.post("/api/v1/auth/logout")
    assert response.status_code == 403
    assert response.json()["error"]["code"] == "CSRF_FAILED"
    assert auth_env.client.get("/api/v1/auth/me").status_code == 200, "still signed in"


def test_a_mutation_with_a_wrong_csrf_header_is_forbidden(auth_env):
    auth_env.create_account(EMAIL)
    response = auth_env.client.post("/api/v1/auth/logout", headers=auth_env.csrf_headers("b" * 48))
    assert response.status_code == 403


def test_a_csrf_token_from_another_session_is_forbidden(auth_env):
    auth_env.create_account(OTHER)
    foreign_token = auth_env.client.get("/api/v1/auth/csrf").json()["csrfToken"]
    auth_env.clear_cookies()

    auth_env.create_account(EMAIL)
    response = auth_env.client.post(
        "/api/v1/auth/logout", headers=auth_env.csrf_headers(foreign_token)
    )
    assert response.status_code == 403


def test_a_cross_site_mutation_is_forbidden_even_with_a_valid_token(auth_env):
    token = auth_env.create_account(EMAIL)
    response = auth_env.client.post(
        "/api/v1/auth/logout",
        headers={"X-CSRF-Token": token, "Origin": "http://evil.test"},
    )
    assert response.status_code == 403
    assert auth_env.client.get("/api/v1/auth/me").status_code == 200


def test_a_rejected_csrf_attempt_is_audited(auth_env):
    auth_env.create_account(EMAIL)
    auth_env.client.post("/api/v1/auth/logout")
    assert "csrf.rejected" in [event.event for event in auth_env.security_events()]


def test_csrf_endpoint_returns_nothing_useful_without_a_session(auth_env):
    response = auth_env.client.get("/api/v1/auth/csrf")
    assert response.status_code == 200
    assert response.json() == {"csrfToken": ""}


def test_csrf_endpoint_returns_the_stable_token_for_a_session(auth_env):
    issued = auth_env.create_account(EMAIL)
    first = auth_env.client.get("/api/v1/auth/csrf").json()["csrfToken"]
    second = auth_env.client.get("/api/v1/auth/csrf").json()["csrfToken"]
    assert first == issued, "the login token stays valid"
    assert first == second, "reading must not invalidate an in-flight form"


def test_csrf_is_reissued_when_the_cookie_is_lost(auth_env):
    issued = auth_env.create_account(EMAIL)
    auth_env.client.cookies.delete(auth_env.settings.csrf_cookie_name)
    replacement = auth_env.client.get("/api/v1/auth/csrf").json()["csrfToken"]
    assert replacement != issued
    assert (
        auth_env.client.post(
            "/api/v1/auth/logout", headers=auth_env.csrf_headers(replacement)
        ).status_code
        == 200
    )


# --- session list and revocation ---------------------------------------
def test_sessions_requires_authentication(auth_env):
    assert auth_env.client.get("/api/v1/auth/sessions").status_code == 401


def test_the_session_list_shows_the_current_device(auth_env):
    auth_env.create_account(EMAIL)
    sessions = auth_env.client.get("/api/v1/auth/sessions").json()["sessions"]
    assert len(sessions) == 1
    entry = sessions[0]
    assert entry["current"] is True
    assert entry["deviceSummary"]
    assert set(entry) == {
        "id",
        "deviceSummary",
        "createdAt",
        "lastSeenAt",
        "expiresAt",
        "current",
    }


def test_the_session_list_never_exposes_a_token_or_digest(auth_env):
    auth_env.create_account(EMAIL)
    body = auth_env.client.get("/api/v1/auth/sessions").text
    assert auth_env.session_cookie() not in body
    assert "digest" not in body.lower()


def test_a_second_device_appears_in_the_list(auth_env):
    auth_env.create_account(EMAIL)
    first_cookie = auth_env.session_cookie()
    auth_env.clear_cookies()
    auth_env.login(EMAIL)

    sessions = auth_env.client.get("/api/v1/auth/sessions").json()["sessions"]
    assert len(sessions) == 2
    assert sum(1 for entry in sessions if entry["current"]) == 1

    auth_env.clear_cookies()
    auth_env.client.cookies.set(auth_env.settings.session_cookie_name, first_cookie)
    assert auth_env.client.get("/api/v1/auth/me").status_code == 200


def test_revoking_another_device_signs_only_that_device_out(auth_env):
    auth_env.create_account(EMAIL)
    first_cookie = auth_env.session_cookie()
    auth_env.clear_cookies()
    token = auth_env.login(EMAIL).json()["csrfToken"]

    other = next(
        entry
        for entry in auth_env.client.get("/api/v1/auth/sessions").json()["sessions"]
        if not entry["current"]
    )
    response = auth_env.client.request(
        "DELETE",
        f"/api/v1/auth/sessions/{other['id']}",
        headers=auth_env.csrf_headers(token),
    )
    assert response.status_code == 204
    assert auth_env.client.get("/api/v1/auth/me").status_code == 200

    auth_env.clear_cookies()
    auth_env.client.cookies.set(auth_env.settings.session_cookie_name, first_cookie)
    assert auth_env.client.get("/api/v1/auth/me").status_code == 401


def test_revoking_the_current_session_clears_the_cookies(auth_env):
    token = auth_env.create_account(EMAIL)
    current = auth_env.client.get("/api/v1/auth/sessions").json()["sessions"][0]
    response = auth_env.client.request(
        "DELETE",
        f"/api/v1/auth/sessions/{current['id']}",
        headers=auth_env.csrf_headers(token),
    )
    assert response.status_code == 204
    assert auth_env.client.get("/api/v1/auth/me").status_code == 401


def test_revoking_requires_a_csrf_token(auth_env):
    auth_env.create_account(EMAIL)
    current = auth_env.client.get("/api/v1/auth/sessions").json()["sessions"][0]
    response = auth_env.client.request("DELETE", f"/api/v1/auth/sessions/{current['id']}")
    assert response.status_code == 403


def test_a_user_cannot_revoke_another_users_session(auth_env):
    auth_env.create_account(OTHER)
    victim_cookie = auth_env.session_cookie()
    victim_session = auth_env.client.get("/api/v1/auth/sessions").json()["sessions"][0]
    auth_env.clear_cookies()

    token = auth_env.create_account(EMAIL)
    response = auth_env.client.request(
        "DELETE",
        f"/api/v1/auth/sessions/{victim_session['id']}",
        headers=auth_env.csrf_headers(token),
    )
    assert response.status_code == 404
    assert response.json()["error"]["code"] == "NOT_FOUND"

    auth_env.clear_cookies()
    auth_env.client.cookies.set(auth_env.settings.session_cookie_name, victim_cookie)
    assert auth_env.client.get("/api/v1/auth/me").status_code == 200


def test_revoking_an_unknown_session_is_a_plain_404(auth_env):
    token = auth_env.create_account(EMAIL)
    response = auth_env.client.request(
        "DELETE",
        "/api/v1/auth/sessions/00000000-0000-0000-0000-000000000000",
        headers=auth_env.csrf_headers(token),
    )
    assert response.status_code == 404


def test_revocation_is_audited(auth_env):
    token = auth_env.create_account(EMAIL)
    current = auth_env.client.get("/api/v1/auth/sessions").json()["sessions"][0]
    auth_env.client.request(
        "DELETE",
        f"/api/v1/auth/sessions/{current['id']}",
        headers=auth_env.csrf_headers(token),
    )
    assert "session.revoked" in [event.event for event in auth_env.security_events()]
