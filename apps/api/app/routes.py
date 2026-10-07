import asyncio
import json
from datetime import UTC, datetime, timedelta
from typing import Annotated

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status
from fastapi.responses import StreamingResponse
from sqlalchemy import func, select, text
from sqlalchemy.orm import Session, selectinload

from .capabilities.email.provider import EmailProvider
from .config import Settings
from .database import SessionLocal, get_session
from .dependencies import (
    get_email_provider,
    get_queue,
    get_rate_limiter,
    get_storage,
    settings_dependency,
)
from .events import append_event, serialize_event
from .models import BatchRecord, DocumentRecord, ProcessingEventRecord
from .modules.auth.dependencies import CurrentSessionDep, ProtectedMutationDep
from .platform.database.migrations import migration_status
from .platform.rate_limit.limiter import RateLimiter
from .providers.queue import TaskQueue
from .providers.storage import StorageProvider
from .schemas import BatchOut, DocumentOut, ProcessingEventOut, ProviderStatus
from .security import read_bounded_pdf, sanitize_filename
from .vision import build_vision_providers

router = APIRouter()
SessionDep = Annotated[Session, Depends(get_session)]
SettingsDep = Annotated[Settings, Depends(settings_dependency)]
StorageDep = Annotated[StorageProvider, Depends(get_storage)]
QueueDep = Annotated[TaskQueue, Depends(get_queue)]
EmailDep = Annotated[EmailProvider, Depends(get_email_provider)]
LimiterDep = Annotated[RateLimiter, Depends(get_rate_limiter)]


@router.get("/health/live")
def live() -> dict[str, str]:
    """Liveness only: no dependency fan-out, so a slow database cannot restart us."""
    return {"status": "ok"}


@router.get("/health/ready")
def ready(
    session: SessionDep,
    settings: SettingsDep,
    email_provider: EmailDep,
    limiter: LimiterDep,
) -> ProviderStatus:
    """Readiness with bounded checks.

    Database reachability and schema freshness are required for authentication,
    so they are reported here. An unconfigured email provider and an
    unreachable rate-limit backend are reported as degraded rather than fatal:
    the dashboard, browser-local PDF workflow, and sign-in all still work.
    """
    session.execute(text("SELECT 1"))
    migrations = migration_status(session.get_bind())
    rate_limit_state = (
        "disabled"
        if not settings.rate_limit_enabled
        else ("valkey" if limiter.available else "degraded")
    )
    return ProviderStatus(
        database=settings.database_provider,
        storage=settings.effective_storage_provider,
        queue="celery-valkey",
        imagekit_enabled=settings.imagekit_enabled,
        ai_enabled=settings.cloud_ai_enabled,
        vision_providers=[provider.id for provider in build_vision_providers(settings)],
        migrations=migrations,
        auth="ready" if migrations == "up_to_date" else "degraded",
        email_provider=email_provider.id,
        email_available=email_provider.available,
        rate_limit=rate_limit_state,
    )


@router.post("/api/v1/batches", response_model=BatchOut, status_code=status.HTTP_201_CREATED)
def create_batch(
    session: SessionDep, settings: SettingsDep, authenticated: ProtectedMutationDep
) -> BatchOut:
    now = datetime.now(UTC)
    batch = BatchRecord(
        user_id=authenticated.user.id,
        expires_at=now + timedelta(seconds=settings.temp_file_ttl_seconds),
    )
    session.add(batch)
    session.flush()
    append_event(
        session,
        batch_id=batch.id,
        stage="ingest",
        status="queued",
        progress=0,
        message="Batch created; PDFs remain local unless fallback is requested.",
    )
    session.commit()
    return to_batch_out(batch)


