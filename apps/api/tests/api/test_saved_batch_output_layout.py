"""Saved history must describe the chosen output layout truthfully.

`outputPageCount` counts physical pages and `labelsReady` counts shipment
labels. Those are equal only for one-label-per-page output; A4 four-up imposes
four labels per sheet. These tests pin that contract and the single-record
replacement policy used when the selection changes.
"""

from __future__ import annotations

import json
from io import BytesIO

from pypdf import PdfWriter
from sqlalchemy import func, select

from app.models import BatchRecord
from app.modules.history.schemas import expected_output_pages

A4_WIDTH_PT = 595.2755905511812
A4_HEIGHT_PT = 841.8897637795277


def pdf_with_pages(pages: int, *, a4: bool = False) -> bytes:
    output = BytesIO()
    writer = PdfWriter()
    for _ in range(pages):
        if a4:
            writer.add_blank_page(width=A4_WIDTH_PT, height=A4_HEIGHT_PT)
        else:
            writer.add_blank_page(width=283.464, height=425.197)
    writer.write(output)
    return output.getvalue()


def metadata(
    *,
    client_batch_id: str = "batch-layout-0001",
    labels_ready: int,
    layout: str,
    output_pages: int | None = None,
) -> dict:
    return {
        "clientBatchId": client_batch_id,
        "sourceDocumentCount": 2,
        "sourcePageCount": max(labels_ready, 1),
        "labelsDiscovered": labels_ready,
        "labelsReady": labels_ready,
        "reviewRequired": 0,
        "labelsFailed": 0,
        "duplicateWarnings": 0,
        "outputPageCount": (
            output_pages
            if output_pages is not None
            else expected_output_pages(labels_ready, layout)
        ),
        "outputLayout": layout,
        "marketplaceCounts": {"meesho": labels_ready},
    }


def save(auth_env, csrf: str, body: dict, pdf: bytes):
    return auth_env.client.post(
        "/api/v1/history/batches",
        headers=auth_env.csrf_headers(csrf),
        data={"metadata": json.dumps(body)},
        files={"output": ("output.pdf", pdf, "application/pdf")},
    )


def test_standard_layout_accepts_one_page_per_ready_label(auth_env):
    csrf = auth_env.create_account("standard@example.com")
    body = metadata(labels_ready=5, layout="label_100x150")
    assert body["outputPageCount"] == 5

    response = save(auth_env, csrf, body, pdf_with_pages(5))

    assert response.status_code == 201, response.text
    saved = response.json()
    assert saved["labelsReady"] == 5
    assert saved["outputPageCount"] == 5
    assert saved["outputLayout"] == "label_100x150"


def test_the_layout_field_is_optional_for_an_older_client(auth_env):
    csrf = auth_env.create_account("legacy@example.com")
    body = metadata(labels_ready=3, layout="label_100x150")
    del body["outputLayout"]

    response = save(auth_env, csrf, body, pdf_with_pages(3))

    assert response.status_code == 201, response.text
    assert response.json()["outputLayout"] == "label_100x150"


def test_four_up_accepts_ceil_labels_over_four_sheets(auth_env):
    csrf = auth_env.create_account("fourup@example.com")

    for index, (labels, sheets) in enumerate([(1, 1), (4, 1), (5, 2), (8, 2)]):
        body = metadata(
            client_batch_id=f"batch-fourup-{index:04d}",
            labels_ready=labels,
            layout="a4_4up",
        )
        assert body["outputPageCount"] == sheets

        response = save(auth_env, csrf, body, pdf_with_pages(sheets, a4=True))

        assert response.status_code == 201, response.text
        saved = response.json()
        assert saved["labelsReady"] == labels
        assert saved["outputPageCount"] == sheets
        assert saved["outputLayout"] == "a4_4up"


