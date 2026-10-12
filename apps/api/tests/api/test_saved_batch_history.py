from __future__ import annotations

import json
from datetime import UTC, datetime, timedelta
from io import BytesIO

from pypdf import PdfWriter
from sqlalchemy import select

from app.models import BatchRecord, SavedOutputRecord


def generated_pdf(pages: int = 2) -> bytes:
    output = BytesIO()
    writer = PdfWriter()
    for _ in range(pages):
        writer.add_blank_page(width=283.464, height=425.197)
    writer.write(output)
    return output.getvalue()


def metadata(client_batch_id: str = "batch-12345678", pages: int = 2) -> dict:
    return {
        "clientBatchId": client_batch_id,
        "sourceDocumentCount": 2,
        "sourcePageCount": 4,
        "labelsDiscovered": pages,
        "labelsReady": pages,
        "reviewRequired": 0,
        "labelsFailed": 0,
        "duplicateWarnings": 0,
        "outputPageCount": pages,
        "marketplaceCounts": {"amazon": 1, "meesho": pages - 1},
    }


def save(auth_env, csrf: str, *, body: dict | None = None, pdf: bytes | None = None):
    return auth_env.client.post(
        "/api/v1/history/batches",
        headers=auth_env.csrf_headers(csrf),
        data={"metadata": json.dumps(body or metadata())},
        files={"output": ("PRINT_READY_LABELS.pdf", pdf or generated_pdf(), "application/pdf")},
    )


def test_saved_output_history_and_summary_are_real_and_owner_scoped(auth_env):
    csrf = auth_env.create_account("history@example.com")
    response = save(auth_env, csrf)
    assert response.status_code == 201, response.text
    saved = response.json()
    assert saved["sourcePageCount"] == 4
    assert saved["labelsReady"] == 2
    assert saved["downloadUrl"].endswith(f"/{saved['id']}/output")
    assert saved["previewUrl"].endswith(f"/{saved['id']}/preview")

    history = auth_env.client.get("/api/v1/history/batches").json()
    assert history["total"] == 1
    assert history["items"][0]["clientBatchId"] == "batch-12345678"

    summary = auth_env.client.get("/api/v1/dashboard/summary").json()
    assert summary["usageToday"] == 2
    assert summary["batchesToday"] == 1
    assert summary["totalLabels"] == 2
    assert summary["totalBatches"] == 1
    assert summary["availableCredits"] is None
    assert summary["activePlan"] is None
    assert len(summary["dailyUsage"]) == 14

    output = auth_env.client.get(saved["downloadUrl"])
    assert output.status_code == 200
    assert output.headers["content-type"] == "application/pdf"
    assert output.headers["content-disposition"].startswith("attachment;")
    assert output.content.startswith(b"%PDF-")

    preview = auth_env.client.get(saved["previewUrl"])
    assert preview.status_code == 200
    assert preview.headers["content-type"] == "application/pdf"
    assert preview.headers["content-disposition"].startswith("inline;")
    assert preview.headers["cache-control"] == "private, no-store"

    auth_env.clear_cookies()
    auth_env.create_account("other-owner@example.com")
    assert auth_env.client.get(saved["downloadUrl"]).status_code == 404
    assert auth_env.client.get(saved["previewUrl"]).status_code == 404


def test_repeated_identical_save_is_idempotent(auth_env):
    csrf = auth_env.create_account("idempotent@example.com")
    first = save(auth_env, csrf)
    second = save(auth_env, csrf)
    assert first.status_code == 201
    assert second.status_code == 200
    assert second.json()["id"] == first.json()["id"]
    assert len(list((auth_env.storage_root / "objects").glob("*.pdf"))) == 1


