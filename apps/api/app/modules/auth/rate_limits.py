"""Which authentication endpoints are throttled, by what, and what happens
when the counter backend is unavailable.

Two dimensions are combined everywhere it matters:

* **per client IP** — bounds a single source hammering the endpoint;
* **per account key** — bounds a distributed attack against one account.

The account key is the *canonical email*, hashed with ``AUTH_SECRET`` before it
becomes a Valkey key, so the keyspace never discloses which addresses were
tried. Because the key is derived from the submitted address rather than from a
resolved account, a rejection reveals nothing about whether that account exists.

Fail policy when Valkey is unreachable: **fail open**, log, and record a
``rate_limit.degraded`` audit event. Rationale: a broker outage must not lock
every customer out of their own account, Argon2 cost and the request body limit
still bound the damage, and readiness reports the degradation so an operator can
see it. This is an availability-over-abuse trade-off and is revisited before
public launch (see ADR 0001 §11).
"""

from __future__ import annotations

import time
from dataclasses import dataclass

from ...config import Settings
from ...platform.rate_limit.limiter import RateLimiter, RateLimitRule
from ..audit import service as audit
from .errors import RateLimitedError

LOGIN_IP = "login_ip"
LOGIN_ACCOUNT = "login_account"
REGISTER_IP = "register_ip"
EMAIL_IP = "email_ip"
EMAIL_ACCOUNT = "email_account"
RESET_IP = "reset_ip"


@dataclass(frozen=True, slots=True)
class AuthRateLimits:
    login_ip: RateLimitRule
    login_account: RateLimitRule
    register_ip: RateLimitRule
    email_ip: RateLimitRule
    email_account: RateLimitRule
    reset_ip: RateLimitRule


def build_rate_limits(settings: Settings) -> AuthRateLimits:
    return AuthRateLimits(
        login_ip=RateLimitRule(
            bucket=LOGIN_IP,
            max_requests=settings.rate_limit_login_ip_max,
            window_seconds=settings.rate_limit_login_window_seconds,
        ),
        login_account=RateLimitRule(
            bucket=LOGIN_ACCOUNT,
            max_requests=settings.rate_limit_login_account_max,
            window_seconds=settings.rate_limit_login_window_seconds,
        ),
        register_ip=RateLimitRule(
            bucket=REGISTER_IP,
            max_requests=settings.rate_limit_register_ip_max,
            window_seconds=settings.rate_limit_register_window_seconds,
        ),
        email_ip=RateLimitRule(
            bucket=EMAIL_IP,
            max_requests=settings.rate_limit_email_ip_max,
            window_seconds=settings.rate_limit_email_window_seconds,
        ),
        email_account=RateLimitRule(
            bucket=EMAIL_ACCOUNT,
            max_requests=settings.rate_limit_email_account_max,
            window_seconds=settings.rate_limit_email_window_seconds,
        ),
        reset_ip=RateLimitRule(
            bucket=RESET_IP,
            max_requests=settings.rate_limit_reset_ip_max,
            window_seconds=settings.rate_limit_reset_window_seconds,
        ),
    )


def enforce(
    limiter: RateLimiter,
    pairs: list[tuple[RateLimitRule, str]],
    *,
    now: float | None = None,
) -> bool:
    """Consume the given buckets.

    Returns whether the limiter was degraded. Raises :class:`RateLimitedError`
    with a ``Retry-After`` value when a bucket is exhausted. The error message
    is identical for every bucket so it cannot be used to tell an IP limit apart
    from an account limit.
    """
    decision = limiter.check_all(pairs, now=time.time() if now is None else now)
    if not decision.allowed:
        raise RateLimitedError(decision.retry_after_seconds, decision.bucket)
    return decision.degraded


def record_degradation(session, *, request_id: str, bucket: str) -> None:
    """Make a fail-open decision visible in the audit trail."""
    audit.record_security_event(
        session,
        event=audit.RATE_LIMIT_DEGRADED,
        outcome="degraded",
        request_id=request_id or None,
        metadata={"bucket": bucket, "reason": "backend_unavailable"},
    )