def test_four_up_rejects_a_page_count_that_equals_the_label_count(auth_env):
    """The old `outputPageCount == labelsReady` rule must not pass for A4."""
    csrf = auth_env.create_account("fourup-invalid@example.com")
    body = metadata(labels_ready=8, layout="a4_4up", output_pages=8)

    response = save(auth_env, csrf, body, pdf_with_pages(8, a4=True))

    assert response.status_code == 422
    assert response.json()["error"]["code"] == "INVALID_BATCH_METADATA"


def test_standard_layout_rejects_a_four_up_page_count(auth_env):
    csrf = auth_env.create_account("standard-invalid@example.com")
    body = metadata(labels_ready=8, layout="label_100x150", output_pages=2)

    response = save(auth_env, csrf, body, pdf_with_pages(2))

    assert response.status_code == 422
    assert response.json()["error"]["code"] == "INVALID_BATCH_METADATA"


def test_an_unknown_layout_is_rejected(auth_env):
    csrf = auth_env.create_account("unknown-layout@example.com")
    body = metadata(labels_ready=4, layout="a4_4up")
    body["outputLayout"] = "a4_9up"

    response = save(auth_env, csrf, body, pdf_with_pages(1, a4=True))

    assert response.status_code == 422
    assert response.json()["error"]["code"] == "INVALID_BATCH_METADATA"


def test_metadata_must_match_the_actual_pdf_page_count(auth_env):
    csrf = auth_env.create_account("mismatch@example.com")
    body = metadata(labels_ready=8, layout="a4_4up")
    assert body["outputPageCount"] == 2

    # Claims two sheets, uploads three.
    response = save(auth_env, csrf, body, pdf_with_pages(3, a4=True))

    assert response.status_code == 422
    assert response.json()["error"]["code"] == "OUTPUT_PAGE_COUNT_MISMATCH"


def test_switching_layout_replaces_the_same_record(auth_env):
    csrf = auth_env.create_account("switch@example.com")
    standard = metadata(client_batch_id="batch-switch-0001", labels_ready=8, layout="label_100x150")
    first = save(auth_env, csrf, standard, pdf_with_pages(8))
    assert first.status_code == 201, first.text
    assert first.json()["outputPageCount"] == 8

    four_up = metadata(client_batch_id="batch-switch-0001", labels_ready=8, layout="a4_4up")
    second = save(auth_env, csrf, four_up, pdf_with_pages(2, a4=True))

    assert second.status_code == 200, second.text
    assert second.json()["id"] == first.json()["id"], "same logical saved batch"
    assert second.json()["outputLayout"] == "a4_4up"
    assert second.json()["labelsReady"] == 8
    assert second.json()["outputPageCount"] == 2

    history = auth_env.client.get("/api/v1/history/batches").json()
    assert history["total"] == 1
    assert history["items"][0]["outputLayout"] == "a4_4up"
    assert history["items"][0]["outputPageCount"] == 2

    with auth_env.session_factory() as session:
        assert session.scalar(select(func.count(BatchRecord.id))) == 1
        record = session.scalar(select(BatchRecord))
        assert record is not None
        assert record.output_layout == "a4_4up"
        assert record.output_page_count == 2
        assert record.labels_ready == 8


def test_replacement_deletes_the_superseded_object_and_serves_the_new_one(auth_env):
    csrf = auth_env.create_account("supersede@example.com")
    standard = metadata(
        client_batch_id="batch-supersede-01", labels_ready=8, layout="label_100x150"
    )
    first = save(auth_env, csrf, standard, pdf_with_pages(8)).json()
    before = {path.name for path in (auth_env.storage_root / "objects").glob("*.pdf")}
    assert len(before) == 1

    four_up = metadata(client_batch_id="batch-supersede-01", labels_ready=8, layout="a4_4up")
    save(auth_env, csrf, four_up, pdf_with_pages(2, a4=True))

    after = {path.name for path in (auth_env.storage_root / "objects").glob("*.pdf")}
    assert len(after) == 1, "exactly one stored object survives"
    assert after != before, "the superseded object was removed"

    download = auth_env.client.get(first["downloadUrl"])
    assert download.status_code == 200
    assert download.headers["cache-control"] == "private, no-store"
    # The filename follows the stored layout, so an A4 PDF is not mislabelled.
    assert "PRINT_READY_LABELS_A4.pdf" in download.headers["content-disposition"]


