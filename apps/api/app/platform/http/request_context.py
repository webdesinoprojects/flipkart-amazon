"""Request correlation identifiers and trusted-proxy client-IP resolution."""

from __future__ import annotations

import re
from uuid import uuid4

from starlette.requests import Request
from starlette.types import ASGIApp, Receive, Scope, Send

REQUEST_ID_HEADER = "x-request-id"
_SAFE_REQUEST_ID = re.compile(r"^[A-Za-z0-9._:-]{8,64}$")


def new_request_id() -> str:
    return str(uuid4())


def request_id_of(request: Request) -> str:
    """Return the correlation id attached by :class:`RequestContextMiddleware`."""
    return getattr(request.state, "request_id", "") or ""


class RequestContextMiddleware:
    """Attach a correlation id to every request and echo it on the response.

    An inbound ``X-Request-ID`` is reused only when it has a safe shape, so a
    caller cannot inject newlines or unbounded text into structured logs.
    """

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        supplied = ""
        for raw_name, raw_value in scope.get("headers", []):
            if raw_name.decode("latin-1").lower() == REQUEST_ID_HEADER:
                supplied = raw_value.decode("latin-1")
                break
        request_id = supplied if _SAFE_REQUEST_ID.match(supplied) else new_request_id()
        scope.setdefault("state", {})
        scope["state"]["request_id"] = request_id

        async def send_with_request_id(message):
            if message["type"] == "http.response.start":
                headers = list(message.get("headers", []))
                headers.append((REQUEST_ID_HEADER.encode("latin-1"), request_id.encode("latin-1")))
                message = {**message, "headers": headers}
            await send(message)

        await self.app(scope, receive, send_with_request_id)


def client_ip(request: Request, *, trusted_proxy_count: int) -> str | None:
    """Resolve the client address, honouring only configured proxy hops.

    With ``trusted_proxy_count == 0`` the socket peer is authoritative and
    ``X-Forwarded-For`` is ignored entirely, so a client cannot spoof the
    identity used for rate limiting or audit prefixes. With ``n > 0`` the
    ``n``-th entry from the right of ``X-Forwarded-For`` is used, which is the
    address the innermost trusted proxy observed.
    """
    if trusted_proxy_count > 0:
        forwarded = request.headers.get("x-forwarded-for", "")
        hops = [hop.strip() for hop in forwarded.split(",") if hop.strip()]
        if len(hops) >= trusted_proxy_count:
            return hops[-trusted_proxy_count]
    return request.client.host if request.client else None
