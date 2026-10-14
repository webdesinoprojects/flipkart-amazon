"""HTTP adapter for registration, sign-in, and session management.

Route bodies stay thin on purpose: validate, enforce abuse controls, delegate to
the service, map the result to a DTO, and set cookies. Every business rule lives
in :mod:`app.modules.auth.service`.
"""

from __future__ import annotations

from fastapi import APIRouter, Request, Response, status

from ...config import Settings
from . import rate_limits as limits
from .cookies import clear_auth_cookies, no_store, set_csrf_cookie, set_session_cookie
from .csrf import assert_trusted_origin, ensure_csrf_token
from .dependencies import (
    AuthServiceDep,
    ContextDep,
    CurrentSessionDep,
    LimiterDep,
    OptionalSessionDep,
    ProtectedMutationDep,
    RecoveryServiceDep,
    SessionDep,
    SettingsDep,
)
from .email_address import InvalidEmailError, normalize_email
from .errors import NotFoundError, SessionRequiredError
from .presenters import present_session, present_user
from .schemas import (
    AcceptedOut,
    CsrfOut,
    LoginOut,
    LoginRequest,
    LogoutOut,
    MeOut,
    RegisterRequest,
    SessionListOut,
)
from .service import IssuedSession, RequestContext

router = APIRouter(prefix="/api/v1/auth", tags=["auth"])

REGISTRATION_MESSAGE = (
    "If that address can be used, we sent a six-digit verification code and secure link."
)
REGISTRATION_MESSAGE_NO_EMAIL = (
    "Your request was accepted, but email delivery is not configured in this "
    "environment, so no message was sent. Ask the operator to confirm your address."
)


def _account_key(email: str) -> str:
    """Rate-limit key derived from the submitted address, not a found account.

    Using the submitted value means a limit rejection reveals nothing about
    whether an account exists. The value is hashed before it reaches Valkey.
    """
    try:
        return normalize_email(email).canonical
    except InvalidEmailError:
        return email.strip().lower()[:254]


def _apply_session(response: Response, *, settings: Settings, issued: IssuedSession) -> None:
    set_session_cookie(
        response,
        settings=settings,
        token=issued.token,
        max_age_seconds=issued.max_age_seconds,
    )
    set_csrf_cookie(
        response,
        settings=settings,
        token=issued.csrf_token,
        max_age_seconds=issued.max_age_seconds,
    )
    no_store(response)


def _note_degradation(db, context: RequestContext, *, degraded: bool, bucket: str) -> None:
    if degraded:
        limits.record_degradation(db, request_id=context.request_id, bucket=bucket)


@router.get("/csrf", response_model=CsrfOut)
def issue_csrf(
    request: Request,
    response: Response,
    db: SessionDep,
    settings: SettingsDep,
    authenticated: OptionalSessionDep,
) -> CsrfOut:
    """Return the CSRF token bound to the current session.

    Without a session there is nothing to bind a token to, so an unauthenticated
    caller receives an empty value that can never satisfy a mutation. That keeps
    the endpoint safe to call from any page without disclosing session state.
    """
    no_store(response)
    if authenticated is None:
        return CsrfOut(csrfToken="")
    token, rotated = ensure_csrf_token(request, session=authenticated.session, settings=settings)
    if rotated:
        db.commit()
        set_csrf_cookie(
            response,
            settings=settings,
            token=token,
            max_age_seconds=settings.auth_session_absolute_seconds,
        )
    return CsrfOut(csrfToken=token)


@router.get("/me", response_model=MeOut)
def read_me(response: Response, authenticated: OptionalSessionDep) -> MeOut:
    """Authoritative identity check used by Server Components and the browser.

    Returns 401 rather than a null user so that an expired session is a clear,
    machine-readable outcome for both callers.
    """
    no_store(response)
    if authenticated is None:
        raise SessionRequiredError()
    return MeOut(user=present_user(authenticated.user))


