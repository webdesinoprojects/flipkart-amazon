"""One safe error envelope for the whole HTTP surface.

Every failure that leaves the API has the same shape:

```json
{"error": {"code": "FORBIDDEN", "message": "...", "requestId": "...",
           "fields": {"email": ["Enter a valid email address."]}}}
```

``code`` is stable and machine-readable; ``message`` is safe to show a person;
``requestId`` lets support correlate with server logs. Stack traces, SQL,
provider errors, filesystem paths, and environment values never appear here —
they are logged server-side only.
"""

from __future__ import annotations

import logging
from typing import Any

from fastapi import FastAPI
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException
from starlette.requests import Request

from .request_context import request_id_of

logger = logging.getLogger("app.http")

GENERIC_INTERNAL_MESSAGE = "Something went wrong on our side. Try again in a moment."

_STATUS_CODES: dict[int, str] = {
    400: "BAD_REQUEST",
    401: "UNAUTHENTICATED",
    403: "FORBIDDEN",
    404: "NOT_FOUND",
    405: "METHOD_NOT_ALLOWED",
    409: "CONFLICT",
    410: "GONE",
    413: "PAYLOAD_TOO_LARGE",
    415: "UNSUPPORTED_MEDIA_TYPE",
    422: "VALIDATION_ERROR",
    429: "RATE_LIMITED",
    500: "INTERNAL_ERROR",
    503: "DEPENDENCY_UNAVAILABLE",
}


class ApiError(Exception):
    """An error whose code, message, and status are part of the API contract."""

    def __init__(
        self,
        *,
        status_code: int,
        code: str,
        message: str,
        fields: dict[str, list[str]] | None = None,
        headers: dict[str, str] | None = None,
    ) -> None:
        super().__init__(message)
        self.status_code = status_code
        self.code = code
        self.message = message
        self.fields = fields
        self.headers = headers


def error_payload(
    *,
    code: str,
    message: str,
    request_id: str,
    fields: dict[str, list[str]] | None = None,
) -> dict[str, Any]:
    error: dict[str, Any] = {"code": code, "message": message, "requestId": request_id}
    if fields:
        error["fields"] = fields
    return {"error": error}


def error_response(
    *,
    status_code: int,
    code: str,
    message: str,
    request_id: str,
    fields: dict[str, list[str]] | None = None,
    headers: dict[str, str] | None = None,
) -> JSONResponse:
    response = JSONResponse(
        status_code=status_code,
        content=error_payload(code=code, message=message, request_id=request_id, fields=fields),
        headers=headers,
    )
    response.headers["Cache-Control"] = "no-store"
    return response


def _field_errors(exc: RequestValidationError) -> dict[str, list[str]]:
    fields: dict[str, list[str]] = {}
    for item in exc.errors():
        location = [str(part) for part in item.get("loc", ()) if part not in ("body", "query")]
        name = ".".join(location) or "body"
        fields.setdefault(name, []).append(str(item.get("msg", "Invalid value.")))
    return fields


def register_error_handlers(app: FastAPI) -> None:
    @app.exception_handler(ApiError)
    async def handle_api_error(request: Request, exc: ApiError) -> JSONResponse:
        return error_response(
            status_code=exc.status_code,
            code=exc.code,
            message=exc.message,
            request_id=request_id_of(request),
            fields=exc.fields,
            headers=exc.headers,
        )

    @app.exception_handler(RequestValidationError)
    async def handle_validation_error(
        request: Request, exc: RequestValidationError
    ) -> JSONResponse:
        return error_response(
            status_code=422,
            code="VALIDATION_ERROR",
            message="Check the highlighted fields and try again.",
            request_id=request_id_of(request),
            fields=_field_errors(exc),
        )

    @app.exception_handler(StarletteHTTPException)
    async def handle_http_exception(request: Request, exc: StarletteHTTPException) -> JSONResponse:
        detail = exc.detail if isinstance(exc.detail, str) else ""
        message = detail or _STATUS_CODES.get(exc.status_code, "Request failed.")
        if exc.status_code >= 500:
            message = GENERIC_INTERNAL_MESSAGE
        return error_response(
            status_code=exc.status_code,
            code=_STATUS_CODES.get(exc.status_code, "REQUEST_FAILED"),
            message=message,
            request_id=request_id_of(request),
            headers=dict(exc.headers or {}),
        )

    @app.exception_handler(Exception)
    async def handle_unexpected_error(request: Request, exc: Exception) -> JSONResponse:
        request_id = request_id_of(request)
        # The stack trace stays in server logs. The browser gets a code only.
        logger.exception(
            "unhandled_error",
            extra={"request_id": request_id, "route": request.scope.get("route")},
        )
        return error_response(
            status_code=500,
            code="INTERNAL_ERROR",
            message=GENERIC_INTERNAL_MESSAGE,
            request_id=request_id,
        )
