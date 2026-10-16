from datetime import UTC, datetime, timedelta
from uuid import uuid4

from sqlalchemy import select

from app.models import BatchRecord
from app.modules.audit.models import SecurityEventRecord
from app.modules.auth.models import UserRecord
from app.modules.billing.models import (
    BillingChargeRecord,
    BillingSubscriptionRecord,
    BillingWebhookEventRecord,
)
from app.modules.credits.models import CreditGrantRecord
from app.modules.credits.service import (
    assert_daily_allowance,
    available_credits,
    bonus_balance,
    spend_bonus_for_batch,
)


def _seed_paid_customer(auth_env) -> str:
    auth_env.create_account("seller@example.com")
    with auth_env.session_factory() as session:
        customer = session.scalar(
            select(UserRecord).where(UserRecord.email_canonical == "seller@example.com")
        )
        assert customer is not None
        customer.email_verified_at = datetime.now(UTC)
        subscription = BillingSubscriptionRecord(
            user_id=customer.id,
            plan_code="starter",
            provider_id="sub_admin_test",
            provider_plan_id="plan_admin_test",
            status="active",
            checkout_url="https://rzp.io/rzp/test",
            paid_through=datetime.now(UTC) + timedelta(days=20),
            cancel_at_cycle_end=False,
        )
        session.add(subscription)
        session.flush()
        session.add(
            BillingChargeRecord(
                subscription_id=subscription.id,
                provider_payment_id="pay_admin_test",
                amount_paise=9900,
                paid_at=datetime.now(UTC),
                period_end=datetime.now(UTC) + timedelta(days=20),
            )
        )
        session.add(
            BatchRecord(
                user_id=customer.id,
                status="saved",
                labels_ready=10,
                completed_at=datetime.now(UTC),
                expires_at=datetime.now(UTC) + timedelta(days=30),
            )
        )
        session.add(
            BillingWebhookEventRecord(
                event_id="evt_admin_retry",
                event_type="subscription.charged",
                status="retry",
                attempts=2,
                last_error="PAYMENT_NOT_READY",
                received_at=datetime.now(UTC) - timedelta(minutes=6),
            )
        )
        session.commit()
        return customer.id


def _sign_in_admin(auth_env) -> None:
    auth_env.create_account("operator@example.com")
    auth_env.promote_to_admin("operator@example.com")


def test_admin_dashboard_is_private_and_uncached(auth_env):
    _seed_paid_customer(auth_env)
    paths = (
        "/api/v1/admin/overview",
        "/api/v1/admin/users",
        "/api/v1/admin/payments",
        "/api/v1/admin/operations",
        "/api/v1/admin/audit",
    )
    for path in paths:
        assert auth_env.client.get(path).status_code == 403
    auth_env.clear_cookies()
    for path in paths:
        assert auth_env.client.get(path).status_code == 401

    _sign_in_admin(auth_env)
    for path in paths:
        response = auth_env.client.get(path)
        assert response.status_code == 200, response.text
        assert response.headers["cache-control"] == "no-store"


def test_admin_overview_customer_payments_and_operations_use_real_rows(auth_env):
    customer_id = _seed_paid_customer(auth_env)
    _sign_in_admin(auth_env)

    overview = auth_env.client.get("/api/v1/admin/overview").json()
    assert overview["customers"] == {"total": 1, "paid": 1, "free": 0}
    assert overview["money"]["grossCapturedPaise"] == 9900
    assert overview["money"]["netAfterFullRefundsPaise"] == 9900
    assert overview["labels14d"] == 10
    assert overview["billingItemsNeedingReview"] == 1
    assert overview["recentPayments"][0]["paymentId"] == "pay_admin_test"

    customers = auth_env.client.get("/api/v1/admin/users?q=seller").json()
    assert customers["total"] == 1
    assert customers["items"][0]["plan"] == "Starter"
    assert customers["items"][0]["dailyCredits"] == 300
    assert customers["items"][0]["usedToday"] == 10
    assert "password_hash" not in str(customers)
    assert auth_env.client.get("/api/v1/admin/users?q=absent").json()["total"] == 0

    detail = auth_env.client.get(f"/api/v1/admin/users/{customer_id}").json()
    assert detail["savedBatches"] == 1
    assert detail["totalLabels"] == 10
    assert detail["subscriptions"][0]["providerId"] == "sub_admin_test"
    assert detail["payments"][0]["amountPaise"] == 9900
    assert auth_env.client.get("/api/v1/admin/users/not-a-customer").status_code == 404

    payments = auth_env.client.get("/api/v1/admin/payments").json()
    assert payments["total"] == 1
    assert payments["items"][0]["userId"] == customer_id
    operations = auth_env.client.get("/api/v1/admin/operations").json()
    assert operations["webhookCounts"]["retry"] == 1
    assert operations["oldestUnresolvedSeconds"] >= 300
    assert operations["events"][0]["lastError"] == "PAYMENT_NOT_READY"


