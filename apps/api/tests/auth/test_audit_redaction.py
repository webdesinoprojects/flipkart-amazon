"""Audit metadata allowlisting, IP reduction, and log redaction."""

import json
import logging

import pytest

from app.modules.audit.service import (
    ALLOWED_METADATA_KEYS,
    AuditRedactionError,
    network_prefix,
    sanitize_metadata,
)
from app.platform.logging import REDACTED, StructuredFormatter, redact_mapping


def test_allowlisted_metadata_survives():
    assert sanitize_metadata({"reason": "bad_password", "bucket": "login_ip"}) == {
        "reason": "bad_password",
        "bucket": "login_ip",
    }


def test_unlisted_keys_are_dropped():
    assert sanitize_metadata({"customerAddress": "12 Example Road"}) is None
    assert sanitize_metadata({"reason": "ok", "filename": "labels.pdf"}) == {"reason": "ok"}


@pytest.mark.parametrize(
    "metadata",
    [
        {"password": "hunter2"},
        {"sessionToken": "abc"},
        {"csrf_token": "abc"},
        {"api_key": "abc"},
        {"passwordHash": "$argon2id$..."},
        {"cookie": "ln_session=abc"},
    ],
)
def test_secret_looking_keys_raise_instead_of_being_ignored(metadata):
    with pytest.raises(AuditRedactionError):
        sanitize_metadata(metadata)


@pytest.mark.parametrize(
    "value",
    [
        "$argon2id$v=19$m=65536,t=3,p=2$c29tZXNhbHQ$abcdef",
        "kJ8s9Df2LmQ4xZ1aB7cV0nE5gH3jK6pR9tY2uI4oP8w",
    ],
)
def test_a_secret_shaped_value_raises_even_under_an_allowed_key(value):
    with pytest.raises(AuditRedactionError):
        sanitize_metadata({"reason": value})


def test_an_ordinary_reason_that_merely_mentions_a_password_is_kept():
    """Shape, not vocabulary: "bad_password" is a legitimate audit reason."""
    assert sanitize_metadata({"reason": "bad_password"}) == {"reason": "bad_password"}


def test_values_are_bounded():
    cleaned = sanitize_metadata({"reason": "x y " * 200})
    assert cleaned is not None
    assert len(cleaned["reason"]) <= 120


def test_the_allowlist_contains_no_identifying_field():
    forbidden = {"email", "address", "phone", "filename", "barcode", "name"}
    assert ALLOWED_METADATA_KEYS.isdisjoint(forbidden)


def test_ipv4_is_reduced_to_a_network():
    assert network_prefix("203.0.113.42") == "203.0.113.0/24"


def test_ipv6_is_reduced_to_a_network():
    assert network_prefix("2001:db8:abcd:1234::1") == "2001:db8:abcd::/48"


@pytest.mark.parametrize("value", [None, "", "not-an-ip", "999.999.999.999"])
def test_unparseable_addresses_are_dropped_not_stored_raw(value):
    assert network_prefix(value) is None


def test_log_redaction_covers_credential_headers_and_fields():
    redacted = redact_mapping(
        {
            "cookie": "ln_session=abc",
            "authorization": "Bearer abc",
            "x-csrf-token": "abc",
            "password": "hunter2",
            "smtp_password": "abc",
            "route": "/api/v1/auth/login",
        }
    )
    assert redacted["cookie"] == REDACTED
    assert redacted["authorization"] == REDACTED
    assert redacted["x-csrf-token"] == REDACTED
    assert redacted["password"] == REDACTED
    assert redacted["smtp_password"] == REDACTED
    assert redacted["route"] == "/api/v1/auth/login"


def test_structured_log_records_are_json_with_redacted_extras():
    record = logging.LogRecord(
        name="app.http",
        level=logging.WARNING,
        pathname=__file__,
        lineno=1,
        msg="login_failed",
        args=(),
        exc_info=None,
    )
    record.request_id = "req-1"
    record.cookie = "ln_session=secret-value"
    payload = json.loads(StructuredFormatter().format(record))
    assert payload["message"] == "login_failed"
    assert payload["severity"] == "WARNING"
    assert payload["request_id"] == "req-1"
    assert payload["cookie"] == REDACTED
    assert "secret-value" not in json.dumps(payload)


def test_stack_traces_stay_in_the_log_payload_only():
    try:
        raise RuntimeError("database connection string postgresql://u:p@h/db")
    except RuntimeError:
        import sys

        record = logging.LogRecord(
            name="app.http",
            level=logging.ERROR,
            pathname=__file__,
            lineno=1,
            msg="unhandled_error",
            args=(),
            exc_info=sys.exc_info(),
        )
    payload = json.loads(StructuredFormatter().format(record))
    assert "stack" in payload
    assert payload["message"] == "unhandled_error"
