"""Single source of the application's notion of "now".

Every stored timestamp is timezone-aware UTC. Business periods that a human
sees (for example a quota day in Asia/Kolkata) are derived from UTC later; they
are never stored as naive local time.
"""

from __future__ import annotations

from datetime import UTC, datetime


def utc_now() -> datetime:
    return datetime.now(UTC)


def as_utc(value: datetime) -> datetime:
    """Treat a stored timestamp as UTC even if the driver dropped the offset.

    PostgreSQL returns timezone-aware values for ``TIMESTAMP WITH TIME ZONE``.
    SQLite, which the unit suite uses for throwaway databases, has no timezone
    storage and returns naive values. Everything written here is UTC, so
    attaching UTC to a naive value restores the original instant instead of
    guessing a local zone.
    """
    return value if value.tzinfo is not None else value.replace(tzinfo=UTC)