def test_changed_payload_replaces_the_single_record_instead_of_conflicting(auth_env):
    """Changing the selected output must not duplicate a row or raise a 409."""
    csrf = auth_env.create_account("replace@example.com")
    first = save(auth_env, csrf)
    assert first.status_code == 201

    changed = metadata()
    changed["sourcePageCount"] = 5
    replaced = save(auth_env, csrf, body=changed)

    assert replaced.status_code == 200
    assert replaced.json()["id"] == first.json()["id"]
    assert replaced.json()["sourcePageCount"] == 5

    history = auth_env.client.get("/api/v1/history/batches").json()
    assert history["total"] == 1, "one logical saved batch, not two rows"
    # The superseded object is removed only after the replacement committed.
    assert len(list((auth_env.storage_root / "objects").glob("*.pdf"))) == 1


def test_generated_pdf_is_bounded_validated_and_requires_csrf(auth_env):
    csrf = auth_env.create_account("validation@example.com")
    mismatch = save(auth_env, csrf, body=metadata(pages=2), pdf=generated_pdf(1))
    assert mismatch.status_code == 422
    assert mismatch.json()["error"]["code"] == "OUTPUT_PAGE_COUNT_MISMATCH"

    without_csrf = auth_env.client.post(
        "/api/v1/history/batches",
        data={"metadata": json.dumps(metadata())},
        files={"output": ("output.pdf", generated_pdf(), "application/pdf")},
    )
    assert without_csrf.status_code == 403


def test_history_list_is_bounded_and_requires_authentication(client):
    test_client, _, _ = client
    assert test_client.get("/api/v1/history/batches").status_code == 401
    assert test_client.get("/api/v1/dashboard/summary").status_code == 401


def test_history_filters_search_sort_and_pagination_are_server_side(auth_env):
    csrf = auth_env.create_account("history-filters@example.com")
    older_body = metadata("batch-filter-amazon-0001", pages=1)
    recent_body = metadata("batch-filter-meesho-0002", pages=2)
    assert save(auth_env, csrf, body=older_body, pdf=generated_pdf(1)).status_code == 201
    assert save(auth_env, csrf, body=recent_body, pdf=generated_pdf(2)).status_code == 201

    with auth_env.session_factory() as session:
        older = session.scalar(
            select(BatchRecord).where(BatchRecord.client_batch_id == "batch-filter-amazon-0001")
        )
        assert older is not None
        older.completed_at = datetime.now(UTC) - timedelta(days=100)
        output = session.scalar(
            select(SavedOutputRecord).where(SavedOutputRecord.batch_id == older.id)
        )
        assert output is not None
        output.size_bytes = 2 * 1024 * 1024
        session.commit()

    searched_response = auth_env.client.get(
        "/api/v1/history/batches", params={"q": "meesho-0002", "limit": 10}
    )
    assert searched_response.status_code == 200, searched_response.text
    searched = searched_response.json()
    assert searched["total"] == 1
    assert searched["items"][0]["clientBatchId"] == "batch-filter-meesho-0002"

    recent = auth_env.client.get(
        "/api/v1/history/batches", params={"period": "30d", "limit": 10}
    ).json()
    assert recent["total"] == 1
    assert recent["items"][0]["clientBatchId"] == "batch-filter-meesho-0002"

    meesho = auth_env.client.get(
        "/api/v1/history/batches", params={"marketplace": "meesho", "limit": 10}
    ).json()
    assert meesho["total"] == 1
    assert meesho["items"][0]["clientBatchId"] == "batch-filter-meesho-0002"

    medium = auth_env.client.get(
        "/api/v1/history/batches", params={"size": "1_to_5mb", "limit": 10}
    ).json()
    assert medium["total"] == 1
    assert medium["items"][0]["clientBatchId"] == "batch-filter-amazon-0001"

    largest = auth_env.client.get(
        "/api/v1/history/batches", params={"sort": "largest", "limit": 10}
    ).json()
    assert largest["items"][0]["clientBatchId"] == "batch-filter-amazon-0001"
    assert largest["hasMore"] is False

    invalid = auth_env.client.get(
        "/api/v1/history/batches", params={"period": "forever", "limit": 10}
    )
    assert invalid.status_code == 422