def test_replacement_stays_owner_scoped_and_requires_csrf(auth_env):
    owner_csrf = auth_env.create_account("owner@example.com")
    body = metadata(client_batch_id="batch-owned-00001", labels_ready=4, layout="label_100x150")
    owned = save(auth_env, owner_csrf, body, pdf_with_pages(4))
    assert owned.status_code == 201

    without_csrf = auth_env.client.post(
        "/api/v1/history/batches",
        data={"metadata": json.dumps(body)},
        files={"output": ("output.pdf", pdf_with_pages(4), "application/pdf")},
    )
    assert without_csrf.status_code == 403

    # A second account reusing the same client batch id gets its own record and
    # cannot see or replace the first owner's saved output.
    auth_env.clear_cookies()
    intruder_csrf = auth_env.create_account("intruder@example.com")
    four_up = metadata(client_batch_id="batch-owned-00001", labels_ready=4, layout="a4_4up")
    intruder = save(auth_env, intruder_csrf, four_up, pdf_with_pages(1, a4=True))
    assert intruder.status_code == 201
    assert intruder.json()["id"] != owned.json()["id"]
    assert auth_env.client.get(owned.json()["downloadUrl"]).status_code == 404


def test_replacement_still_validates_the_uploaded_pdf(auth_env):
    csrf = auth_env.create_account("replace-validate@example.com")
    body = metadata(client_batch_id="batch-validate-001", labels_ready=4, layout="label_100x150")
    assert save(auth_env, csrf, body, pdf_with_pages(4)).status_code == 201

    four_up = metadata(client_batch_id="batch-validate-001", labels_ready=4, layout="a4_4up")
    not_a_pdf = auth_env.client.post(
        "/api/v1/history/batches",
        headers=auth_env.csrf_headers(csrf),
        data={"metadata": json.dumps(four_up)},
        files={"output": ("output.pdf", b"not a pdf at all", "application/pdf")},
    )
    assert not_a_pdf.status_code == 415

    # The original record is untouched by the rejected replacement.
    history = auth_env.client.get("/api/v1/history/batches").json()
    assert history["total"] == 1
    assert history["items"][0]["outputLayout"] == "label_100x150"
    assert history["items"][0]["outputPageCount"] == 4


def test_usage_totals_count_labels_not_sheets(auth_env):
    """A4 output must not make a seller's label usage look four times smaller."""
    csrf = auth_env.create_account("usage@example.com")
    body = metadata(client_batch_id="batch-usage-00001", labels_ready=8, layout="a4_4up")
    assert save(auth_env, csrf, body, pdf_with_pages(2, a4=True)).status_code == 201

    summary = auth_env.client.get("/api/v1/dashboard/summary").json()
    assert summary["usageToday"] == 8
    assert summary["totalLabels"] == 8
    assert summary["totalBatches"] == 1


def test_most_labels_sort_uses_label_count_not_physical_page_count(auth_env):
    csrf = auth_env.create_account("label-sort@example.com")
    standard = metadata(
        client_batch_id="batch-sort-standard", labels_ready=5, layout="label_100x150"
    )
    four_up = metadata(client_batch_id="batch-sort-a4-0001", labels_ready=8, layout="a4_4up")
    assert save(auth_env, csrf, standard, pdf_with_pages(5)).status_code == 201
    assert save(auth_env, csrf, four_up, pdf_with_pages(2, a4=True)).status_code == 201

    history = auth_env.client.get("/api/v1/history/batches", params={"sort": "labels_desc"}).json()

    assert [item["labelsReady"] for item in history["items"]] == [8, 5]
    assert history["items"][0]["outputPageCount"] == 2
