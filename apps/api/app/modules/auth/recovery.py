"""Email verification and password reset lifecycles.

Both flows share one shape:

1. a request step that always returns the same generic response, so it cannot
   be used to discover whether an address has an account;
2. a 256-bit opaque token delivered only by email and stored only as a keyed
   digest;
3. a confirm step whose consumption is a single atomic conditional ``UPDATE``,
   so a replayed or concurrent second use always loses.

Completing a password reset revokes every session for the account and bumps the
account's security version in the same transaction as the password write.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import timedelta

from sqlalchemy.orm import Session

from ...capabilities.email.provider import EmailDeliveryError, EmailMessage, EmailProvider
from ...config import Settings
from ...platform.clock import utc_now
from ..audit import service as audit
from .email_address import InvalidEmailError, normalize_email
from .errors import ExpiredTokenError, InvalidInputError, InvalidTokenError
from .models import OneTimeTokenRecord, UserRecord
from .notifications import (
    existing_account_message,
    reset_message,
    verification_message,
)
from .passwords import PasswordHashingService, PasswordPolicyError
from .repository import AuthRepository
from .service import RequestContext
from .tokens import (
    digest_token,
    generate_token,
    generate_verification_code,
    looks_like_token,
    verification_code_digest,
)

EMAIL_VERIFICATION = "email_verification"
PASSWORD_RESET = "password_reset"  # noqa: S105 - token purpose, not a secret


@dataclass(frozen=True, slots=True)
class DeliveryOutcome:
    """What the UI is allowed to say about an email it asked us to send."""

    status: str
    """``sent``, ``disabled`` or ``failed``. Never account-specific."""

    provider: str


class RecoveryService:
    def __init__(
        self,
        *,
        session: Session,
        settings: Settings,
        passwords: PasswordHashingService,
        email_provider: EmailProvider,
        repository: AuthRepository | None = None,
    ) -> None:
        self._session = session
        self._settings = settings
        self._passwords = passwords
        self._email = email_provider
        self.repository = repository or AuthRepository(session)

    # --- email verification ---------------------------------------------
    def request_verification(self, *, email: str, context: RequestContext) -> DeliveryOutcome:
        """Send a verification link if the address maps to an unverified account."""
        user = self._lookup(email)
        if user is None:
            return self._generic_outcome()
        if user.email_verified:
            # Nothing to do, but the response must not differ from the others.
            return self._generic_outcome()
        token, code = self._issue_verification_credentials(user)
        self._record(
            context,
            event=audit.EMAIL_VERIFICATION_REQUESTED,
            outcome="success",
            user_id=user.id,
        )
        return self._deliver(
            verification_message(self._settings, to=user.email_display, token=token, code=code)
        )

    def notify_existing_account(self, user: UserRecord) -> DeliveryOutcome:
        return self._deliver(existing_account_message(self._settings, to=user.email_display))

    def send_verification_for_new_account(self, user: UserRecord) -> DeliveryOutcome:
        token, code = self._issue_verification_credentials(user)
        return self._deliver(
            verification_message(self._settings, to=user.email_display, token=token, code=code)
        )

    def confirm_verification(self, *, token: str, context: RequestContext) -> UserRecord:
        user = self._consume(token, purpose=EMAIL_VERIFICATION, context=context)
        return self._complete_verification(user, context=context)

    def confirm_verification_code(
        self, *, email: str, code: str, context: RequestContext
    ) -> UserRecord:
        """Consume a six-digit code bound to the submitted canonical address."""
        user = self._lookup(email)
        if user is None or not code.isdigit() or len(code) != 6:
            self._record_rejection(context, purpose=EMAIL_VERIFICATION, reason="invalid_code")
            raise InvalidTokenError()
        digest = verification_code_digest(
            user.email_canonical, code, secret=self._settings.auth_secret
        )
        verified = self._consume_digest(digest, purpose=EMAIL_VERIFICATION, context=context)
        if verified.id != user.id:
            self._record_rejection(context, purpose=EMAIL_VERIFICATION, reason="mismatch")
            raise InvalidTokenError()
        return self._complete_verification(verified, context=context)

    def _complete_verification(self, user: UserRecord, *, context: RequestContext) -> UserRecord:
        if not user.email_verified:
            user.email_verified_at = utc_now()
        self.repository.revoke_outstanding_tokens(
            user.id, purpose=EMAIL_VERIFICATION, now=utc_now()
        )
        self._record(
            context,
            event=audit.EMAIL_VERIFICATION_CONFIRMED,
            outcome="success",
            user_id=user.id,
        )
        return user

    # --- password reset ---------------------------------------------------
    def request_password_reset(self, *, email: str, context: RequestContext) -> DeliveryOutcome:
        user = self._lookup(email)
        if user is None or not user.is_active:
            return self._generic_outcome()
        token = self._issue_token(user, purpose=PASSWORD_RESET)
        self._record(
            context,
            event=audit.PASSWORD_RESET_REQUESTED,
            outcome="success",
            user_id=user.id,
        )
        return self._deliver(reset_message(self._settings, to=user.email_display, token=token))

    def complete_password_reset(
        self, *, token: str, new_password: str, context: RequestContext
    ) -> UserRecord:
        """Set a new password and sign every device out atomically."""
        try:
            self._passwords.policy.validate(new_password)
        except PasswordPolicyError as error:
            raise InvalidInputError(error.message, field="password") from error

        user = self._consume(token, purpose=PASSWORD_RESET, context=context)
        now = utc_now()
        user.password_hash = self._passwords.hash(new_password)
        user.security_version += 1
        if not user.email_verified:
            # Receiving the reset email proves control of the address.
            user.email_verified_at = now
        revoked = self.repository.revoke_all_sessions(user.id, now=now, reason="password_reset")
        self.repository.revoke_outstanding_tokens(user.id, purpose=PASSWORD_RESET, now=now)
        self.repository.revoke_outstanding_tokens(user.id, purpose=EMAIL_VERIFICATION, now=now)
        self._record(
            context,
            event=audit.PASSWORD_RESET_COMPLETED,
            outcome="success",
            user_id=user.id,
            metadata={"sessionCount": revoked},
        )
        self._record(
            context,
            event=audit.PASSWORD_CHANGED,
            outcome="success",
            user_id=user.id,
            metadata={"source": "reset"},
        )
        return user

    # --- internals --------------------------------------------------------
    def _lookup(self, email: str) -> UserRecord | None:
        try:
            normalized = normalize_email(email)
        except InvalidEmailError as error:
            raise InvalidInputError(str(error), field="email") from error
        return self.repository.find_user_by_canonical_email(normalized.canonical)

    def _ttl_seconds(self, purpose: str) -> int:
        if purpose == PASSWORD_RESET:
            return self._settings.auth_reset_token_ttl_seconds
        return self._settings.auth_verification_token_ttl_seconds

    def _issue_token(self, user: UserRecord, *, purpose: str) -> str:
        now = utc_now()
        # Policy: a new request supersedes every outstanding link for the same
        # purpose, so an older intercepted email stops working immediately.
        self.repository.revoke_outstanding_tokens(user.id, purpose=purpose, now=now)
        token = generate_token()
        self.repository.add_one_time_token(
            OneTimeTokenRecord(
                user_id=user.id,
                purpose=purpose,
                token_digest=digest_token(token, secret=self._settings.auth_secret),
                created_at=now,
                expires_at=now + timedelta(seconds=self._ttl_seconds(purpose)),
            )
        )
        return token

    def _issue_verification_credentials(self, user: UserRecord) -> tuple[str, str]:
        now = utc_now()
        self.repository.revoke_outstanding_tokens(user.id, purpose=EMAIL_VERIFICATION, now=now)
        token = generate_token()
        code = generate_verification_code()
        expires_at = now + timedelta(seconds=self._ttl_seconds(EMAIL_VERIFICATION))
        for digest in (
            digest_token(token, secret=self._settings.auth_secret),
            verification_code_digest(user.email_canonical, code, secret=self._settings.auth_secret),
        ):
            self.repository.add_one_time_token(
                OneTimeTokenRecord(
                    user_id=user.id,
                    purpose=EMAIL_VERIFICATION,
                    token_digest=digest,
                    created_at=now,
                    expires_at=expires_at,
                )
            )
        return token, code

    def _consume(self, token: str, *, purpose: str, context: RequestContext) -> UserRecord:
        if not looks_like_token(token):
            self._record_rejection(context, purpose=purpose, reason="malformed")
            raise InvalidTokenError()
        digest = digest_token(token, secret=self._settings.auth_secret)
        return self._consume_digest(digest, purpose=purpose, context=context)

    def _consume_digest(self, digest: str, *, purpose: str, context: RequestContext) -> UserRecord:
        now = utc_now()
        user_id = self.repository.consume_one_time_token(digest, purpose=purpose, now=now)
        if user_id is None:
            existed = self.repository.token_exists(digest, purpose=purpose)
            self._record_rejection(
                context, purpose=purpose, reason="expired_or_used" if existed else "unknown"
            )
            raise ExpiredTokenError() if existed else InvalidTokenError()
        user = self.repository.get_user(user_id)
        if user is None or not user.is_active:
            self._record_rejection(context, purpose=purpose, reason="account_unavailable")
            raise InvalidTokenError()
        return user

    def _record_rejection(self, context: RequestContext, *, purpose: str, reason: str) -> None:
        event = (
            audit.PASSWORD_RESET_REJECTED
            if purpose == PASSWORD_RESET
            else audit.EMAIL_VERIFICATION_REJECTED
        )
        self._record(
            context,
            event=event,
            outcome="rejected",
            user_id=None,
            metadata={"reason": reason, "purpose": purpose},
        )

    def _deliver(self, message: EmailMessage) -> DeliveryOutcome:
        if not self._email.available:
            self._email.send(message)
            return DeliveryOutcome(status="disabled", provider=self._email.id)
        try:
            self._email.send(message)
        except EmailDeliveryError:
            # The transport error is already logged. The caller still returns a
            # generic response so a delivery failure cannot be used as a probe.
            return DeliveryOutcome(status="failed", provider=self._email.id)
        return DeliveryOutcome(status="sent", provider=self._email.id)

    def _generic_outcome(self) -> DeliveryOutcome:
        return DeliveryOutcome(
            status="sent" if self._email.available else "disabled",
            provider=self._email.id,
        )

    def _record(
        self,
        context: RequestContext,
        *,
        event: str,
        outcome: str,
        user_id: str | None,
        metadata: dict | None = None,
    ) -> None:
        audit.record_security_event(
            self._session,
            event=event,
            outcome=outcome,
            actor_user_id=user_id,
            subject_user_id=user_id,
            request_id=context.request_id or None,
            ip_prefix=(
                audit.network_prefix(context.client_ip)
                if self._settings.auth_audit_store_ip_prefix
                else None
            ),
            device_summary=context.device_summary,
            metadata=metadata,
        )
