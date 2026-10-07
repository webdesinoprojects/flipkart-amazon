"""Admin surface for this phase: an authorization proof, not a panel.

The single endpoint exists so that admin-only access is enforced and tested in
the backend before any admin UI is built. The later admin panel reuses
``require_admin`` unchanged; it does not get its own, looser check.
"""

from __future__ import annotations

from fastapi import APIRouter, Response

from ...platform.clock import utc_now
from ..audit import service as audit
from ..auth.cookies import no_store
from ..auth.dependencies import ContextDep, CurrentAdminDep, SessionDep
from ..auth.schemas import AdminAccessOut

router = APIRouter(prefix="/api/v1/admin", tags=["admin"])

PLANNED_CAPABILITIES: tuple[str, ...] = (
    "users.read_summary",
    "users.suspend",
    "credits.adjust",
    "plans.manage",
    "payments.read",
    "payments.reconcile",
    "system.health.read",
    "audit.read",
)
"""Named for the future panel. None of them is implemented in this phase."""


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
        capabilities=list(PLANNED_CAPABILITIES),
    )
