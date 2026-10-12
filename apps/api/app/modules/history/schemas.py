from __future__ import annotations

from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

Marketplace = Literal["amazon", "flipkart", "meesho", "unknown"]

OutputLayout = Literal["label_100x150", "a4_4up"]
"""Mirrors the `OutputLayout` union in `@label-normalizer/core`."""

LABELS_PER_PAGE: dict[str, int] = {"label_100x150": 1, "a4_4up": 4}


def expected_output_pages(labels_ready: int, layout: str) -> int:
    """Physical pages a truthful save must report for `labels_ready` labels."""
    per_page = LABELS_PER_PAGE[layout]
    return -(-labels_ready // per_page)


class SavedBatchMetadata(BaseModel):
    """Browser-produced aggregate data. It contains no document names or PII."""

    model_config = ConfigDict(extra="forbid")

    clientBatchId: str = Field(min_length=8, max_length=80, pattern=r"^[A-Za-z0-9._:-]+$")
    sourceDocumentCount: int = Field(ge=1, le=100)
    sourcePageCount: int = Field(ge=1, le=1000)
    labelsDiscovered: int = Field(ge=1, le=1000)
    labelsReady: int = Field(ge=1, le=1000)
    reviewRequired: int = Field(ge=0, le=1000)
    labelsFailed: int = Field(ge=0, le=1000)
    duplicateWarnings: int = Field(ge=0, le=1000)
    outputPageCount: int = Field(ge=1, le=1000)
    outputLayout: OutputLayout = "label_100x150"
    """Defaults to the historical layout so an older client stays valid."""
    marketplaceCounts: dict[Marketplace, int]

    @model_validator(mode="after")
    def validate_consistent_counts(self) -> SavedBatchMetadata:
        # `outputPageCount` counts physical pages, which only equals the label
        # count for one-label-per-page output. A4 four-up imposes four labels
        # per sheet, so the expected count depends on the layout.
        expected = expected_output_pages(self.labelsReady, self.outputLayout)
        if self.outputPageCount != expected:
            raise ValueError(
                f"outputPageCount must be {expected} for {self.outputLayout} "
                f"with {self.labelsReady} ready labels"
            )
        if sum(self.marketplaceCounts.values()) != self.labelsDiscovered:
            raise ValueError("marketplaceCounts must total labelsDiscovered")
        if any(value < 0 for value in self.marketplaceCounts.values()):
            raise ValueError("marketplaceCounts cannot contain negative values")
        return self


class SavedBatchOut(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str
    clientBatchId: str
    status: Literal["saved"]
    sourceDocumentCount: int
    sourcePageCount: int
    labelsDiscovered: int
    labelsReady: int
    reviewRequired: int
    labelsFailed: int
    duplicateWarnings: int
    outputPageCount: int
    outputLayout: OutputLayout
    marketplaceCounts: dict[str, int]
    outputSizeBytes: int
    createdAt: datetime
    expiresAt: datetime
    previewUrl: str
    downloadUrl: str


class SavedBatchListOut(BaseModel):
    items: list[SavedBatchOut]
    limit: int
    offset: int
    total: int
    hasMore: bool


class DailyUsageOut(BaseModel):
    date: date
    labels: int
    batches: int


class DashboardSummaryOut(BaseModel):
    usageToday: int
    batchesToday: int
    totalLabels: int
    totalBatches: int
    availableCredits: int | None
    activePlan: str | None
    dailyUsage: list[DailyUsageOut]
    recentBatches: list[SavedBatchOut]
