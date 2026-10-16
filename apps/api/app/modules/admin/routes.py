"""Private operator APIs; all routes require a current admin role."""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Query, Response

from ...platform.clock import utc_now
from ...platform.http.errors import ApiError
from ...platform.rate_limit.limiter import RateLimitRule
from ..audit import service as audit
from ..auth import rate_limits as limits
from ..auth.cookies import no_store
from ..auth.dependencies import (
    ContextDep,
    CurrentAdminDep,
    LimiterDep,
    ProtectedMutationDep,
    SessionDep,
    SettingsDep,
)
from ..auth.schemas import AdminAccessOut
from . import service
from .grants import issue_credit_grant
from .schemas import CreditGrantIn

router = APIRouter(prefix="/api/v1/admin", tags=["admin"])

AVAILABLE_CAPABILITIES: tuple[str, ...] = (
    "users.read_summary",
    "payments.read",
    "system.health.read",
    "audit.read",
    "credits.grant",
)


@router.get("/access-check", response_model=AdminAccessOut)
def access_check(
    response: Response,
    db: SessionDep,
    context: ContextDep,
    admin: CurrentAdminDep,
) -> AdminAccessOut:
    """Return 200 only for an authenticated admin.

    An unauthenticated caller gets 401 from ``require_session``; an
    authenticated non-admin gets 403 from ``require_admin``. Both outcomes are
    recorded in the security audit trail.
    """
    no_store(response)
    audit.record_security_event(
        db,
        event=audit.ADMIN_ACCESS_GRANTED,
        outcome="success",
        actor_user_id=admin.user.id,
        request_id=context.request_id or None,
        device_summary=context.device_summary,
        metadata={"role": admin.user.role},
    )
    db.commit()
    return AdminAccessOut(
        role="admin",
        userId=admin.user.id,
        checkedAt=utc_now(),
        capabilities=list(AVAILABLE_CAPABILITIES),
    )


@router.get("/overview")
def read_overview(response: Response, db: SessionDep, _: CurrentAdminDep) -> dict:
    no_store(response)
    return service.overview(db)


@router.get("/users")
def read_users(
    response: Response,
    db: SessionDep,
    settings: SettingsDep,
    _: CurrentAdminDep,
    q: Annotated[str | None, Query(max_length=80)] = None,
    limit: Annotated[int, Query(ge=1, le=50)] = 20,
    offset: Annotated[int, Query(ge=0, le=100_000)] = 0,
) -> dict:
    no_store(response)
    return service.user_rows(db, settings, query=q, limit=limit, offset=offset)


@router.get("/users/{user_id}")
def read_user(
    user_id: str,
    response: Response,
    db: SessionDep,
    settings: SettingsDep,
    _: CurrentAdminDep,
) -> dict:
    no_store(response)
    return service.user_detail(db, settings, user_id)


@router.get("/payments")
def read_payments(
    response: Response,
    db: SessionDep,
    _: CurrentAdminDep,
    limit: Annotated[int, Query(ge=1, le=50)] = 20,
    offset: Annotated[int, Query(ge=0, le=100_000)] = 0,
) -> dict:
    no_store(response)
    return service.payment_rows(db, limit=limit, offset=offset)


@router.get("/operations")
def read_operations(response: Response, db: SessionDep, _: CurrentAdminDep) -> dict:
    no_store(response)
    return service.operations(db)


@router.get("/audit")
def read_audit(
    response: Response,
    db: SessionDep,
    _: CurrentAdminDep,
    limit: Annotated[int, Query(ge=1, le=50)] = 20,
    offset: Annotated[int, Query(ge=0, le=100_000)] = 0,
) -> dict:
    no_store(response)
    return service.audit_rows(db, limit=limit, offset=offset)


@router.post("/users/{user_id}/credit-grants", status_code=201)
def grant_credits(
    user_id: str,
    body: CreditGrantIn,
    response: Response,
    db: SessionDep,
    admin: CurrentAdminDep,
    _: ProtectedMutationDep,
    limiter: LimiterDep,
    context: ContextDep,
) -> dict:
    no_store(response)
    degraded = limits.enforce(
        limiter,
        [
            (RateLimitRule("admin_credit_grant_account", 12, 3600), admin.user.id),
            (RateLimitRule("admin_credit_grant_ip", 30, 3600), context.client_ip or ""),
        ],
    )
    if degraded:
        raise ApiError(
            status_code=503,
            code="ADMIN_RATE_LIMIT_UNAVAILABLE",
            message="Credit grants are temporarily unavailable.",
        )
    grant, created = issue_credit_grant(
        db,
        user_id=user_id,
        admin_user_id=admin.user.id,
        body=body,
        audit_request_id=context.request_id or None,
        device_summary=context.device_summary,
    )
    if not created:
        response.status_code = 200
    return {
        "id": grant.id,
        "amount": grant.amount,
        "remaining": grant.remaining,
        "expiresAt": grant.expires_at,
    }
