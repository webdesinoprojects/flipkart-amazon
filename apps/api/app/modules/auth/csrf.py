"""CSRF protection for cookie-authenticated mutations.

Pattern: a **session-bound synchronizer token**. The server generates a 256-bit
random value, stores only its keyed digest on the session row, and hands the raw
value to the browser in a non-``HttpOnly`` cookie. Every mutation must repeat
that value in the ``X-CSRF-Token`` header, which a cross-site page cannot read
or set. Comparison uses :func:`hmac.compare_digest` through
:mod:`app.modules.auth.tokens`.

This is stronger than a stateless double-submit cookie because the authority
lives on the server, and it needs no bespoke algorithm. ``Origin`` (falling back
to ``Referer``) is checked against the configured application origins on every
mutation as a second, independent control. CORS is never relied on: the
deployment is same-origin and no credentialed wildcard origin is configured.
"""

from __future__ import annotations

from fastapi import Request

from ...config import Settings, origin_of
from .errors import CsrfValidationError
from .models import SessionRecord
from .tokens import generate_token, looks_like_token, tokens_match

CSRF_HEADER = "x-csrf-token"
SAFE_METHODS = frozenset({"GET", "HEAD", "OPTIONS", "TRACE"})


def issue_csrf_token(session: SessionRecord, *, secret: str) -> str:
    """Generate a fresh CSRF token and bind its digest to ``session``."""
    from .tokens import digest_token

    token = generate_token()
    session.csrf_token_digest = digest_token(token, secret=secret)
    return token


def ensure_csrf_token(
    request: Request, *, session: SessionRecord, settings: Settings
) -> tuple[str, bool]:
    """Return ``(token, rotated)`` for this session.

    The raw token is only ever held by the browser cookie, so when the cookie
    already matches the stored digest it is returned unchanged. Rotating on
    every read would invalidate a token a page had already fetched and break an
    in-flight form submission, so rotation happens only when the cookie is
    missing, malformed, or no longer bound to the session.
    """
    cookie_value = (request.cookies.get(settings.csrf_cookie_name) or "").strip()
    if (
        looks_like_token(cookie_value)
        and session.csrf_token_digest
        and tokens_match(
            token=cookie_value,
            expected_digest=session.csrf_token_digest,
            secret=settings.auth_secret,
        )
    ):
        return cookie_value, False
    return issue_csrf_token(session, secret=settings.auth_secret), True


def request_origin(request: Request) -> str:
    """The origin a browser attributes to this request, or an empty string."""
    origin = (request.headers.get("origin") or "").strip()
    if origin and origin != "null":
        return origin.rstrip("/")
    referer = (request.headers.get("referer") or "").strip()
    return origin_of(referer)


def assert_trusted_origin(request: Request, *, settings: Settings) -> None:
    """Reject a mutation whose browser origin is not an application origin.

    A missing ``Origin`` and ``Referer`` is treated as untrusted for mutations.
    Modern browsers send ``Origin`` on every cross-origin and same-origin
    state-changing request, so the only callers without one are non-browser
    clients, which must use the documented origin header.
    """
    if request.method.upper() in SAFE_METHODS:
        return
    origin = request_origin(request)
    if not origin or origin not in settings.allowed_origins:
        raise CsrfValidationError(
            "This request did not come from the application. Reload the page and try again."
        )


def assert_csrf_token(request: Request, *, session: SessionRecord, settings: Settings) -> None:
    """Verify the ``X-CSRF-Token`` header against the session's stored digest."""
    if request.method.upper() in SAFE_METHODS:
        return
    supplied = (request.headers.get(CSRF_HEADER) or "").strip()
    cookie_value = (request.cookies.get(settings.csrf_cookie_name) or "").strip()
    if not looks_like_token(supplied) or not session.csrf_token_digest:
        raise CsrfValidationError()
    if cookie_value and cookie_value != supplied:
        # Header and cookie disagreeing means the page is not the one that was
        # issued the token; fail rather than trusting the header alone.
        raise CsrfValidationError()
    if not tokens_match(
        token=supplied,
        expected_digest=session.csrf_token_digest,
        secret=settings.auth_secret,
    ):
        raise CsrfValidationError()
