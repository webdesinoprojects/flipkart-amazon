"""Rate-limit key privacy, deterministic boundaries, and retry timing."""

import pytest

from app.config import Settings
from app.modules.auth.errors import RateLimitedError
from app.modules.auth.rate_limits import build_rate_limits, enforce
from app.platform.rate_limit.keys import KEY_NAMESPACE, bucket_key, hashed_identifier
from app.platform.rate_limit.limiter import RateLimiter, RateLimitRule

SECRET = "test-only-auth-secret-value-at-least-32-chars"
RULE = RateLimitRule(bucket="login_ip", max_requests=3, window_seconds=60)


class FakeRedis:
    """Minimal pipeline-compatible double for the fixed-window counter."""

    def __init__(self, *, fail: bool = False) -> None:
        self.store: dict[str, int] = {}
        self.expiries: dict[str, int] = {}
        self.fail = fail

    def ping(self) -> bool:
        if self.fail:
            from redis.exceptions import ConnectionError as RedisConnectionError

            raise RedisConnectionError("down")
        return True

    def pipeline(self):
        return FakePipeline(self)


class FakePipeline:
    def __init__(self, backend: FakeRedis) -> None:
        self.backend = backend
        self.operations: list[tuple[str, str, int]] = []

    def incr(self, key: str, amount: int) -> None:
        self.operations.append(("incr", key, amount))

    def expire(self, key: str, seconds: int) -> None:
        self.operations.append(("expire", key, seconds))

    def execute(self) -> list[int]:
        if self.backend.fail:
            from redis.exceptions import ConnectionError as RedisConnectionError

            raise RedisConnectionError("down")
        results: list[int] = []
        for kind, key, value in self.operations:
            if kind == "incr":
                self.backend.store[key] = self.backend.store.get(key, 0) + value
                results.append(self.backend.store[key])
            else:
                self.backend.expiries[key] = value
                results.append(1)
        return results


def test_identifiers_are_hashed_and_never_appear_in_the_key():
    key = bucket_key(
        bucket="login_account", identifier="seller@example.com", window_start=0, secret=SECRET
    )
    assert key.startswith(f"{KEY_NAMESPACE}:login_account:")
    assert "seller" not in key
    assert "example.com" not in key


def test_hashing_is_keyed_so_the_mapping_cannot_be_rebuilt_offline():
    first = hashed_identifier("seller@example.com", secret=SECRET)
    second = hashed_identifier("seller@example.com", secret="another-secret")
    assert first != second
    assert first == hashed_identifier("seller@example.com", secret=SECRET)


def test_the_boundary_is_exact_and_deterministic():
    limiter = RateLimiter(client=FakeRedis(), secret=SECRET)
    for attempt in range(1, 4):
        decision = limiter.check(RULE, "203.0.113.5", now=1000.0)
        assert decision.allowed is True, f"attempt {attempt} must be allowed"
    rejected = limiter.check(RULE, "203.0.113.5", now=1000.0)
    assert rejected.allowed is False
    assert rejected.bucket == "login_ip"


def test_retry_after_counts_down_to_the_window_end():
    backend = FakeRedis()
    limiter = RateLimiter(client=backend, secret=SECRET)
    for _ in range(4):
        decision = limiter.check(RULE, "203.0.113.5", now=1010.0)
    assert decision.allowed is False
    # Window started at 960 and is 60s long, so 50s have passed.
    assert decision.retry_after_seconds == 10


def test_a_new_window_resets_the_counter():
    limiter = RateLimiter(client=FakeRedis(), secret=SECRET)
    for _ in range(4):
        limiter.check(RULE, "203.0.113.5", now=1000.0)
    assert limiter.check(RULE, "203.0.113.5", now=1061.0).allowed is True


def test_every_key_gets_a_ttl_so_nothing_accumulates():
    backend = FakeRedis()
    limiter = RateLimiter(client=backend, secret=SECRET)
    limiter.check(RULE, "203.0.113.5", now=1000.0)
    assert set(backend.expiries.values()) == {60}


def test_separate_identifiers_do_not_share_a_bucket():
    limiter = RateLimiter(client=FakeRedis(), secret=SECRET)
    for _ in range(4):
        limiter.check(RULE, "203.0.113.5", now=1000.0)
    assert limiter.check(RULE, "203.0.113.6", now=1000.0).allowed is True


def test_an_unavailable_backend_fails_open_and_reports_degradation():
    limiter = RateLimiter(client=FakeRedis(fail=True), secret=SECRET)
    decision = limiter.check(RULE, "203.0.113.5", now=1000.0)
    assert decision.allowed is True
    assert decision.degraded is True
    assert limiter.available is False


def test_a_disabled_limiter_allows_everything_without_a_client():
    limiter = RateLimiter(client=None, secret=SECRET, enabled=False)
    assert limiter.check(RULE, "203.0.113.5", now=1000.0).allowed is True


def test_all_buckets_are_consumed_even_after_a_rejection():
    """An attacker must not keep one bucket cold by always tripping another."""
    backend = FakeRedis()
    limiter = RateLimiter(client=backend, secret=SECRET)
    ip_rule = RateLimitRule(bucket="login_ip", max_requests=0, window_seconds=60)
    account_rule = RateLimitRule(bucket="login_account", max_requests=5, window_seconds=60)
    decision = limiter.check_all(
        [(ip_rule, "203.0.113.5"), (account_rule, "seller@example.com")], now=1000.0
    )
    assert decision.allowed is False
    assert decision.bucket == "login_ip"
    assert len(backend.store) == 2, "both buckets must have been incremented"


def test_enforce_raises_with_retry_after_and_an_identical_message_per_bucket():
    """The message must not reveal which bucket was exhausted."""
    limiter = RateLimiter(client=FakeRedis(), secret=SECRET)
    account_bucket = RateLimitRule(bucket="login_account", max_requests=0, window_seconds=120)
    ip_bucket = RateLimitRule(bucket="login_ip", max_requests=0, window_seconds=120)

    with pytest.raises(RateLimitedError) as account_error:
        enforce(limiter, [(account_bucket, "seller@example.com")], now=0.0)
    with pytest.raises(RateLimitedError) as ip_error:
        enforce(limiter, [(ip_bucket, "203.0.113.5")], now=0.0)

    assert account_error.value.message == ip_error.value.message
    assert account_error.value.retry_after_seconds == 120
    assert account_error.value.bucket != ip_error.value.bucket


def test_enforce_reports_degradation_without_rejecting():
    limiter = RateLimiter(client=FakeRedis(fail=True), secret=SECRET)
    rules = build_rate_limits(Settings(environment="test"))
    assert enforce(limiter, [(rules.login_ip, "203.0.113.5")], now=0.0) is True


def test_configured_rules_cover_every_protected_endpoint():
    rules = build_rate_limits(Settings(environment="test"))
    buckets = {
        rules.login_ip.bucket,
        rules.login_account.bucket,
        rules.register_ip.bucket,
        rules.email_ip.bucket,
        rules.email_account.bucket,
        rules.reset_ip.bucket,
    }
    assert buckets == {
        "login_ip",
        "login_account",
        "register_ip",
        "email_ip",
        "email_account",
        "reset_ip",
    }
