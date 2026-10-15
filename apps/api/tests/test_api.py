from datetime import UTC, datetime, timedelta
from io import BytesIO

from pypdf import PdfWriter

from app.modules.billing.models import BillingWebhookEventRecord


def minimal_pdf() -> bytes:
    output = BytesIO()
    writer = PdfWriter()
    writer.add_blank_page(width=100, height=150)
    writer.write(output)
    return output.getvalue()


def test_optional_providers_are_disabled_without_keys(client):
    test_client, _, _ = client
    response = test_client.get("/health/ready")
    assert response.status_code == 200
    assert response.json() == {
        "database": "local_postgres",
        "storage": "local",
        "queue": "celery-valkey",
        "imagekit_enabled": False,
        "ai_enabled": False,
        "vision_providers": [],
        # Readiness now also reports the authentication dependencies. A missing
        # email provider and an absent rate-limit backend are degraded states,
        # never boot failures.
        "migrations": "not_initialized",
        "auth": "degraded",
        "email_provider": "disabled",
        "email_available": False,
        "rate_limit": "disabled",
        "billing_inbox": "unavailable",
        "billing_oldest_unresolved_seconds": None,
    }


def test_stale_billing_inbox_makes_readiness_fail(auth_env, monkeypatch):
    monkeypatch.setattr("app.routes.migration_status", lambda _bind: "up_to_date")
    with auth_env.session_factory() as session:
        session.add(
            BillingWebhookEventRecord(
                event_id="stale-event",
                event_type="subscription.charged",
                status="pending",
                attempts=0,
                received_at=datetime.now(UTC) - timedelta(minutes=6),
            )
        )
        session.commit()
    response = auth_env.client.get("/health/ready")
    assert response.status_code == 503
    assert response.json()["billing_inbox"] == "stale"
    assert response.json()["billing_oldest_unresolved_seconds"] >= 300


def authenticated_fallback(auth_env):
    csrf = auth_env.create_account("fallback@example.com")
    return (
        auth_env.client,
        auth_env.queue,
        auth_env.storage_root,
        auth_env.csrf_headers(csrf),
    )


def test_upload_is_sanitized_private_bounded_and_queued(auth_env):
    test_client, queue, storage_root, headers = authenticated_fallback(auth_env)
    batch = test_client.post("/api/v1/batches", headers=headers).json()
    response = test_client.post(
        f"/api/v1/batches/{batch['id']}/documents",
        headers=headers,
        files={"file": ("../../Customer Address (1).pdf", minimal_pdf(), "application/pdf")},
    )
    assert response.status_code == 202
    document = response.json()
    assert document["safe_name"] == "Customer_Address_1_.pdf"
    assert queue.document_ids == [document["id"]]
    stored = list((storage_root / "objects").glob("*.pdf"))
    assert len(stored) == 1
    assert "Customer" not in stored[0].name

    events = test_client.get(f"/api/v1/batches/{batch['id']}/events").json()
    assert [event["stage"] for event in events] == ["ingest", "ingest"]
    assert all(event["batchId"] == batch["id"] for event in events)
    assert "Address" not in str(events)


def test_invalid_document_does_not_remove_existing_batch(auth_env):
    test_client, _, _, headers = authenticated_fallback(auth_env)
    batch = test_client.post("/api/v1/batches", headers=headers).json()
    response = test_client.post(
        f"/api/v1/batches/{batch['id']}/documents",
        headers=headers,
        files={"file": ("bad.pdf", b"not a pdf", "application/pdf")},
    )
    assert response.status_code == 415
    assert test_client.get(f"/api/v1/batches/{batch['id']}").status_code == 200


def test_file_limit_is_enforced(auth_env):
    test_client, _, _, headers = authenticated_fallback(auth_env)
    batch = test_client.post("/api/v1/batches", headers=headers).json()
    oversized = b"%PDF-" + b"x" * 5000
    response = test_client.post(
        f"/api/v1/batches/{batch['id']}/documents",
        headers=headers,
        files={"file": ("too-large.pdf", oversized, "application/pdf")},
    )
    assert response.status_code == 413


def test_server_fallback_requires_authentication(client):
    test_client, _, _ = client
    assert test_client.post("/api/v1/batches").status_code == 401


def test_batch_is_not_visible_to_another_user(auth_env):
    test_client, _, _, headers = authenticated_fallback(auth_env)
    batch_id = test_client.post("/api/v1/batches", headers=headers).json()["id"]
    test_client.cookies.clear()
    auth_env.create_account("someone-else@example.com")
    assert test_client.get(f"/api/v1/batches/{batch_id}").status_code == 404
