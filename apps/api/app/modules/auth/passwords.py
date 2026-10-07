"""Argon2id password hashing and the product's password policy.

All hashing, verification, and constant-time comparison is performed by
``argon2-cffi`` (the official binding to the reference Argon2 implementation).
Nothing in this module implements cryptography; it only configures the library,
bounds the accepted input, and decides when an existing hash must be upgraded.
"""

from __future__ import annotations

from dataclasses import dataclass

from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError, VerifyMismatchError

from ...config import Settings


class PasswordPolicyError(ValueError):
    """Raised when a submitted password cannot be accepted."""

    def __init__(self, message: str) -> None:
        super().__init__(message)
        self.message = message


@dataclass(frozen=True, slots=True)
class PasswordPolicy:
    """Bounds applied before any expensive hashing work happens."""

    min_length: int
    max_bytes: int

    def validate(self, password: str) -> str:
        """Return ``password`` unchanged, or raise :class:`PasswordPolicyError`.

        Long passphrases and Unicode are allowed. Input is never truncated: an
        over-long password is rejected so the caller cannot silently
        authenticate with a different secret than the one they typed.
        """
        if not isinstance(password, str) or not password:
            raise PasswordPolicyError("A password is required.")
        if "\x00" in password:
            raise PasswordPolicyError("A password cannot contain a null byte.")
        if len(password) < self.min_length:
            raise PasswordPolicyError(
                f"Use at least {self.min_length} characters. A passphrase works well."
            )
        encoded_length = len(password.encode("utf-8"))
        if encoded_length > self.max_bytes:
            raise PasswordPolicyError(
                f"That password is too long. Use at most {self.max_bytes} bytes."
            )
        return password


class PasswordHashingService:
    """Hashes and verifies passwords, and reports when a rehash is due."""

    def __init__(self, *, hasher: PasswordHasher, policy: PasswordPolicy) -> None:
        self._hasher = hasher
        self.policy = policy

    @property
    def parameters(self) -> tuple[int, int, int]:
        """The live ``(time_cost, memory_kib, parallelism)`` triple."""
        return (
            self._hasher.time_cost,
            self._hasher.memory_cost,
            self._hasher.parallelism,
        )

    def hash(self, password: str) -> str:
        return self._hasher.hash(self.policy.validate(password))

    def verify(self, *, password_hash: str, password: str) -> bool:
        """Return whether ``password`` matches ``password_hash``.

        The comparison is performed inside argon2-cffi, which uses a
        constant-time check. Policy violations are reported as a mismatch here
        rather than as an error so that login cannot be used to probe whether a
        stored password is longer than the current maximum.
        """
        if not password_hash:
            return False
        try:
            self.policy.validate(password)
        except PasswordPolicyError:
            return False
        try:
            return self._hasher.verify(password_hash, password)
        except (VerifyMismatchError, VerificationError, InvalidHashError):
            return False

    def needs_rehash(self, password_hash: str) -> bool:
        """Whether a stored hash was produced with weaker parameters."""
        try:
            return self._hasher.check_needs_rehash(password_hash)
        except InvalidHashError:
            return True


def password_service_from_parameters(
    *,
    time_cost: int,
    memory_kib: int,
    parallelism: int,
    min_length: int,
    max_bytes: int,
) -> PasswordHashingService:
    """Create the hashing service from explicit Argon2id parameters.

    Product defaults are ``t=3``, ``m=65536 KiB`` (64 MiB), ``p=2``, which
    exceeds the OWASP Password Storage minimum of ``m=19456, t=2, p=1`` and
    measured ~140 ms per hash and per verify on the development machine.
    Production must re-measure on the deployment CPU and budget
    ``memory_kib x concurrent logins`` of RAM; see ``docs/AUTHENTICATION.md``.
    """
    return PasswordHashingService(
        hasher=PasswordHasher(time_cost=time_cost, memory_cost=memory_kib, parallelism=parallelism),
        policy=PasswordPolicy(min_length=min_length, max_bytes=max_bytes),
    )


def build_password_service(settings: Settings) -> PasswordHashingService:
    """Create the hashing service from validated settings."""
    return password_service_from_parameters(
        time_cost=settings.auth_argon2_time_cost,
        memory_kib=settings.auth_argon2_memory_kib,
        parallelism=settings.auth_argon2_parallelism,
        min_length=settings.auth_password_min_length,
        max_bytes=settings.auth_password_max_bytes,
    )
