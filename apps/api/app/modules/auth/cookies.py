"""Session and CSRF cookie policy in one place.

Both cookies are host-only (no ``Domain``), scoped to ``Path=/``, and use
``SameSite=Lax``. When ``AUTH_COOKIE_SECURE`` is on, both names carry the
``__Host-`` prefix, which a browser only accepts together with ``Secure``,
``Path=/`` and no ``Domain`` — so the prefix cannot be present without the
protections it implies. Development on plain-HTTP localhost drops the prefix and
``Secure`` instead of weakening the production defaults.

Only the CSRF cookie is readable by JavaScript. The session cookie is always
``HttpOnly``: the session token must never be reachable from page scripts,
``localStorage``, ``sessionStorage``, a URL, or rendered HTML.
"""

from __future__ import annotations

from fastapi import Response

from ...config import Settings

SAME_SITE = "lax"


def set_session_cookie(
    response: Response, *, settings: Settings, token: str, max_age_seconds: int
) -> None:
    response.set_cookie(
        key=settings.session_cookie_name,
        value=token,
        max_age=max_age_seconds,
        httponly=True,
        secure=settings.auth_cookie_secure,
        samesite=SAME_SITE,
        path="/",
    )


def set_csrf_cookie(
    response: Response, *, settings: Settings, token: str, max_age_seconds: int
) -> None:
    response.set_cookie(
        key=settings.csrf_cookie_name,
        value=token,
        max_age=max_age_seconds,
        httponly=False,
        secure=settings.auth_cookie_secure,
        samesite=SAME_SITE,
        path="/",
    )


def clear_auth_cookies(response: Response, *, settings: Settings) -> None:
    """Delete both cookies using the exact attributes they were set with."""
    for name in (settings.session_cookie_name, settings.csrf_cookie_name):
        response.delete_cookie(
            key=name,
            path="/",
            secure=settings.auth_cookie_secure,
            httponly=name == settings.session_cookie_name,
            samesite=SAME_SITE,
        )


def no_store(response: Response) -> None:
    """Authentication and session responses must never be cached."""
    response.headers["Cache-Control"] = "no-store"
    response.headers["Pragma"] = "no-cache"
