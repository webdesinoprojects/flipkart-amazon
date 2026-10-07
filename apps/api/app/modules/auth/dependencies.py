"""FastAPI dependencies for authentication and the two-role authorization model.

``require_session`` and ``require_admin`` are the only approved ways for a route
to learn who is calling. Both validate against PostgreSQL on every request; a
cookie's mere presence is never sufficient. The admin dependency is written so
the later admin panel can reuse it unchanged.
"""

from __future__ import annotations

from typing import Annotated

from fastapi import Depends, Request
from sqlalchemy.orm import Session

from ...capabilities.email.provider import EmailProvider
from ...config import Settings
from ...database import get_session
from ...dependencies import (
    get_email_provider,
    get_password_service,
    get_rate_limiter,
    settings_dependency,
)
from ...platform.http.request_context import client_ip, request_id_of
from ...platform.rate_limit.limiter import RateLimiter
from ..audit import service as audit
from .csrf import assert_csrf_token, assert_trusted_origin
from .device import summarize_device
from .errors import PermissionDeniedError, SessionRequiredError
from .passwords import PasswordHashingService
from .recovery import RecoveryService
from .service import AuthenticatedSession, AuthService, RequestContext

SessionDep = Annotated[Session, Depends(get_session)]
SettingsDep = Annotated[Settings, Depends(settings_dependency)]
PasswordsDep = Annotated[PasswordHashingService, Depends(get_password_service)]
EmailDep = Annotated[EmailProvider, Depends(get_email_provider)]
LimiterDep = Annotated[RateLimiter, Depends(get_rate_limiter)]


def build_request_context(request: Request, settings: SettingsDep) -> RequestContext:
    return RequestContext(
        request_id=request_id_of(request),
        client_ip=client_ip(request, trusted_proxy_count=settings.trusted_proxy_count),
        device_summary=summarize_device(request.headers.get("user-agent")),
    )


ContextDep = Annotated[RequestContext, Depends(build_request_context)]


def build_auth_service(
    session: SessionDep, settings: SettingsDep, passwords: PasswordsDep
) -> AuthService:
    return AuthService(session=session, settings=settings, passwords=passwords)


AuthServiceDep = Annotated[AuthService, Depends(build_auth_service)]


def build_recovery_service(
    session: SessionDep,
    settings: SettingsDep,
    passwords: PasswordsDep,
    email_provider: EmailDep,
) -> RecoveryService:
    return RecoveryService(
        session=session,
        settings=settings,
        passwords=passwords,
        email_provider=email_provider,
    )


RecoveryServiceDep = Annotated[RecoveryService, Depends(build_recovery_service)]


def optional_session(
    request: Request, settings: SettingsDep, auth: AuthServiceDep
) -> AuthenticatedSession | None:
    """Resolve the caller without requiring one. Used by ``/auth/me``."""
    token = request.cookies.get(settings.session_cookie_name)
    return auth.resolve_session(token)


OptionalSessionDep = Annotated[AuthenticatedSession | None, Depends(optional_session)]


def require_session(authenticated: OptionalSessionDep) -> AuthenticatedSession:
    """401 when no valid session is presented."""
    if authenticated is None:
        raise SessionRequiredError()
    return authenticated


CurrentSessionDep = Annotated[AuthenticatedSession, Depends(require_session)]


def require_csrf(
    request: Request,
    settings: SettingsDep,
    session: SessionDep,
    context: ContextDep,
    authenticated: CurrentSessionDep,
) -> AuthenticatedSession:
    """401 then CSRF: a cookie-authenticated mutation needs both."""
    assert_trusted_origin(request, settings=settings)
    try:
        assert_csrf_token(request, session=authenticated.session, settings=settings)
    except Exception:
        audit.record_security_event(
            session,
            event=audit.CSRF_REJECTED,
            outcome="rejected",
            actor_user_id=authenticated.user.id,
            request_id=context.request_id or None,
            device_summary=context.device_summary,
        )
        session.commit()
        raise
    return authenticated


ProtectedMutationDep = Annotated[AuthenticatedSession, Depends(require_csrf)]


def require_admin(
    session: SessionDep,
    context: ContextDep,
    authenticated: CurrentSessionDep,
) -> AuthenticatedSession:
    """403 for an authenticated non-admin; 401 is already handled upstream.

    Every admin-only API must depend on this. Hiding an admin link in the UI is
    not authorization, and there is no CSRF or rate-limit exemption for admins.
    """
    if not authenticated.user.is_admin:
        audit.record_security_event(
            session,
            event=audit.ADMIN_ACCESS_DENIED,
            outcome="rejected",
            actor_user_id=authenticated.user.id,
            request_id=context.request_id or None,
            device_summary=context.device_summary,
            metadata={"role": authenticated.user.role},
        )
        session.commit()
        raise PermissionDeniedError()
    return authenticated


CurrentAdminDep = Annotated[AuthenticatedSession, Depends(require_admin)]
