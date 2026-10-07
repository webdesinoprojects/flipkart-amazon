"""Privacy-preserving rate-limit key construction.

Identifiers are hashed before they become Valkey keys so that reading the
broker's keyspace never discloses which email addresses tried to sign in or
which IP addresses a person used. The hash is keyed with ``AUTH_SECRET`` so the
mapping cannot be rebuilt by hashing a candidate list offline.
"""

from __future__ import annotations

import hashlib
import hmac

KEY_NAMESPACE = "rl:v1"
_DIGEST_LENGTH = 32


def hashed_identifier(identifier: str, *, secret: str) -> str:
    """Return a short keyed digest for ``identifier``."""
    digest = hmac.new(secret.encode("utf-8"), identifier.encode("utf-8"), hashlib.sha256)
    return digest.hexdigest()[:_DIGEST_LENGTH]


def bucket_key(*, bucket: str, identifier: str, window_start: int, secret: str) -> str:
    """Build the Valkey key for one fixed window of one bucket."""
    return f"{KEY_NAMESPACE}:{bucket}:{hashed_identifier(identifier, secret=secret)}:{window_start}"
