from __future__ import annotations

import hashlib
import json
import logging
from datetime import UTC, datetime, timedelta
from zoneinfo import ZoneInfo

from sqlalchemy import func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, joinedload

from ...config import Settings
from ...models import BatchRecord, SavedOutputRecord
from ...platform.clock import as_utc
from ...platform.http.errors import ApiError
from ...providers.storage import StorageProvider
from ..credits.service import (
    EARLY_ACCESS_PLAN,
    assert_daily_allowance,
    available_credits,
    lock_account_for_credit_check,
)
from .presenters import present_saved_batch
from .schemas import DailyUsageOut, DashboardSummaryOut, SavedBatchListOut, SavedBatchMetadata

logger = logging.getLogger("app.history")

INDIA_TIME = ZoneInfo("Asia/Kolkata")

OUTPUT_FILENAMES: dict[str, str] = {
    "label_100x150": "PRINT_READY_LABELS.pdf",
    "a4_4up": "PRINT_READY_LABELS_A4.pdf",
}
"""Fixed server-side mapping. A filename is never taken from client input."""


def _request_digest(metadata: SavedBatchMetadata, pdf_sha256: str) -> str:
    canonical = json.dumps(metadata.model_dump(), sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(f"{canonical}:{pdf_sha256}".encode()).hexdigest()


def _find_by_client_id(session: Session, user_id: str, client_batch_id: str):
    return session.scalar(
        select(BatchRecord)
        .options(joinedload(BatchRecord.saved_output))
        .where(
            BatchRecord.user_id == user_id,
            BatchRecord.client_batch_id == client_batch_id,
        )
    )


def save_generated_batch(
    *,
    session: Session,
    storage: StorageProvider,
    settings: Settings,
    user_id: str,
    metadata: SavedBatchMetadata,
    pdf_data: bytes,
    pdf_sha256: str,
) -> tuple[BatchRecord, bool]:
    """Retain one private saved record per client batch id.

    Policy:

    * identical content for the same ``clientBatchId`` is idempotent and
      returns the existing record unchanged;
    * different content — which is what changing the output layout produces —
      **replaces** that record in place, so a batch keeps exactly one history
      row reflecting the currently selected output instead of a duplicate row
      or a 409;
    * a concurrent first insert for the same id is resolved by the unique
      constraint and then treated as a replacement.
    """
    digest = _request_digest(metadata, pdf_sha256)
    lock_account_for_credit_check(session, user_id=user_id)
    existing = _find_by_client_id(session, user_id, metadata.clientBatchId)
    if existing is not None:
        if existing.request_digest == digest:
            return existing, False
        assert_daily_allowance(
            session,
            user_id=user_id,
            requested_labels=metadata.labelsReady,
            daily_limit=settings.early_access_daily_credits,
            replaced_batch=existing,
        )
        return (
            _replace_saved_output(
                session=session,
                storage=storage,
                settings=settings,
                user_id=user_id,
                batch=existing,
                metadata=metadata,
                pdf_data=pdf_data,
                pdf_sha256=pdf_sha256,
                digest=digest,
            ),
            False,
        )

    assert_daily_allowance(
        session,
        user_id=user_id,
        requested_labels=metadata.labelsReady,
        daily_limit=settings.early_access_daily_credits,
    )

    stored = storage.put(pdf_data, "PRINT_READY_LABELS.pdf", category="saved-output")
    now = datetime.now(UTC)
    expires_at = now + timedelta(days=settings.saved_output_retention_days)
    batch = BatchRecord(
        user_id=user_id,
        client_batch_id=metadata.clientBatchId,
        request_digest=digest,
        status="saved",
        source_document_count=metadata.sourceDocumentCount,
        source_page_count=metadata.sourcePageCount,
        labels_discovered=metadata.labelsDiscovered,
        labels_ready=metadata.labelsReady,
        review_required=metadata.reviewRequired,
        labels_failed=metadata.labelsFailed,
        duplicate_warnings=metadata.duplicateWarnings,
        output_page_count=metadata.outputPageCount,
        output_layout=metadata.outputLayout,
        marketplace_counts=metadata.marketplaceCounts,
        completed_at=now,
        expires_at=expires_at,
    )
    batch.saved_output = SavedOutputRecord(
        user_id=user_id,
        storage_key=stored.key,
        storage_provider=stored.provider,
        sha256=pdf_sha256,
        size_bytes=len(pdf_data),
        page_count=metadata.outputPageCount,
        filename=OUTPUT_FILENAMES[metadata.outputLayout],
        expires_at=expires_at,
    )
    try:
        session.add(batch)
        session.commit()
    except IntegrityError:
        session.rollback()
        storage.delete(stored.key)
        concurrent = _find_by_client_id(session, user_id, metadata.clientBatchId)
        if concurrent is not None and concurrent.request_digest == digest:
            return concurrent, False
        raise ApiError(
            status_code=409,
            code="IDEMPOTENCY_CONFLICT",
            message="This batch id was already used by another request.",
        ) from None
    except Exception:
        session.rollback()
        storage.delete(stored.key)
        raise
    return batch, True


def _replace_saved_output(
    *,
    session: Session,
    storage: StorageProvider,
    settings: Settings,
    user_id: str,
    batch: BatchRecord,
    metadata: SavedBatchMetadata,
    pdf_data: bytes,
    pdf_sha256: str,
    digest: str,
) -> BatchRecord:
    """Swap the stored PDF and metadata of an existing owned record.

    Ordering matters for safety:

    1. write the new object, so a storage failure leaves the old record intact;
    2. commit the row update in one transaction;
    3. only then delete the superseded object.

    A failure before the commit removes the new object and leaves the previous
    saved output downloadable. A failure of the final delete leaves an orphan
    for the scheduled cleanup rather than breaking the request.
    """
    if batch.user_id != user_id or batch.saved_output is None:
        raise ApiError(status_code=404, code="NOT_FOUND", message="Saved batch not found.")

    previous_key = batch.saved_output.storage_key
    stored = storage.put(pdf_data, "PRINT_READY_LABELS.pdf", category="saved-output")
    now = datetime.now(UTC)
    expires_at = now + timedelta(days=settings.saved_output_retention_days)
    try:
        batch.request_digest = digest
        batch.source_document_count = metadata.sourceDocumentCount
        batch.source_page_count = metadata.sourcePageCount
        batch.labels_discovered = metadata.labelsDiscovered
        batch.labels_ready = metadata.labelsReady
        batch.review_required = metadata.reviewRequired
        batch.labels_failed = metadata.labelsFailed
        batch.duplicate_warnings = metadata.duplicateWarnings
        batch.output_page_count = metadata.outputPageCount
        batch.output_layout = metadata.outputLayout
        batch.marketplace_counts = metadata.marketplaceCounts
        batch.completed_at = now
        batch.expires_at = expires_at

        output = batch.saved_output
        output.storage_key = stored.key
        output.storage_provider = stored.provider
        output.sha256 = pdf_sha256
        output.size_bytes = len(pdf_data)
        output.page_count = metadata.outputPageCount
        output.filename = OUTPUT_FILENAMES[metadata.outputLayout]
        output.expires_at = expires_at
        session.commit()
    except Exception:
        session.rollback()
        storage.delete(stored.key)
        raise

    if previous_key != stored.key:
        try:
            storage.delete(previous_key)
        except Exception as error:  # noqa: BLE001 - replacement already committed
            # The new output is live and the row is correct, so failing the
            # request here would be wrong. The orphan is left for the scheduled
            # storage cleanup, and the failure is observable in the logs. No
            # storage key or customer data is recorded.
            logger.warning(
                "saved_output_supersede_delete_failed",
                extra={"error_type": type(error).__name__},
            )
    return batch


def list_saved_batches(
    session: Session,
    *,
    user_id: str,
    limit: int,
    offset: int,
    query: str | None = None,
    period: str = "all",
    marketplace: str = "all",
    size: str = "all",
    sort: str = "newest",
) -> SavedBatchListOut:
    filters: list = [
        BatchRecord.user_id == user_id,
        BatchRecord.status == "saved",
    ]
    normalized_query = (query or "").strip()
    if normalized_query:
        escaped = normalized_query.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
        pattern = f"%{escaped}%"
        filters.append(
            or_(
                BatchRecord.client_batch_id.ilike(pattern, escape="\\"),
                BatchRecord.id.ilike(pattern, escape="\\"),
            )
        )

    period_start = _period_start(period)
    if period_start is not None:
        filters.append(BatchRecord.completed_at >= period_start)

    if marketplace != "all":
        filters.append(BatchRecord.marketplace_counts[marketplace].as_integer() > 0)

    one_megabyte = 1024 * 1024
    five_megabytes = 5 * one_megabyte
    if size == "under_1mb":
        filters.append(SavedOutputRecord.size_bytes < one_megabyte)
    elif size == "1_to_5mb":
        filters.extend(
            [
                SavedOutputRecord.size_bytes >= one_megabyte,
                SavedOutputRecord.size_bytes < five_megabytes,
            ]
        )
    elif size == "over_5mb":
        filters.append(SavedOutputRecord.size_bytes >= five_megabytes)

    ordering = {
        "newest": (BatchRecord.completed_at.desc(), BatchRecord.id.desc()),
        "oldest": (BatchRecord.completed_at.asc(), BatchRecord.id.asc()),
        "largest": (SavedOutputRecord.size_bytes.desc(), BatchRecord.id.desc()),
        "smallest": (SavedOutputRecord.size_bytes.asc(), BatchRecord.id.desc()),
        "labels_desc": (BatchRecord.labels_ready.desc(), BatchRecord.id.desc()),
    }.get(sort, (BatchRecord.completed_at.desc(), BatchRecord.id.desc()))

    base = select(BatchRecord).join(SavedOutputRecord, BatchRecord.saved_output)
    total = (
        session.scalar(
            select(func.count(BatchRecord.id))
            .join(SavedOutputRecord, BatchRecord.saved_output)
            .where(*filters)
        )
        or 0
    )
    records = session.scalars(
        base.options(joinedload(BatchRecord.saved_output))
        .where(*filters)
        .order_by(*ordering)
        .limit(limit)
        .offset(offset)
    ).all()
    return SavedBatchListOut(
        items=[present_saved_batch(record) for record in records],
        limit=limit,
        offset=offset,
        total=total,
        hasMore=offset + len(records) < total,
    )


def _period_start(period: str) -> datetime | None:
    if period == "all":
        return None
    today = datetime.now(UTC).astimezone(INDIA_TIME).date()
    days = {"today": 0, "7d": 6, "30d": 29, "90d": 89}.get(period)
    if days is None:
        return None
    local_start = datetime.combine(
        today - timedelta(days=days), datetime.min.time(), tzinfo=INDIA_TIME
    )
    return local_start.astimezone(UTC)


def dashboard_summary(
    session: Session, *, user_id: str, daily_credit_limit: int
) -> DashboardSummaryOut:
    now = datetime.now(UTC)
    today = now.astimezone(INDIA_TIME).date()
    first_day = today - timedelta(days=13)
    first_instant = datetime.combine(first_day, datetime.min.time(), tzinfo=INDIA_TIME).astimezone(
        UTC
    )
    filters = (BatchRecord.user_id == user_id, BatchRecord.status == "saved")
    total_query = select(
        func.count(BatchRecord.id),
        func.coalesce(func.sum(BatchRecord.labels_ready), 0),
    ).where(*filters)
    total_batches, total_labels = session.execute(total_query).one()
    chart_records = session.execute(
        select(BatchRecord.completed_at, BatchRecord.labels_ready)
        .where(*filters, BatchRecord.completed_at >= first_instant)
        .order_by(BatchRecord.completed_at)
    ).all()
    chart_days = (first_day + timedelta(days=index) for index in range(14))
    by_day = {day: {"labels": 0, "batches": 0} for day in chart_days}
    for completed_at, labels_ready in chart_records:
        if completed_at is None:
            continue
        local_day = as_utc(completed_at).astimezone(INDIA_TIME).date()
        if local_day in by_day:
            by_day[local_day]["labels"] += labels_ready
            by_day[local_day]["batches"] += 1
    recent = list_saved_batches(session, user_id=user_id, limit=5, offset=0).items
    return DashboardSummaryOut(
        usageToday=by_day[today]["labels"],
        batchesToday=by_day[today]["batches"],
        totalLabels=total_labels,
        totalBatches=total_batches,
        availableCredits=available_credits(
            session,
            user_id=user_id,
            daily_limit=daily_credit_limit,
            now=now,
        ),
        activePlan=EARLY_ACCESS_PLAN,
        dailyUsage=[
            DailyUsageOut(date=day, labels=values["labels"], batches=values["batches"])
            for day, values in by_day.items()
        ],
        recentBatches=recent,
    )


def owned_saved_batch(session: Session, *, user_id: str, batch_id: str) -> BatchRecord:
    batch = session.scalar(
        select(BatchRecord)
        .options(joinedload(BatchRecord.saved_output))
        .where(
            BatchRecord.id == batch_id,
            BatchRecord.user_id == user_id,
            BatchRecord.status == "saved",
        )
    )
    if batch is None or batch.saved_output is None:
        raise ApiError(status_code=404, code="NOT_FOUND", message="Saved batch not found.")
    return batch
