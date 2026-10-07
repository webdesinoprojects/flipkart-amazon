"""Structured, redacted server logging.

Logs are the only place a stack trace is allowed to exist. This module decides
what may accompany it: a correlation id, a stable error code, a severity, a
route/action name, internal account ids, and a small bounded set of metadata.
Request headers and form fields that can carry credentials are replaced with a
fixed marker before anything is written.
"""

from __future__ import annotations

import json
import logging
from collections.abc import Mapping
from datetime import UTC, datetime
from typing import Any

REDACTED = "[redacted]"

SENSITIVE_KEYS: frozenset[str] = frozenset(
    {
        "authorization",
        "proxy-authorization",
        "cookie",
        "set-cookie",
        "x-csrf-token",
        "x-api-key",
        "password",
        "current_password",
        "new_password",
        "token",
        "session",
        "secret",
        "smtp_password",
        "api_key",
        "private_key",
    }
)

_RESERVED = frozenset(
    {
        "args",
        "asctime",
        "created",
        "exc_info",
        "exc_text",
        "filename",
        "funcName",
        "levelname",
        "levelno",
        "lineno",
        "message",
        "module",
        "msecs",
        "msg",
        "name",
        "pathname",
        "process",
        "processName",
        "relativeCreated",
        "stack_info",
        "taskName",
        "thread",
        "threadName",
    }
)


def redact_mapping(values: Mapping[str, Any] | None) -> dict[str, Any]:
    """Return ``values`` with credential-bearing entries replaced."""
    if not values:
        return {}
    redacted: dict[str, Any] = {}
    for key, value in values.items():
        lowered = str(key).lower()
        if lowered in SENSITIVE_KEYS or any(marker in lowered for marker in SENSITIVE_KEYS):
            redacted[key] = REDACTED
        else:
            redacted[key] = value
    return redacted


class StructuredFormatter(logging.Formatter):
    """Emit one JSON object per record with redacted extras."""

    def format(self, record: logging.LogRecord) -> str:
        payload: dict[str, Any] = {
            "timestamp": datetime.fromtimestamp(record.created, UTC).isoformat(),
            "severity": record.levelname,
            "logger": record.name,
            "message": record.getMessage(),
        }
        extras = {
            key: value
            for key, value in record.__dict__.items()
            if key not in _RESERVED and not key.startswith("_")
        }
        payload.update(redact_mapping(extras))
        if record.exc_info:
            # Stack traces stay server-side; they are never put in a response.
            payload["stack"] = self.formatException(record.exc_info)
        return json.dumps(payload, default=str)


def configure_logging(level: str = "INFO") -> None:
    """Install the structured formatter on the root handler once."""
    root = logging.getLogger()
    if any(isinstance(handler.formatter, StructuredFormatter) for handler in root.handlers):
        return
    handler = logging.StreamHandler()
    handler.setFormatter(StructuredFormatter())
    root.handlers = [handler]
    root.setLevel(level)
