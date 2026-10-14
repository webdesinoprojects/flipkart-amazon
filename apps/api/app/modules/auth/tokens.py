"""Opaque bearer-token generation and keyed digests.

Session tokens, CSRF tokens, email-verification tokens, and password-reset
tokens are all 256-bit values produced by :func:`secrets.token_urlsafe`. Only a
keyed HMAC-SHA-256 digest of each token is ever stored or logged.

Why a keyed digest and not a slow KDF: the tokens carry 256 bits of entropy, so
there is nothing to brute-force. The HMAC key (``AUTH_SECRET``) means a
read-only database disclosure does not yield usable tokens, and rotating that
key revokes every outstanding session and one-time token at once.
"""

from __future__ import annotations

import hashlib
import hmac
import secrets

TOKEN_BYTES = 32
"""32 random bytes => 256 bits of entropy, 43 URL-safe base64 characters."""

MAX_TOKEN_LENGTH = 512
"""Reject absurd inputs before spending time on a digest."""


def generate_token() -> str:
    """Return a fresh URL-safe opaque token."""
    return secrets.token_urlsafe(TOKEN_BYTES)


def generate_verification_code() -> str:
    """Return a zero-padded six-digit code suitable for cross-device entry."""
    return f"{secrets.randbelow(1_000_000):06d}"


def verification_code_digest(email: str, code: str, *, secret: str) -> str:
    """Bind a short verification code to its canonical email before hashing."""
    return digest_token(f"email-verification-code:{email}:{code}", secret=secret)


def digest_token(token: str, *, secret: str) -> str:
    """Return the hex keyed digest stored in PostgreSQL for ``token``."""
    return hmac.new(
        secret.encode("utf-8"),
        token.encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()


def tokens_match(*, token: str, expected_digest: str, secret: str) -> bool:
    """Constant-time comparison of ``token`` against a stored digest."""
    if not token or not expected_digest or len(token) > MAX_TOKEN_LENGTH:
        return False
    return hmac.compare_digest(digest_token(token, secret=secret), expected_digest)


def looks_like_token(value: str | None) -> bool:
    """Cheap shape check so malformed input never reaches the database."""
    if not value:
        return False
    if len(value) < 16 or len(value) > MAX_TOKEN_LENGTH:
        return False
    return all(character.isalnum() or character in "-_" for character in value)
