"""Idempotent removal of expired sessions and one-time tokens.

Run on a schedule by Celery Beat. Expired rows are already unusable — the
lookup queries exclude them — so this job only reclaims space and keeps the
user-visible session list honest. It is therefore safe to run twice, to skip a
run, or to fail: a failed cleanup must never break sign-in, but it must be
observable, so the task logs its counts and re-raises nothing silently.
"""

from __future__ import annotations

from dataclasses import dataclass

from sqlalchemy.orm import Session

from ...platform.clock import utc_now
from .repository import AuthRepository

EXPIRED_RETENTION_SECONDS = 7 * 86400
"""Keep expired rows briefly so a support question can still be answered."""


@dataclass(frozen=True, slots=True)
class CleanupReport:
    sessions_removed: int
    tokens_removed: int


def purge_expired_auth_rows(
    session: Session, *, retain_seconds: int = EXPIRED_RETENTION_SECONDS
) -> CleanupReport:
    repository = AuthRepository(session)
    now = utc_now()
    sessions_removed = repository.delete_expired_sessions(now=now, retain_seconds=retain_seconds)
    tokens_removed = repository.delete_expired_tokens(now=now, retain_seconds=retain_seconds)
    session.commit()
    return CleanupReport(sessions_removed=sessions_removed, tokens_removed=tokens_removed)
