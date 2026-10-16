"""Bounded input contracts for admin-only mutations."""

from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class CreditGrantIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    requestId: UUID
    amount: int = Field(ge=1, le=10_000)
    reason: str = Field(min_length=8, max_length=200)
    expiresAt: datetime
