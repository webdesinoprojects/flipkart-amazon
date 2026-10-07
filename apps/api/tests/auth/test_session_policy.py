"""Session expiry, cookie attributes, and the two-role authorization matrix."""

from datetime import timedelta

import pytest

from app.config import DEVELOPMENT_AUTH_SECRET, Settings
from app.modules.auth.cookies import SAME_SITE
from app.modules.auth.device import UNKNOWN_DEVICE, summarize_device
from app.modules.auth.models import ROLES, SessionRecord
from app.platform.clock import utc_now


def session_at(*, idle_in: int, absolute_in: int) -> SessionRecord:
    now = utc_now()
    return SessionRecord(
        user_id="user-1",
        token_digest="d" * 64,
        idle_expires_at=now + timedelta(seconds=idle_in),
        absolute_expires_at=now + timedelta(seconds=absolute_in),
        created_at=now,
        last_seen_at=now,
    )


def test_the_nearer_of_idle_and_absolute_expiry_wins():
    record = session_at(idle_in=60, absolute_in=600)
    assert record.expires_at() == record.idle_expires_at

    record = session_at(idle_in=600, absolute_in=60)
    assert record.expires_at() == record.absolute_expires_at


def test_an_idle_session_is_not_live_even_within_the_absolute_window():
    record = session_at(idle_in=-1, absolute_in=86400)
    assert record.is_live(utc_now()) is False


def test_an_absolutely_expired_session_is_not_live_even_if_recently_used():
    record = session_at(idle_in=3600, absolute_in=-1)
    assert record.is_live(utc_now()) is False


def test_a_revoked_session_is_never_live():
    record = session_at(idle_in=3600, absolute_in=86400)
    record.revoked_at = utc_now()
    assert record.is_live(utc_now()) is False


def test_there_are_exactly_two_roles_and_no_super_admin():
    assert ROLES == ("user", "admin")
    assert "super_admin" not in ROLES


def test_cookie_names_carry_the_host_prefix_only_when_secure():
    insecure = Settings(environment="test", auth_cookie_secure=False)
    assert insecure.session_cookie_name == "ln_session"
    assert insecure.csrf_cookie_name == "ln_csrf"

    secure = Settings(environment="test", auth_cookie_secure=True)
    assert secure.session_cookie_name == "__Host-ln_session"
    assert secure.csrf_cookie_name == "__Host-ln_csrf"


def test_same_site_is_explicitly_chosen():
    assert SAME_SITE == "lax"


def test_production_refuses_the_development_secret():
    with pytest.raises(ValueError, match="AUTH_SECRET"):
        Settings(
            environment="production",
            auth_secret=DEVELOPMENT_AUTH_SECRET,
            auth_cookie_secure=True,
            app_public_origins="https://labels.example",
        )


def test_production_refuses_an_insecure_cookie():
    with pytest.raises(ValueError, match="AUTH_COOKIE_SECURE"):
        Settings(
            environment="production",
            auth_secret="a" * 48,
            auth_cookie_secure=False,
            app_public_origins="https://labels.example",
        )


def test_production_refuses_a_plain_http_origin():
    with pytest.raises(ValueError, match="APP_PUBLIC_ORIGINS"):
        Settings(
            environment="production",
            auth_secret="a" * 48,
            auth_cookie_secure=True,
            app_public_origins="http://labels.example",
        )


def test_production_refuses_a_short_secret():
    with pytest.raises(ValueError, match="at least 32"):
        Settings(
            environment="production",
            auth_secret="too-short",
            auth_cookie_secure=True,
            app_public_origins="https://labels.example",
        )


def test_a_valid_production_configuration_is_accepted():
    settings = Settings(
        environment="production",
        auth_secret="a" * 48,
        auth_cookie_secure=True,
        app_public_origins="https://labels.example,https://www.labels.example",
    )
    assert settings.primary_origin == "https://labels.example"
    assert settings.allowed_origins == (
        "https://labels.example",
        "https://www.labels.example",
    )


def test_development_defaults_boot_without_any_secret():
    settings = Settings(environment="development")
    assert settings.uses_development_auth_secret is True
    assert settings.auth_cookie_secure is False


def test_device_summary_is_coarse_and_never_the_raw_user_agent():
    raw = (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36"
    )
    summary = summarize_device(raw)
    assert summary == "Chrome on Windows"
    assert "537.36" not in summary
    assert len(summary) <= 80


@pytest.mark.parametrize("value", [None, "", "curl/8.4.0"])
def test_unrecognised_clients_get_a_placeholder(value):
    assert summarize_device(value) == UNKNOWN_DEVICE
