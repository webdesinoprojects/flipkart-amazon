"""Account registration, sign-in, and session lifecycle rules.

This layer owns the product decisions. It never imports FastAPI request or
response objects, so every rule below is testable without an HTTP client. The
route adapter in :mod:`app.modules.auth.routes` translates its errors into the
shared HTTP envelope.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta
from functools import lru_cache

from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ...config import Settings
from ...platform.clock import as_utc, utc_now
from ..audit import service as audit
from .csrf import issue_csrf_token
from .email_address import InvalidEmailError, NormalizedEmail, normalize_email
from .errors import (
    AccountSuspendedError,
    EmailNotVerifiedError,
    InvalidCredentialsError,
    InvalidInputError,
)
from .models import SessionRecord, UserRecord
from .passwords import PasswordHashingService, PasswordPolicyError
from .repository import AuthRepository
from .tokens import digest_token, generate_token


@dataclass(frozen=True, slots=True)
class RequestContext:
    """Non-identifying request metadata carried into services and audit rows."""

    request_id: str = ""
    client_ip: str | None = None
    device_summary: str = "Unknown device"


@dataclass(frozen=True, slots=True)
class IssuedSession:
    record: SessionRecord
    token: str
    csrf_token: str
    max_age_seconds: int


@dataclass(frozen=True, slots=True)
class AuthenticatedSession:
    user: UserRecord
    session: SessionRecord


@dataclass(frozen=True, slots=True)
class RegistrationOutcome:
    """Deliberately uniform: the caller cannot tell whether an account was new."""

    user: UserRecord
    created: bool


class AuthService:
    def __init__(
        self,
        *,
        session: Session,
        settings: Settings,
        passwords: PasswordHashingService,
        repository: AuthRepository | None = None,
    ) -> None:
        self._session = session
        self._settings = settings
        self._passwords = passwords
        self.repository = repository or AuthRepository(session)

    # --- registration ----------------------------------------------------
    def register(
        self, *, email: str, password: str, context: RequestContext
    ) -> RegistrationOutcome:
        """Create a `user` account, or report a conflict without disclosing it.

        A client can never choose its own role: ``role`` is not an input here
        and the only value this method can write is ``user``.
        """
        normalized = self._normalize_email_or_raise(email)
        self._validate_password_or_raise(password)

        existing = self.repository.find_user_by_canonical_email(normalized.canonical)
        if existing is not None:
            self._record(
                context,
                event=audit.REGISTRATION_CONFLICT,
                outcome="rejected",
                subject_user_id=existing.id,
                metadata={"emailDomain": normalized.domain},
            )
            return RegistrationOutcome(user=existing, created=False)

        user = UserRecord(
            email_display=normalized.display,
            email_canonical=normalized.canonical,
            password_hash=self._passwords.hash(password),
            role="user",
            status="active",
        )
        try:
            self.repository.add_user(user)
        except IntegrityError:
            # Two concurrent sign-ups for the same address: the unique index
            # decides, and the loser returns the same generic outcome.
            self._session.rollback()
            existing = self.repository.find_user_by_canonical_email(normalized.canonical)
            if existing is None:
                raise
            self._record(
                context,
                event=audit.REGISTRATION_CONFLICT,
                outcome="rejected",
                subject_user_id=existing.id,
                metadata={"emailDomain": normalized.domain, "reason": "concurrent"},
            )
            return RegistrationOutcome(user=existing, created=False)

        self._record(
            context,
            event=audit.REGISTRATION_SUCCEEDED,
            outcome="success",
            actor_user_id=user.id,
            subject_user_id=user.id,
            metadata={"emailDomain": normalized.domain, "role": user.role},
        )
        return RegistrationOutcome(user=user, created=True)

    # --- sign-in ---------------------------------------------------------
    def authenticate(self, *, email: str, password: str, context: RequestContext) -> UserRecord:
        """Verify credentials, or raise an enumeration-safe error."""
        try:
            normalized = normalize_email(email)
        except InvalidEmailError:
            self._spend_equivalent_work(password)
            self._record_login_failure(context, reason="invalid_email")
            raise InvalidCredentialsError() from None

        user = self.repository.find_user_by_canonical_email(normalized.canonical)
        if user is None:
            # Spend comparable time so response latency cannot be used to tell
            # an unknown address apart from a wrong password.
            self._spend_equivalent_work(password)
            self._record_login_failure(context, reason="unknown_account")
            raise InvalidCredentialsError()

        if not self._passwords.verify(password_hash=user.password_hash, password=password):
            self._record_login_failure(context, reason="bad_password", user_id=user.id)
            raise InvalidCredentialsError()

        # The checks below run only after the password matched, so they cannot
        # be used to discover whether an address has an account.
        if not user.is_active:
            self._record(
                context,
                event=audit.LOGIN_BLOCKED,
                outcome="rejected",
                actor_user_id=user.id,
                metadata={"reason": "suspended"},
            )
            raise AccountSuspendedError()
        if self._settings.auth_require_verified_email and not user.email_verified:
            self._record(
                context,
                event=audit.LOGIN_BLOCKED,
                outcome="rejected",
                actor_user_id=user.id,
                metadata={"reason": "email_unverified"},
            )
            raise EmailNotVerifiedError()

        if self._passwords.needs_rehash(user.password_hash):
            # Parameters were raised since this hash was written; upgrade it now
            # while the plaintext is legitimately available.
            user.password_hash = self._passwords.hash(password)
        return user

    # --- sessions --------------------------------------------------------
    def issue_session(self, user: UserRecord, *, context: RequestContext) -> IssuedSession:
        """Create a fresh session row and its CSRF token.

        Always called after a successful sign-in, a completed password reset, or
        a privilege change, so a pre-existing session identifier can never be
        promoted (session fixation).
        """
        now = utc_now()
        token = generate_token()
        record = SessionRecord(
            user_id=user.id,
            token_digest=digest_token(token, secret=self._settings.auth_secret),
            security_version=user.security_version,
            device_summary=context.device_summary,
            created_at=now,
            last_seen_at=now,
            idle_expires_at=now + timedelta(seconds=self._settings.auth_session_idle_seconds),
            absolute_expires_at=now
            + timedelta(seconds=self._settings.auth_session_absolute_seconds),
        )
        csrf_token = issue_csrf_token(record, secret=self._settings.auth_secret)
        self.repository.add_session(record)
        self._prune_excess_sessions(user.id, keep_session_id=record.id, now=now)
        user.last_login_at = now
        self._record(
            context,
            event=audit.LOGIN_SUCCEEDED,
            outcome="success",
            actor_user_id=user.id,
            metadata={"role": user.role},
        )
        return IssuedSession(
            record=record,
            token=token,
            csrf_token=csrf_token,
            max_age_seconds=self._settings.auth_session_absolute_seconds,
        )

    def resolve_session(self, token: str | None) -> AuthenticatedSession | None:
        """Securely validate a presented session token against PostgreSQL."""
        if not token:
            return None
        now = utc_now()
        record = self.repository.find_live_session_by_digest(
            digest_token(token, secret=self._settings.auth_secret), now=now
        )
        if record is None:
            return None
        user = self.repository.get_user(record.user_id)
        if user is None or not user.is_active:
            if user is not None:
                self.repository.revoke_session(
                    record.id, user_id=user.id, now=now, reason="account_suspended"
                )
            return None
        self._refresh_idle_window(record, now=now)
        return AuthenticatedSession(user=user, session=record)

    def rotate_csrf_token(self, record: SessionRecord) -> str:
        return issue_csrf_token(record, secret=self._settings.auth_secret)

    def logout(self, authenticated: AuthenticatedSession, *, context: RequestContext) -> None:
        now = utc_now()
        self.repository.revoke_session(
            authenticated.session.id,
            user_id=authenticated.user.id,
            now=now,
            reason="logout",
        )
        self._record(
            context,
            event=audit.LOGOUT,
            outcome="success",
            actor_user_id=authenticated.user.id,
        )

    def list_sessions(self, user_id: str) -> list[SessionRecord]:
        return self.repository.list_live_sessions(user_id, now=utc_now())

    def revoke_session(
        self, *, session_id: str, actor: AuthenticatedSession, context: RequestContext
    ) -> bool:
        """Revoke a session the actor owns. Cross-user attempts simply miss."""
        now = utc_now()
        revoked = self.repository.revoke_session(
            session_id, user_id=actor.user.id, now=now, reason="user_revoked"
        )
        if revoked:
            self._record(
                context,
                event=audit.SESSION_REVOKED,
                outcome="success",
                actor_user_id=actor.user.id,
                metadata={"source": "security_page"},
            )
        return revoked

    # --- internals -------------------------------------------------------
    def _refresh_idle_window(self, record: SessionRecord, *, now: datetime) -> None:
        elapsed = (now - as_utc(record.last_seen_at)).total_seconds()
        if elapsed < self._settings.auth_session_touch_seconds:
            return
        self.repository.touch_session(
            record.id, now=now, idle_seconds=self._settings.auth_session_idle_seconds
        )
        record.last_seen_at = now
        record.idle_expires_at = now + timedelta(seconds=self._settings.auth_session_idle_seconds)

    def _prune_excess_sessions(self, user_id: str, *, keep_session_id: str, now: datetime) -> None:
        live = self.repository.list_live_sessions(user_id, now=now)
        surplus = len(live) - self._settings.auth_max_sessions_per_user
        if surplus <= 0:
            return
        for record in sorted(live, key=lambda item: as_utc(item.last_seen_at))[:surplus]:
            if record.id == keep_session_id:
                continue
            self.repository.revoke_session(
                record.id, user_id=user_id, now=now, reason="session_limit"
            )

    def _normalize_email_or_raise(self, email: str) -> NormalizedEmail:
        try:
            return normalize_email(email)
        except InvalidEmailError as error:
            raise InvalidInputError(str(error), field="email") from error

    def _validate_password_or_raise(self, password: str) -> None:
        try:
            self._passwords.policy.validate(password)
        except PasswordPolicyError as error:
            raise InvalidInputError(error.message, field="password") from error

    def _spend_equivalent_work(self, password: str) -> None:
        self._passwords.verify(password_hash=_decoy_hash(self._passwords), password=password)

    def _record_login_failure(
        self, context: RequestContext, *, reason: str, user_id: str | None = None
    ) -> None:
        self._record(
            context,
            event=audit.LOGIN_FAILED,
            outcome="rejected",
            actor_user_id=user_id,
            metadata={"reason": reason},
        )

    def _record(
        self,
        context: RequestContext,
        *,
        event: str,
        outcome: str,
        actor_user_id: str | None = None,
        subject_user_id: str | None = None,
        metadata: dict | None = None,
    ) -> None:
        audit.record_security_event(
            self._session,
            event=event,
            outcome=outcome,
            actor_user_id=actor_user_id,
            subject_user_id=subject_user_id,
            request_id=context.request_id or None,
            ip_prefix=(
                audit.network_prefix(context.client_ip)
                if self._settings.auth_audit_store_ip_prefix
                else None
            ),
            device_summary=context.device_summary,
            metadata=metadata,
        )


@lru_cache(maxsize=4)
def _decoy_hash_for(parameters: tuple[int, int, int]) -> str:
    """One throwaway hash per parameter set, reused for timing equalisation.

    Nothing authenticates against this value; it exists only so that a login
    attempt for an unknown address performs the same Argon2 work as one for a
    real account.
    """
    from argon2 import PasswordHasher

    time_cost, memory_kib, parallelism = parameters
    hasher = PasswordHasher(time_cost=time_cost, memory_cost=memory_kib, parallelism=parallelism)
    return hasher.hash("unused-decoy-value-for-constant-time-login")


def _decoy_hash(passwords: PasswordHashingService) -> str:
    return _decoy_hash_for(passwords.parameters)
