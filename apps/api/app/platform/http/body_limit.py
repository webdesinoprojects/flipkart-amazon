"""Bound JSON request bodies before anything parses them.

Multipart uploads are excluded: the PDF fallback path already streams and bounds
them in :func:`app.security.read_bounded_pdf` with its own, much larger limit.
This guard exists so a small JSON endpoint such as login cannot be handed a
multi-megabyte body that is buffered and validated before being rejected.
"""

from __future__ import annotations

from starlette.requests import Request
from starlette.responses import JSONResponse
from starlette.types import ASGIApp, Receive, Scope, Send

BODY_METHODS = frozenset({"POST", "PUT", "PATCH", "DELETE"})
JSON_CONTENT_TYPE = "application/json"


class JsonBodyLimitMiddleware:
    """Reject oversized or wrongly typed JSON bodies with the shared envelope."""

    def __init__(self, app: ASGIApp, *, max_bytes: int) -> None:
        self.app = app
        self.max_bytes = max_bytes

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http" or scope.get("method", "") not in BODY_METHODS:
            await self.app(scope, receive, send)
            return

        request = Request(scope)
        content_type = (request.headers.get("content-type") or "").split(";")[0].strip()
        if content_type and content_type != JSON_CONTENT_TYPE:
            await self.app(scope, receive, send)
            return

        declared = request.headers.get("content-length")
        if declared and declared.isdigit() and int(declared) > self.max_bytes:
            await self._reject(scope, receive, send)
            return

        received = 0
        chunks: list[bytes] = []
        more = True
        while more:
            message = await receive()
            if message["type"] != "http.request":
                break
            chunk = message.get("body", b"")
            received += len(chunk)
            if received > self.max_bytes:
                await self._reject(scope, receive, send)
                return
            chunks.append(chunk)
            more = message.get("more_body", False)

        body = b"".join(chunks)
        replayed = False

        async def replay() -> dict:
            nonlocal replayed
            if replayed:
                return {"type": "http.disconnect"}
            replayed = True
            return {"type": "http.request", "body": body, "more_body": False}

        await self.app(scope, replay, send)

    async def _reject(self, scope: Scope, receive: Receive, send: Send) -> None:
        request_id = (scope.get("state") or {}).get("request_id", "")
        response = JSONResponse(
            status_code=413,
            content={
                "error": {
                    "code": "PAYLOAD_TOO_LARGE",
                    "message": "That request body is too large.",
                    "requestId": request_id,
                }
            },
            headers={"Cache-Control": "no-store"},
        )
        await response(scope, receive, send)
