from datetime import UTC, datetime

from sqlalchemy import select

from .celery_app import celery_app
from .config import get_settings
from .database import SessionLocal
from .events import append_event
from .models import BatchRecord, DocumentRecord
from .modules.auth.cleanup import purge_expired_auth_rows
from .modules.billing.gateway import get_gateway
from .modules.billing.processing import (
    cancel_superseded_renewals,
    process_due_events,
    prune_processed_events,
    reconcile_due_subscriptions,
)
from .pdf_inspection import inspect_pdf
from .providers.storage import build_storage


@celery_app.task(name="documents.process", bind=True, autoretry_for=(), max_retries=0)
def process_document(self, document_id: str) -> dict[str, str | int]:
    settings = get_settings()
    storage = build_storage(settings)
    with SessionLocal() as session:
        document = session.get(DocumentRecord, document_id)
        if document is None:
            return {"status": "missing", "document_id": document_id}
        try:
            document.status = "parsing"
            append_event(
                session,
                batch_id=document.batch_id,
                document_id=document.id,
                stage="parse",
                status="running",
                progress=0.1,
                message="Parsing PDF in isolated worker storage.",
            )
            session.commit()

            data = storage.get(document.storage_key)
            page_count = inspect_pdf(data, settings.max_pdf_pages)

            document.page_count = page_count
            document.status = "parsed"
            append_event(
                session,
                batch_id=document.batch_id,
                document_id=document.id,
                stage="parse",
                status="success",
                progress=1,
                message="Parsed PDF.",
                metadata={"pageCount": page_count},
            )
            append_event(
                session,
                batch_id=document.batch_id,
                document_id=document.id,
                stage="classify",
                status="queued",
                progress=0,
                message="Queued for deterministic server fallback classification.",
            )
            batch = session.get(BatchRecord, document.batch_id)
            if batch:
                batch.status = "processing"
            session.commit()
            return {"status": "parsed", "document_id": document_id, "pages": page_count}
        except Exception as error:
            session.rollback()
            document = session.get(DocumentRecord, document_id)
            if document is None:
                raise
            code = (
                str(error)
                if str(error)
                in {
                    "encrypted_pdf",
                    "empty_pdf",
                    "page_limit_exceeded",
                }
                else "pdf_parse_failed"
            )
            document.status = "failed"
            document.error_code = code
            append_event(
                session,
                batch_id=document.batch_id,
                document_id=document.id,
                stage="parse",
                status="failed",
                progress=1,
                message="PDF parsing failed; other documents continue.",
                metadata={"failureReason": code},
            )
            session.commit()
            return {"status": "failed", "document_id": document_id}


@celery_app.task(name="auth.cleanup_expired")
def cleanup_expired_auth() -> dict[str, int]:
    """Reclaim expired sessions and one-time tokens.

    Idempotent: expired rows are already excluded from every lookup, so running
    twice, skipping a run, or failing cannot affect sign-in. The counts are
    returned and logged so a silently failing cleanup is still observable.
    """
    with SessionLocal() as session:
        report = purge_expired_auth_rows(session)
    return {
        "sessions_removed": report.sessions_removed,
        "tokens_removed": report.tokens_removed,
    }


@celery_app.task(name="storage.cleanup_expired")
def cleanup_expired() -> dict[str, int]:
    settings = get_settings()
    storage = build_storage(settings)
    deleted = 0
    now = datetime.now(UTC)
    with SessionLocal() as session:
        batches = session.scalars(select(BatchRecord).where(BatchRecord.expires_at < now)).all()
        for batch in batches:
            for document in batch.documents:
                try:
                    storage.delete(document.storage_key)
                finally:
                    deleted += 1
            if batch.saved_output is not None:
                try:
                    storage.delete(batch.saved_output.storage_key)
                finally:
                    deleted += 1
            session.delete(batch)
        session.commit()
    return {"deleted": deleted}


@celery_app.task(name="billing.process_events", soft_time_limit=240, time_limit=300)
def billing_process_events() -> dict[str, int]:
    settings = get_settings()
    if not settings.razorpay_api_configured:
        return {"done": 0, "retry": 0, "ignored": 0, "skipped": 0}
    return process_due_events(SessionLocal, get_gateway(settings), limit=20)


@celery_app.task(name="billing.cancel_superseded", soft_time_limit=240, time_limit=300)
def billing_cancel_superseded() -> dict[str, int]:
    settings = get_settings()
    if not settings.razorpay_api_configured:
        return {"cancelled": 0, "failed": 0}
    return cancel_superseded_renewals(SessionLocal, get_gateway(settings))


@celery_app.task(name="billing.reconcile", soft_time_limit=540, time_limit=600)
def billing_reconcile() -> dict[str, int]:
    settings = get_settings()
    if not settings.razorpay_api_configured:
        return {"checked": 0, "recovered": 0, "refunded": 0, "flagged": 0}
    return reconcile_due_subscriptions(SessionLocal, get_gateway(settings), limit=10)


@celery_app.task(name="billing.cleanup_events")
def billing_cleanup_events() -> dict[str, int]:
    return {"removed": prune_processed_events(SessionLocal)}
