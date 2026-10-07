"""HTTP adapter for email verification and password reset.

All four endpoints return a uniform, account-independent response for the
request steps, and a uniform error for an invalid, expired, or already-used
token. None of them issues a session: after a reset the person signs in again
with the new password, which keeps exactly one place where a session is born.
"""

from __future__ import annotations

from fastapi import APIRouter, Request, Response

from . import rate_limits as limits
from .cookies import clear_auth_cookies, no_store
from .csrf import assert_trusted_origin
from .dependencies import (
    ContextDep,
    LimiterDep,
    RecoveryServiceDep,
    SessionDep,
    SettingsDep,
)
from .presenters import present_user
from .routes import _account_key, _note_degradation
from .schemas import (
    AcceptedOut,
    EmailOnlyRequest,
    PasswordResetCompletedOut,
    PasswordResetRequest,
    TokenRequest,
    VerificationConfirmedOut,
)

router = APIRouter(prefix="/api/v1/auth", tags=["auth"])

SENT_MESSAGE = "If that address has an account, we have sent an email with next steps."
DISABLED_MESSAGE = (
    "Email delivery is not configured in this environment, so no message was sent. "
    "Ask the operator to complete this step for you."
)


def _message_for(status: str) -> str:
    return SENT_MESSAGE if status == "sent" else DISABLED_MESSAGE


@router.post("/verify-email/request", response_model=AcceptedOut)
def request_email_verification(
    request: Request,
    response: Response,
    payload: EmailOnlyRequest,
    db: SessionDep,
    settings: SettingsDep,
    limiter: LimiterDep,
    context: ContextDep,
    recovery: RecoveryServiceDep,
) -> AcceptedOut:
    """Resend a verification link, superseding any earlier outstanding one."""
    assert_trusted_origin(request, settings=settings)
    rules = limits.build_rate_limits(settings)
    degraded = limits.enforce(
        limiter,
        [
            (rules.email_ip, context.client_ip or ""),
            (rules.email_account, _account_key(payload.email)),
        ],
    )
    delivery = recovery.request_verification(email=payload.email, context=context)
    _note_degradation(db, context, degraded=degraded, bucket=rules.email_ip.bucket)
    db.commit()
    no_store(response)
    return AcceptedOut(delivery=delivery.status, message=_message_for(delivery.status))


@router.post("/verify-email/confirm", response_model=VerificationConfirmedOut)
def confirm_email_verification(
    request: Request,
    response: Response,
    payload: TokenRequest,
    db: SessionDep,
    settings: SettingsDep,
    limiter: LimiterDep,
    context: ContextDep,
    recovery: RecoveryServiceDep,
) -> VerificationConfirmedOut:
    """Consume a verification token exactly once."""
    assert_trusted_origin(request, settings=settings)
    rules = limits.build_rate_limits(settings)
    try:
        limits.enforce(limiter, [(rules.reset_ip, context.client_ip or "")])
        user = recovery.confirm_verification(token=payload.token, context=context)
    except Exception:
        db.commit()
        raise
    db.commit()
    no_store(response)
    return VerificationConfirmedOut(user=present_user(user))


@router.post("/password/forgot", response_model=AcceptedOut)
def request_password_reset(
    request: Request,
    response: Response,
    payload: EmailOnlyRequest,
    db: SessionDep,
    settings: SettingsDep,
    limiter: LimiterDep,
    context: ContextDep,
    recovery: RecoveryServiceDep,
) -> AcceptedOut:
    """Always answer the same way, whether or not the address has an account."""
    assert_trusted_origin(request, settings=settings)
    rules = limits.build_rate_limits(settings)
    degraded = limits.enforce(
        limiter,
        [
            (rules.email_ip, context.client_ip or ""),
            (rules.email_account, _account_key(payload.email)),
        ],
    )
    delivery = recovery.request_password_reset(email=payload.email, context=context)
    _note_degradation(db, context, degraded=degraded, bucket=rules.email_ip.bucket)
    db.commit()
    no_store(response)
    return AcceptedOut(delivery=delivery.status, message=_message_for(delivery.status))


@router.post("/password/reset", response_model=PasswordResetCompletedOut)
def complete_password_reset(
    request: Request,
    response: Response,
    payload: PasswordResetRequest,
    db: SessionDep,
    settings: SettingsDep,
    limiter: LimiterDep,
    context: ContextDep,
    recovery: RecoveryServiceDep,
) -> PasswordResetCompletedOut:
    """Set a new password, then sign every device out in the same transaction."""
    assert_trusted_origin(request, settings=settings)
    rules = limits.build_rate_limits(settings)
    try:
        limits.enforce(limiter, [(rules.reset_ip, context.client_ip or "")])
        recovery.complete_password_reset(
            token=payload.token, new_password=payload.password, context=context
        )
    except Exception:
        db.commit()
        raise
    db.commit()
    # The caller's own cookies are now worthless; remove them so the browser
    # does not keep presenting a revoked session.
    clear_auth_cookies(response, settings=settings)
    no_store(response)
    return PasswordResetCompletedOut()