@router.post("/register", response_model=AcceptedOut, status_code=status.HTTP_202_ACCEPTED)
def register(
    request: Request,
    response: Response,
    payload: RegisterRequest,
    db: SessionDep,
    settings: SettingsDep,
    limiter: LimiterDep,
    context: ContextDep,
    auth: AuthServiceDep,
    recovery: RecoveryServiceDep,
) -> AcceptedOut:
    """Create a `user` account and send a verification link.

    The response is identical whether or not the address was already registered,
    and no session is issued, so registration cannot be used to enumerate
    accounts. Public registration can only ever create the ``user`` role;
    ``role`` is not an accepted field and an extra field is a 422.
    """
    assert_trusted_origin(request, settings=settings)
    rules = limits.build_rate_limits(settings)
    degraded = limits.enforce(limiter, [(rules.register_ip, context.client_ip or "")])

    outcome = auth.register(email=payload.email, password=payload.password, context=context)
    delivery = (
        recovery.send_verification_for_new_account(outcome.user)
        if outcome.created
        else recovery.notify_existing_account(outcome.user)
    )
    _note_degradation(db, context, degraded=degraded, bucket=rules.register_ip.bucket)
    db.commit()
    no_store(response)
    return AcceptedOut(
        delivery=delivery.status,
        message=(
            REGISTRATION_MESSAGE if delivery.status == "sent" else REGISTRATION_MESSAGE_NO_EMAIL
        ),
    )


@router.post("/login", response_model=LoginOut)
def login(
    request: Request,
    response: Response,
    payload: LoginRequest,
    db: SessionDep,
    settings: SettingsDep,
    limiter: LimiterDep,
    context: ContextDep,
    auth: AuthServiceDep,
) -> LoginOut:
    """Verify credentials and issue a brand-new session.

    Rate limits are consumed before Argon2 runs so a flood cannot turn the
    hashing cost into a denial of service. Both an IP bucket and an account-key
    bucket apply. A new session row is always created, so a session identifier
    supplied by an attacker can never be promoted to an authenticated one.
    """
    assert_trusted_origin(request, settings=settings)
    rules = limits.build_rate_limits(settings)
    degraded = limits.enforce(
        limiter,
        [
            (rules.login_ip, context.client_ip or ""),
            (rules.login_account, _account_key(payload.email)),
        ],
    )

    try:
        user = auth.authenticate(email=payload.email, password=payload.password, context=context)
    except Exception:
        # The service already wrote an audit row describing the attempt; commit
        # it so a failed sign-in is still recorded.
        db.commit()
        raise
    issued = auth.issue_session(user, context=context)
    _note_degradation(db, context, degraded=degraded, bucket=rules.login_ip.bucket)
    db.commit()
    _apply_session(response, settings=settings, issued=issued)
    return LoginOut(user=present_user(user), csrfToken=issued.csrf_token)


@router.post("/logout", response_model=LogoutOut)
def logout(
    response: Response,
    db: SessionDep,
    settings: SettingsDep,
    context: ContextDep,
    auth: AuthServiceDep,
    authenticated: ProtectedMutationDep,
) -> LogoutOut:
    """Revoke the current session and clear both cookies.

    Repeating the call after the cookies are gone returns 401: there is no
    session left to sign out of. That is the documented behaviour.
    """
    auth.logout(authenticated, context=context)
    db.commit()
    clear_auth_cookies(response, settings=settings)
    no_store(response)
    return LogoutOut()


@router.get("/sessions", response_model=SessionListOut)
def list_sessions(
    response: Response, auth: AuthServiceDep, authenticated: CurrentSessionDep
) -> SessionListOut:
    no_store(response)
    records = auth.list_sessions(authenticated.user.id)
    return SessionListOut(
        sessions=[
            present_session(record, current_session_id=authenticated.session.id)
            for record in records
        ]
    )


@router.delete("/sessions/{session_id}", status_code=status.HTTP_204_NO_CONTENT)
def revoke_session(
    session_id: str,
    response: Response,
    db: SessionDep,
    settings: SettingsDep,
    context: ContextDep,
    auth: AuthServiceDep,
    authenticated: ProtectedMutationDep,
) -> None:
    """Revoke one of the caller's own sessions.

    The update is scoped to the caller's ``user_id``, so a session id belonging
    to another account matches nothing and the answer is 404. Cross-user
    revocation is therefore impossible rather than merely discouraged.
    """
    revoked = auth.revoke_session(session_id=session_id, actor=authenticated, context=context)
    db.commit()
    if not revoked:
        raise NotFoundError("That session is no longer active.")
    if session_id == authenticated.session.id:
        clear_auth_cookies(response, settings=settings)
    no_store(response)
