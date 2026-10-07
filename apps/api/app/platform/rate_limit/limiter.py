"""Valkey-backed fixed-window rate limiting with deterministic boundaries.

Design notes:

* The window boundary is derived from the clock (``floor(now / window)``), so a
  test can set the clock and assert the exact request that is rejected rather
  than sleeping.
* Each bucket has a TTL equal to its window, so no key can accumulate.
* No authoritative authentication state lives here. Valkey only holds counters;
  losing them costs abuse protection, never a session or an account.
* There is **no in-process fallback map**. An unbounded per-worker dictionary
  would be both a memory risk and a false sense of protection across replicas.
  When Valkey cannot be reached the limiter reports ``degraded`` and the caller
  applies the documented fail-open policy while emitting an audit event.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass

from redis import Redis
from redis.exceptions import RedisError

from .keys import bucket_key

logger = logging.getLogger("app.rate_limit")


@dataclass(frozen=True, slots=True)
class RateLimitRule:
    bucket: str
    max_requests: int
    window_seconds: int


@dataclass(frozen=True, slots=True)
class RateLimitDecision:
    allowed: bool
    bucket: str
    retry_after_seconds: int
    degraded: bool = False
    """True when the backend was unreachable and the request was let through."""


ALLOWED_UNLIMITED = RateLimitDecision(allowed=True, bucket="", retry_after_seconds=0)


class RateLimiter:
    """Counts requests per (bucket, hashed identifier, window)."""

    def __init__(self, *, client: Redis | None, secret: str, enabled: bool = True) -> None:
        self._client = client
        self._secret = secret
        self._enabled = enabled

    @property
    def available(self) -> bool:
        if not self._enabled or self._client is None:
            return False
        try:
            return bool(self._client.ping())
        except RedisError:
            return False

    def check(self, rule: RateLimitRule, identifier: str, *, now: float) -> RateLimitDecision:
        """Consume one unit from ``rule`` for ``identifier``."""
        if not self._enabled or self._client is None or not identifier:
            return ALLOWED_UNLIMITED
        window_start = int(now // rule.window_seconds) * rule.window_seconds
        retry_after = max(1, int(window_start + rule.window_seconds - now))
        key = bucket_key(
            bucket=rule.bucket,
            identifier=identifier,
            window_start=window_start,
            secret=self._secret,
        )
        try:
            pipeline = self._client.pipeline()
            pipeline.incr(key, 1)
            pipeline.expire(key, rule.window_seconds)
            used = int(pipeline.execute()[0])
        except (RedisError, ValueError, TypeError) as error:
            logger.warning(
                "rate_limit_backend_unavailable",
                extra={"bucket": rule.bucket, "error_type": type(error).__name__},
            )
            return RateLimitDecision(
                allowed=True,
                bucket=rule.bucket,
                retry_after_seconds=0,
                degraded=True,
            )
        if used > rule.max_requests:
            return RateLimitDecision(
                allowed=False,
                bucket=rule.bucket,
                retry_after_seconds=retry_after,
            )
        return RateLimitDecision(allowed=True, bucket=rule.bucket, retry_after_seconds=0)

    def check_all(self, pairs: list[tuple[RateLimitRule, str]], *, now: float) -> RateLimitDecision:
        """Evaluate several buckets and return the first rejection.

        All buckets are consumed even after a rejection so that an attacker
        cannot keep one bucket cold by always tripping another one first.
        """
        rejection: RateLimitDecision | None = None
        degraded = False
        for rule, identifier in pairs:
            decision = self.check(rule, identifier, now=now)
            degraded = degraded or decision.degraded
            if not decision.allowed and rejection is None:
                rejection = decision
        if rejection is not None:
            return rejection
        return RateLimitDecision(allowed=True, bucket="", retry_after_seconds=0, degraded=degraded)


def build_redis_client(url: str, *, timeout_seconds: float) -> Redis | None:
    """Create a bounded Valkey client, or ``None`` when one cannot be built."""
    try:
        return Redis.from_url(
            url,
            socket_connect_timeout=timeout_seconds,
            socket_timeout=timeout_seconds,
            retry_on_timeout=False,
            decode_responses=True,
        )
    except (ValueError, RedisError) as error:
        logger.warning("rate_limit_client_unavailable", extra={"error_type": type(error).__name__})
        return None
