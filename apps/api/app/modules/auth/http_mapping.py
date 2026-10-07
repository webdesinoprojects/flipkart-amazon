"""The only place where an auth domain error becomes an HTTP status.

Keeping the table here means :mod:`app.modules.auth.service` never imports
status codes, and a reviewer can read the whole 401-versus-403 policy in one
screen:

* **401** — no identity, or an identity that cannot be established.
* **403** — identity established, but the action is refused (wrong role, failed
  CSRF, suspended account, unverified address when verification is required).
"""

from __future__ import annotations

from fastapi import FastAPI
from fastapi.responses import JSONResponse
from starlette.requests import Request

from ...platform.http.errors import error_response
from ...platform.http.request_context import request_id_of
from .errors import (
    AccountSuspendedError,
    AuthError,
    CsrfValidationError,
    EmailNotVerifiedError,
    ExpiredTokenError,
    InvalidCredentialsError,
    InvalidInputError,
    InvalidTokenError,
    NotFoundError,
    PermissionDeniedError,
    RateLimitedError,
    SessionRequiredError,
)

_STATUS_BY_ERROR: tuple[tuple[type[AuthError], int], ...] = (
    (InvalidInputError, 422),
    (InvalidCredentialsError, 401),
    (SessionRequiredError, 401),
    (AccountSuspendedError, 403),
    (EmailNotVerifiedError, 403),
    (PermissionDeniedError, 403),
    (CsrfValidationError, 403),
    (NotFoundError, 404),
    (ExpiredTokenError, 400),
    (InvalidTokenError, 400),
    (RateLimitedError, 429),
)


def status_for(error: AuthError) -> int:
    for error_type, status_code in _STATUS_BY_ERROR:
        if isinstance(error, error_type):
            return status_code
    return 400


def register_auth_error_handler(app: FastAPI) -> None:
    @app.exception_handler(AuthError)
    async def handle_auth_error(request: Request, exc: AuthError) -> JSONResponse:
        headers: dict[str, str] = {}
        if isinstance(exc, RateLimitedError):
            headers["Retry-After"] = str(exc.retry_after_seconds)
        return error_response(
            status_code=status_for(exc),
            code=exc.code,
            message=exc.message,
            request_id=request_id_of(request),
            fields=exc.fields if isinstance(exc, InvalidInputError) else None,
            headers=headers or None,
        )
