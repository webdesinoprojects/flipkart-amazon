"""Strict request and response contracts for ``/api/v1/auth`` and ``/api/v1/admin``.

Every request model sets ``extra="forbid"``, so a client that tries to submit
``role``, ``status``, ``security_version``, or any other server-owned field gets
a 422 instead of having it silently ignored. Mass assignment is impossible
because services accept named arguments, never a request body.

Every response model is explicit and contains no ORM object: there is no field
through which a password hash, token digest, or internal timestamp could leak.
Field names are camelCase because these endpoints are consumed by the browser.
"""

from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

_STRICT = ConfigDict(extra="forbid")

DeliveryStatus = Literal["sent", "disabled", "failed"]


class RegisterRequest(BaseModel):
    model_config = _STRICT

    email: str = Field(min_length=3, max_length=254)
    password: str = Field(min_length=1, max_length=4096)


class LoginRequest(BaseModel):
    model_config = _STRICT

    email: str = Field(min_length=3, max_length=254)
    password: str = Field(min_length=1, max_length=4096)


class EmailOnlyRequest(BaseModel):
    model_config = _STRICT

    email: str = Field(min_length=3, max_length=254)


class TokenRequest(BaseModel):
    model_config = _STRICT

    token: str = Field(min_length=16, max_length=512)


class PasswordResetRequest(BaseModel):
    model_config = _STRICT

    token: str = Field(min_length=16, max_length=512)
    password: str = Field(min_length=1, max_length=4096)


class UserOut(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str
    email: str
    role: Literal["user", "admin"]
    emailVerified: bool
    createdAt: datetime
    lastLoginAt: datetime | None = None


class SessionOut(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str
    deviceSummary: str
    createdAt: datetime
    lastSeenAt: datetime
    expiresAt: datetime
    current: bool


class MeOut(BaseModel):
    user: UserOut


class LoginOut(BaseModel):
    user: UserOut
    csrfToken: str


class CsrfOut(BaseModel):
    csrfToken: str


class SessionListOut(BaseModel):
    sessions: list[SessionOut]


class AcceptedOut(BaseModel):
    """Uniform response for registration and every email-sending request."""

    status: Literal["accepted"] = "accepted"
    delivery: DeliveryStatus
    message: str


class VerificationConfirmedOut(BaseModel):
    status: Literal["verified"] = "verified"
    user: UserOut


class PasswordResetCompletedOut(BaseModel):
    status: Literal["password_updated"] = "password_updated"
    revokedSessions: bool = True


class LogoutOut(BaseModel):
    status: Literal["signed_out"] = "signed_out"


class AdminAccessOut(BaseModel):
    """Proof that backend authorization — not UI hiding — gates admin access."""

    role: Literal["admin"]
    userId: str
    checkedAt: datetime
    capabilities: list[str]
