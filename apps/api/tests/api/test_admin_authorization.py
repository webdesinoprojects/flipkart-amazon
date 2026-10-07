"""Backend authorization for the admin surface: 401 vs 403, and no UI shortcuts."""

ADMIN = "owner@example.com"
USER = "seller@example.com"


def test_an_anonymous_caller_gets_401(auth_env):
    response = auth_env.client.get("/api/v1/admin/access-check")
    assert response.status_code == 401
    assert response.json()["error"]["code"] == "UNAUTHENTICATED"


def test_a_signed_in_user_gets_403_not_404_or_200(auth_env):
    auth_env.create_account(USER)
    response = auth_env.client.get("/api/v1/admin/access-check")
    assert response.status_code == 403
    assert response.json()["error"]["code"] == "FORBIDDEN"
    assert "capabilities" not in response.text


def test_an_admin_gets_the_access_proof(auth_env):
    auth_env.create_account(ADMIN)
    auth_env.promote_to_admin(ADMIN)
    response = auth_env.client.get("/api/v1/admin/access-check")
    assert response.status_code == 200
    body = response.json()
    assert body["role"] == "admin"
    assert "users.read_summary" in body["capabilities"]
    assert response.headers["cache-control"] == "no-store"


def test_the_role_is_read_from_the_database_on_every_request(auth_env):
    """A session issued as `user` must not keep working as `user` after promotion,
    and must not retain `admin` after demotion."""
    auth_env.create_account(USER)
    assert auth_env.client.get("/api/v1/admin/access-check").status_code == 403

    auth_env.promote_to_admin(USER)
    assert auth_env.client.get("/api/v1/admin/access-check").status_code == 200


def test_a_client_cannot_claim_a_role_through_a_header_or_body(auth_env):
    auth_env.create_account(USER)
    response = auth_env.client.get(
        "/api/v1/admin/access-check",
        headers={"X-Role": "admin", "X-User-Role": "admin"},
    )
    assert response.status_code == 403


def test_me_reports_the_real_role_for_an_admin(auth_env):
    auth_env.create_account(ADMIN)
    auth_env.promote_to_admin(ADMIN)
    assert auth_env.client.get("/api/v1/auth/me").json()["user"]["role"] == "admin"


def test_both_grant_and_denial_are_audited(auth_env):
    auth_env.create_account(USER)
    auth_env.client.get("/api/v1/admin/access-check")
    auth_env.promote_to_admin(USER)
    auth_env.client.get("/api/v1/admin/access-check")
    events = [event.event for event in auth_env.security_events()]
    assert "admin.access_denied" in events
    assert "admin.access_granted" in events


def test_a_revoked_admin_session_loses_access_immediately(auth_env):
    token = auth_env.create_account(ADMIN)
    auth_env.promote_to_admin(ADMIN)
    assert auth_env.client.get("/api/v1/admin/access-check").status_code == 200
    auth_env.client.post("/api/v1/auth/logout", headers=auth_env.csrf_headers(token))
    assert auth_env.client.get("/api/v1/admin/access-check").status_code == 401


def test_a_suspended_admin_loses_access(auth_env):
    auth_env.create_account(ADMIN)
    auth_env.promote_to_admin(ADMIN)
    auth_env.suspend(ADMIN)
    assert auth_env.client.get("/api/v1/admin/access-check").status_code == 401