def test_admin_audit_read_model_is_bounded_and_sanitized(auth_env):
    _sign_in_admin(auth_env)
    with auth_env.session_factory() as session:
        session.add(
            SecurityEventRecord(
                event="account.suspended",
                outcome="success",
                actor_user_id=None,
                subject_user_id=None,
                event_metadata={"reason": "support request"},
            )
        )
        session.commit()
    response = auth_env.client.get("/api/v1/admin/audit?limit=1")
    assert response.status_code == 200
    assert response.json()["total"] >= 1
    assert len(response.json()["items"]) == 1
    assert "metadata" not in response.json()["items"][0]
    assert auth_env.client.get("/api/v1/admin/audit?limit=51").status_code == 422


def test_admin_one_time_credit_grant_is_private_csrf_protected_and_idempotent(auth_env):
    customer_id = _seed_paid_customer(auth_env)
    seller_token = auth_env.create_account("another@example.com")
    body = {
        "requestId": str(uuid4()),
        "amount": 80,
        "reason": "Support credit adjustment",
        "expiresAt": (datetime.now(UTC) + timedelta(days=7)).isoformat(),
    }
    path = f"/api/v1/admin/users/{customer_id}/credit-grants"
    denied = auth_env.client.post(path, json=body, headers=auth_env.csrf_headers(seller_token))
    assert denied.status_code == 403

    admin_token = auth_env.create_account("operator@example.com")
    auth_env.promote_to_admin("operator@example.com")
    assert auth_env.client.post(path, json=body).status_code == 403
    response = auth_env.client.post(path, json=body, headers=auth_env.csrf_headers(admin_token))
    assert response.status_code == 201, response.text
    assert response.json()["remaining"] == 80
    repeat = auth_env.client.post(path, json=body, headers=auth_env.csrf_headers(admin_token))
    assert repeat.status_code == 200
    assert repeat.json()["id"] == response.json()["id"]
    changed = auth_env.client.post(
        path, json={**body, "amount": 81}, headers=auth_env.csrf_headers(admin_token)
    )
    assert changed.status_code == 409
    with auth_env.session_factory() as session:
        grants = session.scalars(select(CreditGrantRecord)).all()
        assert len(grants) == 1
        assert bonus_balance(session, user_id=customer_id) == 80
    detail = auth_env.client.get(f"/api/v1/admin/users/{customer_id}").json()
    assert detail["bonusCredits"] == 80
    assert detail["creditGrants"][0]["reason"] == body["reason"]
    assert any(event.event == "credits.granted" for event in auth_env.security_events())


def test_bonus_pool_spends_after_daily_credits_without_renewing(auth_env):
    customer_id = _seed_paid_customer(auth_env)
    auth_env.create_account("operator@example.com")
    auth_env.promote_to_admin("operator@example.com")
    now = datetime.now(UTC)
    with auth_env.session_factory() as session:
        session.add(
            CreditGrantRecord(
                user_id=customer_id,
                granted_by_user_id=session.scalar(
                    select(UserRecord.id).where(UserRecord.role == "admin")
                ),
                request_id=str(uuid4()),
                amount=100,
                remaining=100,
                reason="Support adjustment",
                expires_at=now + timedelta(days=7),
            )
        )
        session.add(
            BatchRecord(
                user_id=customer_id,
                status="saved",
                labels_ready=290,
                completed_at=now,
                expires_at=now + timedelta(days=30),
            )
        )
        session.flush()
        batch = BatchRecord(
            user_id=customer_id,
            status="saved",
            labels_ready=40,
            completed_at=now,
            expires_at=now + timedelta(days=30),
        )
        assert (
            assert_daily_allowance(
                session, user_id=customer_id, requested_labels=40, daily_limit=300, now=now
            )
            == 40
        )
        session.add(batch)
        session.flush()
        spend_bonus_for_batch(session, user_id=customer_id, batch_id=batch.id, amount=40, now=now)
        session.commit()
        assert available_credits(session, user_id=customer_id, daily_limit=300, now=now) == 60
        assert bonus_balance(session, user_id=customer_id, now=now + timedelta(days=8)) == 0
