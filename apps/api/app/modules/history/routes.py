from __future__ import annotations

from typing import Annotated, Literal

from fastapi import APIRouter, Depends, File, Form, Query, Response, UploadFile, status
from pydantic import ValidationError
from sqlalchemy.orm import Session

from ...config import Settings
from ...database import get_session
from ...dependencies import get_storage, settings_dependency
from ...modules.auth.dependencies import CurrentSessionDep, ProtectedMutationDep
from ...pdf_inspection import inspect_pdf
from ...platform.http.errors import ApiError
from ...providers.storage import StorageProvider, StorageUnavailable
from ...security import read_bounded_pdf
from .presenters import present_saved_batch
from .schemas import DashboardSummaryOut, SavedBatchListOut, SavedBatchMetadata, SavedBatchOut
from .service import (
    OUTPUT_FILENAMES,
    dashboard_summary,
    list_saved_batches,
    owned_saved_batch,
    save_generated_batch,
)

router = APIRouter(prefix="/api/v1", tags=["history"])
SessionDep = Annotated[Session, Depends(get_session)]
SettingsDep = Annotated[Settings, Depends(settings_dependency)]
StorageDep = Annotated[StorageProvider, Depends(get_storage)]


@router.post(
    "/history/batches",
    response_model=SavedBatchOut,
    status_code=status.HTTP_201_CREATED,
)
async def save_batch(
    session: SessionDep,
    settings: SettingsDep,
    storage: StorageDep,
    authenticated: ProtectedMutationDep,
    metadata_json: Annotated[str, Form(alias="metadata", max_length=16 * 1024)],
    output: Annotated[UploadFile, File(description="Generated combined label PDF only")],
    response: Response,
) -> SavedBatchOut:
    try:
        metadata = SavedBatchMetadata.model_validate_json(metadata_json)
    except ValidationError as error:
        raise ApiError(
            status_code=422,
            code="INVALID_BATCH_METADATA",
            message="The generated batch metadata is invalid.",
        ) from error
    data, digest = await read_bounded_pdf(output, settings.max_saved_output_bytes)
    try:
        actual_pages = inspect_pdf(data, settings.max_pdf_pages)
    except ValueError as error:
        raise ApiError(
            status_code=422,
            code="INVALID_GENERATED_PDF",
            message="The generated output PDF could not be validated.",
        ) from error
    if actual_pages != metadata.outputPageCount:
        raise ApiError(
            status_code=422,
            code="OUTPUT_PAGE_COUNT_MISMATCH",
            message="The generated PDF page count does not match the batch summary.",
        )
    batch, created = save_generated_batch(
        session=session,
        storage=storage,
        settings=settings,
        user_id=authenticated.user.id,
        metadata=metadata,
        pdf_data=data,
        pdf_sha256=digest,
    )
    if not created:
        response.status_code = status.HTTP_200_OK
    return present_saved_batch(batch)


@router.get("/history/batches", response_model=SavedBatchListOut)
def history(
    session: SessionDep,
    authenticated: CurrentSessionDep,
    q: Annotated[str | None, Query(max_length=80)] = None,
    period: Literal["all", "today", "7d", "30d", "90d"] = "all",
    marketplace: Literal["all", "amazon", "flipkart", "meesho", "unknown"] = "all",
    size: Literal["all", "under_1mb", "1_to_5mb", "over_5mb"] = "all",
    sort: Literal["newest", "oldest", "largest", "smallest", "labels_desc"] = "newest",
    limit: Annotated[int, Query(ge=1, le=50)] = 20,
    offset: Annotated[int, Query(ge=0, le=10_000)] = 0,
) -> SavedBatchListOut:
    return list_saved_batches(
        session,
        user_id=authenticated.user.id,
        limit=limit,
        offset=offset,
        query=q,
        period=period,
        marketplace=marketplace,
        size=size,
        sort=sort,
    )


@router.get("/dashboard/summary", response_model=DashboardSummaryOut)
def summary(
    session: SessionDep,
    settings: SettingsDep,
    authenticated: CurrentSessionDep,
) -> DashboardSummaryOut:
    return dashboard_summary(
        session,
        user_id=authenticated.user.id,
        settings=settings,
    )


@router.get("/history/batches/{batch_id}/output")
def download_output(
    batch_id: str,
    session: SessionDep,
    storage: StorageDep,
    authenticated: CurrentSessionDep,
) -> Response:
    return _saved_output_response(
        batch_id=batch_id,
        session=session,
        storage=storage,
        user_id=authenticated.user.id,
        disposition="attachment",
    )


@router.get("/history/batches/{batch_id}/preview")
def preview_output(
    batch_id: str,
    session: SessionDep,
    storage: StorageDep,
    authenticated: CurrentSessionDep,
) -> Response:
    return _saved_output_response(
        batch_id=batch_id,
        session=session,
        storage=storage,
        user_id=authenticated.user.id,
        disposition="inline",
    )


def _saved_output_response(
    *,
    batch_id: str,
    session: Session,
    storage: StorageProvider,
    user_id: str,
    disposition: Literal["attachment", "inline"],
) -> Response:
    batch = owned_saved_batch(session, user_id=user_id, batch_id=batch_id)
    try:
        data = storage.get(batch.saved_output.storage_key)  # type: ignore[union-attr]
    except (FileNotFoundError, StorageUnavailable) as error:
        raise ApiError(
            status_code=410,
            code="OUTPUT_UNAVAILABLE",
            message="This generated PDF is no longer available.",
        ) from error
    # Derived from the stored layout through a fixed server-side mapping, so a
    # four-up PDF is never offered under the single-label filename and no client
    # value can reach the header.
    filename = OUTPUT_FILENAMES.get(batch.output_layout, "PRINT_READY_LABELS.pdf")
    return Response(
        content=data,
        media_type="application/pdf",
        headers={
            "Cache-Control": "private, no-store",
            "Content-Disposition": f'{disposition}; filename="{filename}"',
            "X-Content-Type-Options": "nosniff",
        },
    )
