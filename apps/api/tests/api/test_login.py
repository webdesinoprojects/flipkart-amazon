"""Sign-in contract: credentials, enumeration safety, cookies, and fixation."""

from http.cookies import SimpleCookie

EMAIL = "seller@example.com"
PASSWORD = "correct horse battery staple"


def set_cookie_attributes(response, name: str) -> dict[str, str]:
    """Parse the raw Set-Cookie header so attributes can be asserted."""
    for header in response.headers.get_list("set-cookie"):
        jar = SimpleCookie()
        jar.load(header)
        if name in jar:
            morsel = jar[name]
            return {key: value for key, value in morsel.items() if value != ""}
    raise AssertionError(f"No Set-Cookie header for {name!r}")


def test_a_correct_password_signs_the_person_in(auth_env):
    auth_env.register(EMAIL)
    response = auth_env.login(EMAIL)
    assert response.status_code == 200
    body = response.json()
    assert body["user"]["email"] == EMAIL
    assert body["user"]["role"] == "user"
    assert body["csrfToken"]
    assert auth_env.session_cookie()


def test_the_login_response_never_exposes_internal_fields(auth_env):
    auth_env.register(EMAIL)
    body = auth_env.login(EMAIL).json()
    assert set(body["user"]) == {
        "id",
        "email",
        "role",
        "emailVerified",
        "createdAt",
        "lastLoginAt",
    }
    serialized = response_text = str(body)
    for forbidden in ("password", "argon2", "token_digest", "security_version"):
        assert forbidden not in serialized.lower(), forbidden
    assert "csrfToken" in response_text


def test_a_wrong_password_and_an_unknown_account_are_indistinguishable(auth_env):
    auth_env.register(EMAIL)
    wrong = auth_env.login(EMAIL, "wrong password entirely")
    unknown = auth_env.login("nobody@example.com", PASSWORD)
    assert wrong.status_code == unknown.status_code == 401
    assert wrong.json()["error"]["code"] == unknown.json()["error"]["code"]
    assert wrong.json()["error"]["message"] == unknown.json()["error"]["message"]


def test_a_failed_login_sets_no_cookie(auth_env):
    auth_env.register(EMAIL)
    auth_env.login(EMAIL, "wrong password entirely")
    assert auth_env.session_cookie() is None


def test_a_malformed_address_is_also_an_enumeration_safe_401(auth_env):
    response = auth_env.login("not-an-email", PASSWORD)
    assert response.status_code == 401
    assert response.json()["error"]["code"] == "INVALID_CREDENTIALS"


def test_a_suspended_account_is_refused_only_after_the_password_matches(auth_env):
    auth_env.register(EMAIL)
    auth_env.suspend(EMAIL)
    wrong = auth_env.login(EMAIL, "wrong password entirely")
    correct = auth_env.login(EMAIL)
    assert wrong.status_code == 401
    assert wrong.json()["error"]["code"] == "INVALID_CREDENTIALS"
    assert correct.status_code == 403
    assert correct.json()["error"]["code"] == "ACCOUNT_SUSPENDED"


def test_an_unverified_account_can_sign_in_under_the_default_policy(auth_env):
    auth_env.register(EMAIL)
    assert auth_env.login(EMAIL).status_code == 200


def test_an_unverified_account_is_refused_when_verification_is_required(auth_env):
    auth_env.register(EMAIL)
    auth_env.settings.auth_require_verified_email = True
    response = auth_env.login(EMAIL)
    assert response.status_code == 403
    assert response.json()["error"]["code"] == "EMAIL_NOT_VERIFIED"


def test_a_case_variant_address_signs_the_same_account_in(auth_env):
    auth_env.register(EMAIL)
    assert auth_env.login("SELLER@Example.com").status_code == 200


def test_the_session_cookie_is_httponly_lax_and_path_scoped(auth_env):
    auth_env.register(EMAIL)
    response = auth_env.login(EMAIL)
    attributes = set_cookie_attributes(response, auth_env.settings.session_cookie_name)
    assert attributes["httponly"]
    assert attributes["samesite"].lower() == "lax"
    assert attributes["path"] == "/"
    assert "domain" not in attributes
    assert "secure" not in attributes, "development serves plain HTTP localhost"


