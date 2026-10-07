import pytest

from app.config import Settings
from app.modules.auth.passwords import (
    PasswordPolicy,
    PasswordPolicyError,
    build_password_service,
    password_service_from_parameters,
)

CHEAP = {"time_cost": 1, "memory_kib": 8192, "parallelism": 1}


def cheap_service(**overrides):
    return password_service_from_parameters(
        **{**CHEAP, "min_length": 10, "max_bytes": 1024, **overrides}
    )


def test_product_defaults_exceed_the_owasp_argon2id_minimum():
    """OWASP minimum is m=19456 KiB, t=2, p=1; the defaults must not regress."""
    settings = Settings(environment="test")
    time_cost, memory_kib, parallelism = build_password_service(settings).parameters
    assert memory_kib >= 19456
    assert time_cost >= 2
    assert parallelism >= 1
    assert (time_cost, memory_kib, parallelism) == (3, 65536, 2)


def test_hash_is_argon2id_and_salted_per_password():
    service = cheap_service()
    first = service.hash("correct horse battery staple")
    second = service.hash("correct horse battery staple")
    assert first.startswith("$argon2id$")
    assert first != second, "each hash must carry its own salt"


def test_verify_accepts_the_right_password_and_rejects_others():
    service = cheap_service()
    stored = service.hash("correct horse battery staple")
    assert service.verify(password_hash=stored, password="correct horse battery staple")
    assert not service.verify(password_hash=stored, password="correct horse battery stapl")
    assert not service.verify(password_hash=stored, password="")


def test_verify_rejects_a_corrupt_or_empty_stored_hash():
    service = cheap_service()
    assert not service.verify(password_hash="", password="correct horse battery staple")
    assert not service.verify(password_hash="not-a-hash", password="correct horse battery")


def test_long_unicode_passphrases_are_accepted():
    service = cheap_service()
    passphrase = "सही घोड़ा बैटरी स्टेपल — ✅ " * 3
    stored = service.hash(passphrase)
    assert service.verify(password_hash=stored, password=passphrase)


def test_maximum_byte_length_is_enforced_without_truncation():
    policy = PasswordPolicy(min_length=10, max_bytes=72)
    # Four-byte characters: 20 of them exceed 72 bytes while being 20 characters.
    too_long = "🔐" * 20
    assert len(too_long) == 20
    assert len(too_long.encode("utf-8")) > 72
    with pytest.raises(PasswordPolicyError):
        policy.validate(too_long)


def test_a_password_over_the_limit_is_not_silently_shortened():
    service = cheap_service(max_bytes=32)
    accepted = "a" * 32
    stored = service.hash(accepted)
    # If the service truncated input, the longer value would still verify.
    assert not service.verify(password_hash=stored, password="a" * 40)


def test_too_short_is_rejected_with_a_safe_message():
    policy = PasswordPolicy(min_length=10, max_bytes=1024)
    with pytest.raises(PasswordPolicyError) as error:
        policy.validate("short")
    assert "at least 10" in error.value.message
    assert "short" not in error.value.message, "the message must not echo the password"


def test_no_composition_rules_are_imposed():
    """A long lowercase passphrase must be acceptable."""
    policy = PasswordPolicy(min_length=10, max_bytes=1024)
    assert policy.validate("all lowercase words no symbols")


def test_null_bytes_are_rejected():
    policy = PasswordPolicy(min_length=10, max_bytes=1024)
    with pytest.raises(PasswordPolicyError):
        policy.validate("abcdefghij\x00klmno")


def test_rehash_is_requested_when_parameters_increase():
    weak = cheap_service(time_cost=1)
    strong = password_service_from_parameters(
        time_cost=3, memory_kib=16384, parallelism=1, min_length=10, max_bytes=1024
    )
    weak_hash = weak.hash("correct horse battery staple")
    assert strong.needs_rehash(weak_hash) is True
    assert strong.needs_rehash(strong.hash("correct horse battery staple")) is False


def test_rehash_is_requested_for_an_unparseable_hash():
    assert cheap_service().needs_rehash("legacy-sha1-hash") is True
