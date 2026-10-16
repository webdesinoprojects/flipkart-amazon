"""Recording and redaction rules for security audit events."""
# ruff: noqa: S105 - these are audit event names, never credentials

from __future__ import annotations

import ipaddress
import re
from typing import Any, Final

from sqlalchemy.orm import Session

from .models import SecurityEventRecord

SecurityEvent = Final
"""Event names are stable strings; the admin view will filter on them."""

REGISTRATION_SUCCEEDED = "registration.succeeded"
REGISTRATION_CONFLICT = "registration.conflict"
LOGIN_SUCCEEDED = "login.succeeded"
LOGIN_FAILED = "login.failed"
LOGIN_BLOCKED = "login.blocked"
LOGOUT = "session.logout"
SESSION_REVOKED = "session.revoked"
SESSION_ROTATED = "session.rotated"
EMAIL_VERIFICATION_REQUESTED = "email_verification.requested"
EMAIL_VERIFICATION_CONFIRMED = "email_verification.confirmed"
EMAIL_VERIFICATION_REJECTED = "email_verification.rejected"
PASSWORD_RESET_REQUESTED = "password_reset.requested"
PASSWORD_RESET_COMPLETED = "password_reset.completed"
PASSWORD_RESET_REJECTED = "password_reset.rejected"
PASSWORD_CHANGED = "password.changed"
ACCOUNT_SUSPENDED = "account.suspended"
ACCOUNT_RESTORED = "account.restored"
ADMIN_BOOTSTRAP = "admin.bootstrap"
ADMIN_ACCESS_GRANTED = "admin.access_granted"
ADMIN_ACCESS_DENIED = "admin.access_denied"
CREDITS_GRANTED = "credits.granted"
RATE_LIMIT_TRIGGERED = "rate_limit.triggered"
RATE_LIMIT_DEGRADED = "rate_limit.degraded"
CSRF_REJECTED = "csrf.rejected"

ALLOWED_METADATA_KEYS: frozenset[str] = frozenset(
    {
        "reason",
        "bucket",
        "retryAfterSeconds",
        "purpose",
        "role",
        "previousRole",
        "sessionCount",
        "emailDomain",
        "deliveryStatus",
        "rotated",
        "source",
    }
)
"""Allowlist. Anything else is dropped rather than redacted-in-place."""

_SECRET_KEY_PATTERN = re.compile(
    r"(password|token|secret|cookie|authorization|hash|digest|otp|credential"
    r"|api_?key|private_?key)",
    re.IGNORECASE,
)
"""Matched against metadata *key names*, which a caller controls deliberately."""

_SECRET_VALUE_PATTERN = re.compile(r"\$argon2|[A-Za-z0-9+/_]{32,}")
"""Matched against metadata *values*: an Argon2 hash, or a token-shaped run.

Deliberately shape-based rather than word-based. A reason such as
``"bad_password"`` is a legitimate audit value, while a 32-character unbroken
base64-ish run is almost certainly a token or digest that must not be stored.
"""

_MAX_VALUE_LENGTH = 120


class AuditRedactionError(ValueError):
    """Raised when caller metadata would have leaked a secret."""


def sanitize_metadata(metadata: dict[str, Any] | None) -> dict[str, Any] | None:
    """Return only allowlisted, bounded, non-secret metadata.

    A key that looks like a secret raises instead of being silently dropped, so
    a future caller cannot quietly start passing a token and have it ignored
    only because of a name check that might later be relaxed.
    """
    if not metadata:
        return None
    cleaned: dict[str, Any] = {}
    for key, value in metadata.items():
        if _SECRET_KEY_PATTERN.search(key):
            raise AuditRedactionError(f"Audit metadata key {key!r} may carry a secret.")
        if key not in ALLOWED_METADATA_KEYS:
            continue
        if value is None:
            continue
        if isinstance(value, bool | int | float):
            cleaned[key] = value
            continue
        text = str(value)
        if _SECRET_VALUE_PATTERN.search(text):
            raise AuditRedactionError(f"Audit metadata value for {key!r} looks like a secret.")
        cleaned[key] = text[:_MAX_VALUE_LENGTH]
    return cleaned or None


def network_prefix(client_ip: str | None) -> str | None:
    """Reduce an address to a coarse network so it cannot identify a person.

    IPv4 keeps the /24 network, IPv6 keeps the /48 network. Returns ``None``
    for anything unparseable rather than storing the raw value.
    """
    if not client_ip:
        return None
    try:
        address = ipaddress.ip_address(client_ip)
    except ValueError:
        return None
    if address.version == 4:
        return str(ipaddress.ip_network(f"{address}/24", strict=False))
    return str(ipaddress.ip_network(f"{address}/48", strict=False))


def record_security_event(
    session: Session,
    *,
    event: str,
    outcome: str,
    actor_user_id: str | None = None,
    subject_user_id: str | None = None,
    request_id: str | None = None,
    ip_prefix: str | None = None,
    device_summary: str | None = None,
    metadata: dict[str, Any] | None = None,
) -> SecurityEventRecord:
    """Append one sanitized audit row inside the caller's transaction."""
    record = SecurityEventRecord(
        event=event[:48],
        outcome=outcome[:16],
        actor_user_id=actor_user_id,
        subject_user_id=subject_user_id,
        request_id=request_id,
        ip_prefix=ip_prefix,
        device_summary=(device_summary or None) and device_summary[:80],
        event_metadata=sanitize_metadata(metadata),
    )
    session.add(record)
    return record
