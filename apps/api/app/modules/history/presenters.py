from __future__ import annotations

from ...models import BatchRecord
from ...platform.clock import as_utc
from .schemas import SavedBatchOut


def present_saved_batch(batch: BatchRecord) -> SavedBatchOut:
    output = batch.saved_output
    if output is None or batch.client_batch_id is None:
        raise ValueError("Saved batch is missing its generated output")
    return SavedBatchOut(
        id=batch.id,
        clientBatchId=batch.client_batch_id,
        status="saved",
        sourceDocumentCount=batch.source_document_count,
        sourcePageCount=batch.source_page_count,
        labelsDiscovered=batch.labels_discovered,
        labelsReady=batch.labels_ready,
        reviewRequired=batch.review_required,
        labelsFailed=batch.labels_failed,
        duplicateWarnings=batch.duplicate_warnings,
        outputPageCount=batch.output_page_count,
        outputLayout=batch.output_layout,  # type: ignore[arg-type]
        marketplaceCounts=dict(batch.marketplace_counts or {}),
        outputSizeBytes=output.size_bytes,
        createdAt=as_utc(batch.completed_at or batch.created_at),
        expiresAt=as_utc(output.expires_at),
        previewUrl=f"/api/v1/history/batches/{batch.id}/preview",
        downloadUrl=f"/api/v1/history/batches/{batch.id}/output",
    )