@router.post(
    "/api/v1/batches/{batch_id}/documents",
    response_model=DocumentOut,
    status_code=status.HTTP_202_ACCEPTED,
)
async def upload_fallback_document(
    batch_id: str,
    session: SessionDep,
    settings: SettingsDep,
    storage: StorageDep,
    queue: QueueDep,
    authenticated: ProtectedMutationDep,
    file: Annotated[UploadFile, File(description="Untrusted PDF fallback input")],
) -> DocumentOut:
    batch = session.scalar(
        select(BatchRecord).where(
            BatchRecord.id == batch_id,
            BatchRecord.user_id == authenticated.user.id,
        )
    )
    if batch is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Batch not found")
    document_count = session.scalar(
        select(func.count(DocumentRecord.id)).where(DocumentRecord.batch_id == batch_id)
    )
    if document_count >= settings.max_batch_documents:
        raise HTTPException(status.HTTP_409_CONFLICT, "Batch document limit reached")

    data, digest = await read_bounded_pdf(file, settings.max_file_bytes)
    safe_name = sanitize_filename(file.filename)
    stored = storage.put(data, safe_name)
    document = DocumentRecord(
        batch_id=batch_id,
        safe_name=safe_name,
        storage_key=stored.key,
        sha256=digest,
        size_bytes=len(data),
        status="queued",
    )
    try:
        session.add(document)
        session.flush()
        append_event(
            session,
            batch_id=batch_id,
            document_id=document.id,
            stage="ingest",
            status="success",
            progress=1,
            message="Stored private temporary PDF for server fallback.",
            metadata={"sizeBytes": len(data), "storageProvider": stored.provider},
        )
        session.commit()
    except Exception:
        session.rollback()
        storage.delete(stored.key)
        raise
    try:
        queue.enqueue_document(document.id)
    except Exception as error:
        document.status = "queue_failed"
        append_event(
            session,
            batch_id=batch_id,
            document_id=document.id,
            stage="parse",
            status="failed",
            progress=0,
            message="Worker queue unavailable; stored PDF retained for retry until TTL.",
            metadata={"failureReason": "queue_unavailable"},
        )
        session.commit()
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE, "Worker queue unavailable"
        ) from error
    return DocumentOut.model_validate(document)


@router.get("/api/v1/batches/{batch_id}", response_model=BatchOut)
def get_batch(batch_id: str, session: SessionDep, authenticated: CurrentSessionDep) -> BatchOut:
    batch = session.scalar(
        select(BatchRecord)
        .options(selectinload(BatchRecord.documents))
        .where(
            BatchRecord.id == batch_id,
            BatchRecord.user_id == authenticated.user.id,
        )
    )
    if batch is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Batch not found")
    return to_batch_out(batch)


@router.get("/api/v1/batches/{batch_id}/events", response_model=list[ProcessingEventOut])
def get_events(
    batch_id: str,
    session: SessionDep,
    authenticated: CurrentSessionDep,
    after: int = -1,
) -> list[ProcessingEventOut]:
    if (
        session.scalar(
            select(BatchRecord.id).where(
                BatchRecord.id == batch_id,
                BatchRecord.user_id == authenticated.user.id,
            )
        )
        is None
    ):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Batch not found")
    records = session.scalars(
        select(ProcessingEventRecord)
        .where(
            ProcessingEventRecord.batch_id == batch_id,
            ProcessingEventRecord.sequence > after,
        )
        .order_by(ProcessingEventRecord.sequence)
    ).all()
    return [serialize_event(record) for record in records]


@router.get("/api/v1/batches/{batch_id}/events/stream")
def stream_events(
    batch_id: str,
    session: SessionDep,
    authenticated: CurrentSessionDep,
    after: int = -1,
) -> StreamingResponse:
    if (
        session.scalar(
            select(BatchRecord.id).where(
                BatchRecord.id == batch_id,
                BatchRecord.user_id == authenticated.user.id,
            )
        )
        is None
    ):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Batch not found")

    async def event_source():
        cursor = after
        idle_ticks = 0
        while idle_ticks < 120:
            with SessionLocal() as polling_session:
                records = polling_session.scalars(
                    select(ProcessingEventRecord)
                    .where(
                        ProcessingEventRecord.batch_id == batch_id,
                        ProcessingEventRecord.sequence > cursor,
                    )
                    .order_by(ProcessingEventRecord.sequence)
                ).all()
                if records:
                    idle_ticks = 0
                    for record in records:
                        cursor = record.sequence
                        payload = serialize_event(record).model_dump(mode="json")
                        yield f"id: {cursor}\nevent: processing\ndata: {json.dumps(payload)}\n\n"
                else:
                    idle_ticks += 1
                    yield ": keep-alive\n\n"
            await asyncio.sleep(1)

    return StreamingResponse(
        event_source(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache, no-store",
            "X-Accel-Buffering": "no",
        },
    )


def to_batch_out(batch: BatchRecord) -> BatchOut:
    return BatchOut(
        id=batch.id,
        status=batch.status,
        created_at=batch.created_at,
        updated_at=batch.updated_at,
        expires_at=batch.expires_at,
        documents=[DocumentOut.model_validate(document) for document in batch.documents],
    )
