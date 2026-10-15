from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict

ProcessingStage = Literal[
    "ingest",
    "parse",
    "classify",
    "extract",
    "normalize",
    "validate",
    "review",
    "assemble",
    "complete",
]
EventStatus = Literal["queued", "running", "success", "warning", "failed"]


class ProcessingEventOut(BaseModel):
    id: str
    sequence: int
    batchId: str
    documentId: str | None = None
    pageId: str | None = None
    stage: ProcessingStage
    status: EventStatus
    progress: float | None = None
    message: str
    timestamp: datetime
    metadata: dict[str, Any] | None = None


class DocumentOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    safe_name: str
    size_bytes: int
    page_count: int | None
    status: str
    error_code: str | None


class BatchOut(BaseModel):
    id: str
    status: str
    created_at: datetime
    updated_at: datetime
    expires_at: datetime
    documents: list[DocumentOut]


class ProviderStatus(BaseModel):
    database: str
    storage: str
    queue: str
    imagekit_enabled: bool
    ai_enabled: bool
    vision_providers: list[str]
    migrations: Literal["up_to_date", "pending", "not_initialized", "unknown"]
    """Whether the schema matches the code this instance is running."""
    auth: Literal["ready", "degraded"]
    email_provider: str
    email_available: bool
    """False is normal locally; it never prevents boot, and the UI says so."""
    rate_limit: Literal["valkey", "degraded", "disabled"]
    billing_inbox: Literal["clear", "stale", "unavailable"]
    billing_oldest_unresolved_seconds: int | None
