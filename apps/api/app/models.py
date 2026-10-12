from datetime import datetime
from uuid import uuid4

from sqlalchemy import (
    JSON,
    BigInteger,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .database import Base
from .platform.clock import utc_now

__all__ = [
    "BatchRecord",
    "DocumentRecord",
    "LayoutTemplateRecord",
    "ProcessingEventRecord",
    "SavedOutputRecord",
    "utc_now",
]


class BatchRecord(Base):
    __tablename__ = "batches"
    __table_args__ = (
        UniqueConstraint("user_id", "client_batch_id", name="uq_batches_user_client_batch"),
        Index("ix_batches_user_completed_at", "user_id", "completed_at"),
        CheckConstraint("source_document_count >= 0", name="ck_batches_source_documents"),
        CheckConstraint("source_page_count >= 0", name="ck_batches_source_pages"),
        CheckConstraint("labels_discovered >= 0", name="ck_batches_labels_discovered"),
        CheckConstraint("labels_ready >= 0", name="ck_batches_labels_ready"),
        CheckConstraint("review_required >= 0", name="ck_batches_review_required"),
        CheckConstraint("labels_failed >= 0", name="ck_batches_labels_failed"),
        CheckConstraint("duplicate_warnings >= 0", name="ck_batches_duplicate_warnings"),
        CheckConstraint("output_page_count >= 0", name="ck_batches_output_pages"),
        CheckConstraint(
            "output_layout IN ('label_100x150', 'a4_4up')", name="ck_batches_output_layout"
        ),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    user_id: Mapped[str | None] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=True, index=True
    )
    client_batch_id: Mapped[str | None] = mapped_column(String(80), nullable=True)
    request_digest: Mapped[str | None] = mapped_column(String(64), nullable=True)
    status: Mapped[str] = mapped_column(String(32), default="created", index=True)
    source_document_count: Mapped[int] = mapped_column(Integer, default=0)
    source_page_count: Mapped[int] = mapped_column(Integer, default=0)
    labels_discovered: Mapped[int] = mapped_column(Integer, default=0)
    labels_ready: Mapped[int] = mapped_column(Integer, default=0)
    review_required: Mapped[int] = mapped_column(Integer, default=0)
    labels_failed: Mapped[int] = mapped_column(Integer, default=0)
    duplicate_warnings: Mapped[int] = mapped_column(Integer, default=0)
    output_page_count: Mapped[int] = mapped_column(Integer, default=0)
    """Physical pages in the saved PDF. Equals labels_ready only for 100x150."""
    output_layout: Mapped[str] = mapped_column(String(16), default="label_100x150")
    marketplace_counts: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utc_now, onupdate=utc_now
    )
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    documents: Mapped[list["DocumentRecord"]] = relationship(
        back_populates="batch", cascade="all, delete-orphan"
    )
    events: Mapped[list["ProcessingEventRecord"]] = relationship(
        back_populates="batch", cascade="all, delete-orphan"
    )
    saved_output: Mapped["SavedOutputRecord | None"] = relationship(
        back_populates="batch", cascade="all, delete-orphan", uselist=False
    )


class SavedOutputRecord(Base):
    __tablename__ = "saved_outputs"
    __table_args__ = (
        CheckConstraint("size_bytes > 0", name="ck_saved_outputs_size"),
        CheckConstraint("page_count > 0", name="ck_saved_outputs_pages"),
        Index("ix_saved_outputs_user_created_at", "user_id", "created_at"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    batch_id: Mapped[str] = mapped_column(
        ForeignKey("batches.id", ondelete="CASCADE"), unique=True, index=True
    )
    user_id: Mapped[str] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    storage_key: Mapped[str] = mapped_column(String(500), unique=True)
    storage_provider: Mapped[str] = mapped_column(String(24))
    sha256: Mapped[str] = mapped_column(String(64), index=True)
    size_bytes: Mapped[int] = mapped_column(BigInteger)
    page_count: Mapped[int] = mapped_column(Integer)
    filename: Mapped[str] = mapped_column(String(100), default="PRINT_READY_LABELS.pdf")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    batch: Mapped[BatchRecord] = relationship(back_populates="saved_output")


class DocumentRecord(Base):
    __tablename__ = "documents"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    batch_id: Mapped[str] = mapped_column(ForeignKey("batches.id", ondelete="CASCADE"), index=True)
    safe_name: Mapped[str] = mapped_column(String(180))
    storage_key: Mapped[str] = mapped_column(String(500), unique=True)
    sha256: Mapped[str] = mapped_column(String(64), index=True)
    size_bytes: Mapped[int] = mapped_column(BigInteger)
    page_count: Mapped[int | None] = mapped_column(Integer, nullable=True)
    status: Mapped[str] = mapped_column(String(32), default="queued", index=True)
    error_code: Mapped[str | None] = mapped_column(String(80), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    batch: Mapped[BatchRecord] = relationship(back_populates="documents")


class ProcessingEventRecord(Base):
    __tablename__ = "processing_events"
    __table_args__ = (UniqueConstraint("batch_id", "sequence"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    batch_id: Mapped[str] = mapped_column(ForeignKey("batches.id", ondelete="CASCADE"), index=True)
    document_id: Mapped[str | None] = mapped_column(String(36), nullable=True, index=True)
    page_id: Mapped[str | None] = mapped_column(String(80), nullable=True)
    sequence: Mapped[int] = mapped_column(Integer)
    stage: Mapped[str] = mapped_column(String(20), index=True)
    status: Mapped[str] = mapped_column(String(20))
    progress: Mapped[float | None] = mapped_column(nullable=True)
    message: Mapped[str] = mapped_column(String(240))
    event_metadata: Mapped[dict | None] = mapped_column("metadata", JSON, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    batch: Mapped[BatchRecord] = relationship(back_populates="events")


class LayoutTemplateRecord(Base):
    __tablename__ = "layout_templates"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    marketplace: Mapped[str] = mapped_column(String(32), index=True)
    adapter_version: Mapped[str] = mapped_column(String(32))
    fingerprint: Mapped[str] = mapped_column(String(160), unique=True)
    status: Mapped[str] = mapped_column(String(20), default="active")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
