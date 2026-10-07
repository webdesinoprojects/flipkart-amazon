"""Single import point for every mapped table.

Alembic autogeneration and the test harness both need the full
``Base.metadata``. Importing model modules here — rather than scattered through
application code — means a new table is either registered in one obvious place
or it is missing from the metadata loudly rather than silently.
"""

from __future__ import annotations


def import_all_models() -> None:
    from . import models  # noqa: F401 - batches, documents, events, layouts
    from .modules.audit import models as audit_models  # noqa: F401
    from .modules.auth import models as auth_models  # noqa: F401
