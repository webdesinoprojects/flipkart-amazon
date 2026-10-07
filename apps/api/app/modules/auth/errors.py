"""Domain errors for the account lifecycle.

These classes describe what the product decided, not how HTTP should answer.
:mod:`app.modules.auth.routes` owns the mapping to status codes so the service
layer stays transport-independent and testable without a client.

Messages are written for the person reading them and are deliberately generic
where a specific message would disclose whether an account exists.
"""

from __future__ import annotations


class AuthError(Exception):
    code = "AUTH_ERROR"
    message = "The request could not be completed."

    def __init__(self, message: str | None = None) -> None:
        super().__init__(message or self.message)
        if message:
            self.message = message


class InvalidCredentialsError(AuthError):
    code = "INVALID_CREDENTIALS"
    message = "That email and password combination is not valid."


class AccountSuspendedError(AuthError):
    code = "ACCOUNT_SUSPENDED"
    message = "This account is suspended. Contact support to restore access."


class EmailNotVerifiedError(AuthError):
    code = "EMAIL_NOT_VERIFIED"
    message = "Verify your email address before signing in."


class InvalidInputError(AuthError):
    code = "VALIDATION_ERROR"
    message = "Check the highlighted fields and try again."

    def __init__(self, message: str, *, field: str) -> None:
        super().__init__(message)
        self.field = field

    @property
    def fields(self) -> dict[str, list[str]]:
        return {self.field: [self.message]}


class InvalidTokenError(AuthError):
    code = "INVALID_TOKEN"
    message = "That link is invalid or has already been used. Request a new one."


class ExpiredTokenError(AuthError):
    code = "EXPIRED_TOKEN"
    message = "That link has expired. Request a new one."


class NotFoundError(AuthError):
    code = "NOT_FOUND"
    message = "That resource is no longer available."


class SessionRequiredError(AuthError):
    code = "UNAUTHENTICATED"
    message = "Sign in to continue."


class PermissionDeniedError(AuthError):
    code = "FORBIDDEN"
    message = "Your account does not have access to this area."


class CsrfValidationError(AuthError):
    code = "CSRF_FAILED"
    message = "Your session security check failed. Reload the page and try again."


class RateLimitedError(AuthError):
    code = "RATE_LIMITED"
    message = "Too many attempts. Wait a moment and try again."

    def __init__(self, retry_after_seconds: int, bucket: str) -> None:
        super().__init__()
        self.retry_after_seconds = retry_after_seconds
        self.bucket = bucket
