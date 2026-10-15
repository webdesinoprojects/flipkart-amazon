import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from sqlalchemy import text

from .config import get_settings
from .database import engine
from .models_registry import import_all_models
from .modules.admin.routes import router as admin_router
from .modules.auth.http_mapping import register_auth_error_handler
from .modules.auth.recovery_routes import router as auth_recovery_router
from .modules.auth.routes import router as auth_router
from .modules.billing.routes import router as billing_router
from .modules.history.routes import router as history_router
from .platform.database.migrations import migration_status
from .platform.http.body_limit import JsonBodyLimitMiddleware
from .platform.http.errors import register_error_handlers
from .platform.http.request_context import RequestContextMiddleware
from .platform.logging import configure_logging
from .routes import router

logger = logging.getLogger("app.startup")


@asynccontextmanager
async def lifespan(_: FastAPI):
    """Start up without ever mutating the schema.

    Earlier releases called ``Base.metadata.create_all`` here. Production
    schema changes are now applied by a deliberate ``alembic upgrade head``
    step that Compose runs to completion before the API or the worker starts,
    so two instances can never race to create tables and a running process
    cannot silently alter a production database.
    """
    settings = get_settings()
    configure_logging()
    import_all_models()
    try:
        with engine.connect() as connection:
            connection.execute(text("SELECT 1"))
        status = migration_status(engine)
    except Exception as error:  # noqa: BLE001 - never block boot on a probe
        logger.warning("database_probe_failed", extra={"error_type": type(error).__name__})
        status = "unknown"
    logger.info(
        "api_started",
        extra={
            "environment": settings.environment,
            "migrations": status,
            "cookie_secure": settings.auth_cookie_secure,
        },
    )
    if status != "up_to_date":
        # Readiness reports this too; the log line is what an operator greps.
        logger.warning("migrations_not_at_head", extra={"migrations": status})
    yield


app = FastAPI(
    title="SellerLabel API",
    version="0.2.0",
    lifespan=lifespan,
)

_settings = get_settings()
app.add_middleware(JsonBodyLimitMiddleware, max_bytes=_settings.max_json_body_bytes)
app.add_middleware(RequestContextMiddleware)

register_error_handlers(app)
register_auth_error_handler(app)

app.include_router(router)
app.include_router(auth_router)
app.include_router(auth_recovery_router)
app.include_router(admin_router)
app.include_router(history_router)
app.include_router(billing_router)