def test_the_csrf_cookie_is_readable_but_the_session_cookie_is_not(auth_env):
    auth_env.register(EMAIL)
    response = auth_env.login(EMAIL)
    csrf = set_cookie_attributes(response, auth_env.settings.csrf_cookie_name)
    assert "httponly" not in csrf, "the page must be able to read the CSRF value"
    assert csrf["samesite"].lower() == "lax"


def test_production_configuration_sets_secure_and_the_host_prefix(auth_env):
    """Cookie flags follow the setting, so production cannot ship without Secure."""
    auth_env.settings.auth_cookie_secure = True
    auth_env.register(EMAIL)
    response = auth_env.login(EMAIL)
    name = auth_env.settings.session_cookie_name
    assert name == "__Host-ln_session"
    attributes = set_cookie_attributes(response, name)
    assert attributes["secure"]
    assert attributes["httponly"]
    assert attributes["path"] == "/"
    assert "domain" not in attributes


def test_each_login_issues_a_brand_new_session_token(auth_env):
    auth_env.register(EMAIL)
    first = auth_env.login(EMAIL)
    first_token = auth_env.session_cookie()
    auth_env.clear_cookies()
    second = auth_env.login(EMAIL)
    assert first.status_code == second.status_code == 200
    assert auth_env.session_cookie() != first_token


def cookie_value(response, name: str) -> str:
    return set_cookie_attributes(response, name) and _raw_cookie_value(response, name)


def _raw_cookie_value(response, name: str) -> str:
    for header in response.headers.get_list("set-cookie"):
        jar = SimpleCookie()
        jar.load(header)
        if name in jar:
            return jar[name].value
    raise AssertionError(f"No Set-Cookie header for {name!r}")


def test_a_pre_set_session_cookie_is_never_promoted(auth_env):
    """Session fixation: an attacker-chosen cookie value cannot become valid."""
    auth_env.register(EMAIL)
    name = auth_env.settings.session_cookie_name
    planted = "attacker-chosen-session-value-0123456789abcdef"

    response = auth_env.client.post(
        "/api/v1/auth/login",
        json={"email": EMAIL, "password": PASSWORD},
        cookies={name: planted},
    )
    assert response.status_code == 200
    assert _raw_cookie_value(response, name) != planted

    auth_env.clear_cookies()
    assert auth_env.client.get("/api/v1/auth/me", cookies={name: planted}).status_code == 401


def test_login_without_a_browser_origin_is_refused(auth_env):
    auth_env.register(EMAIL)
    response = auth_env.client.post(
        "/api/v1/auth/login",
        json={"email": EMAIL, "password": PASSWORD},
        headers={"Origin": ""},
    )
    assert response.status_code == 403
    assert response.json()["error"]["code"] == "CSRF_FAILED"


def test_login_from_a_foreign_origin_is_refused(auth_env):
    auth_env.register(EMAIL)
    response = auth_env.client.post(
        "/api/v1/auth/login",
        json={"email": EMAIL, "password": PASSWORD},
        headers={"Origin": "http://evil.test"},
    )
    assert response.status_code == 403


def test_login_responses_are_never_cached(auth_env):
    auth_env.register(EMAIL)
    assert auth_env.login(EMAIL).headers["cache-control"] == "no-store"


def test_last_login_is_recorded_and_persists(auth_env):
    auth_env.register(EMAIL)
    at_login = auth_env.login(EMAIL).json()["user"]["lastLoginAt"]
    assert at_login, "the sign-in itself stamps the account"
    assert auth_env.client.get("/api/v1/auth/me").json()["user"]["lastLoginAt"] == at_login


def test_successes_and_failures_are_both_audited(auth_env):
    auth_env.register(EMAIL)
    auth_env.login(EMAIL, "wrong password entirely")
    auth_env.login("nobody@example.com", PASSWORD)
    auth_env.login(EMAIL)
    events = [event.event for event in auth_env.security_events()]
    assert events.count("login.failed") == 2
    assert events.count("login.succeeded") == 1


def test_a_failed_login_audit_row_carries_no_address_or_password(auth_env):
    auth_env.register(EMAIL)
    auth_env.login(EMAIL, "hunter2 hunter2 hunter2")
    failures = [event for event in auth_env.security_events() if event.event == "login.failed"]
    rendered = str([(event.event, event.event_metadata) for event in failures])
    assert EMAIL not in rendered
    assert "hunter2" not in rendered
    assert failures[0].ip_prefix is None, "IP storage is off by default"
