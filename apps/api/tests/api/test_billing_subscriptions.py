import hashlib
import hmac
import json
from datetime import UTC, datetime, timedelta

from sqlalchemy import delete, select

from app.main import app
from app.models import BatchRecord
from app.modules.auth.models import UserRecord
from app.modules.billing.gateway import RazorpayGateway
from app.modules.billing.models import (
    BillingChargeRecord,
    BillingSubscriptionRecord,
    BillingWebhookEventRecord,
)
from app.modules.billing.processing import (
    cancel_superseded_renewals,
    process_due_events,
    reconcile_due_subscriptions,
    reconcile_one_subscription,
)
from app.modules.billing.routes import gateway_dependency
from app.platform.http.errors import ApiError


class FakeRazorpay(RazorpayGateway):
    def __init__(self):
        self.created = 0
        self.ends = int((datetime.now(UTC) + timedelta(days=30)).timestamp())
        self.status = "created"
        self.payment_amount = 9900
        self.payment_status = "captured"
        self.payment_invoice_id = "inv_test_123"
        self.partial_refund_amount = None
        self.invoice_status = "paid"
        self.invoice_line_type = "plan"
        self.immediate_cancellations = 0
        self.end_cancellations = 0

    def get_plan(self, plan_id):
        return {
            "id": plan_id,
            "period": "monthly",
            "interval": 1,
            "item": {"amount": 9900, "currency": "INR"},
        }

    def create_subscription(self, plan_id, user_id):
        self.created += 1
        return {
            "id": "sub_test_123",
            "plan_id": plan_id,
            "quantity": 1,
            "status": "created",
            "short_url": "https://rzp.io/rzp/test",
        }

    def get_subscription(self, subscription_id):
        return {
            "id": subscription_id,
            "plan_id": "plan_Starter",
            "quantity": 1,
            "status": self.status,
            "current_end": self.ends,
            "paid_count": 1 if self.status in {"active", "halted", "paused"} else 0,
        }

    def get_payment(self, payment_id):
        return {
            "id": payment_id,
            "status": self.payment_status,
            "captured": True,
            "amount": self.payment_amount,
            "currency": "INR",
            "amount_refunded": self.partial_refund_amount
            if self.partial_refund_amount is not None
            else (self.payment_amount if self.payment_status == "refunded" else 0),
            "invoice_id": self.payment_invoice_id,
        }

    def get_invoice(self, invoice_id):
        return {
            "id": invoice_id,
            "subscription_id": "sub_test_123",
            "payment_id": "pay_test_123",
            "status": self.invoice_status,
            "type": "invoice",
            "amount_paid": self.payment_amount,
            "currency": "INR",
            "line_items": [
                {
                    "type": self.invoice_line_type,
                    "quantity": 1,
                    "amount": self.payment_amount,
                    "currency": "INR",
                }
            ],
            "billing_start": self.ends - 31 * 24 * 60 * 60,
            "billing_end": self.ends,
        }

    def get_invoices(self, subscription_id, *, skip=0):
        return {"items": [self.get_invoice("inv_test_123")] if skip == 0 else []}

    def cancel_at_cycle_end(self, subscription_id):
        self.end_cancellations += 1
        self.status = "active"
        return {"id": subscription_id, "plan_id": "plan_Starter", "status": "active"}

    def cancel_now(self, subscription_id):
        self.immediate_cancellations += 1
        self.status = "cancelled"
        return {"id": subscription_id, "status": "cancelled"}


def _setup(auth_env):
    settings = auth_env.settings
    settings.billing_enabled = True
    settings.razorpay_key_id = "rzp_test_key"
    settings.razorpay_key_secret = "test_secret"
    settings.razorpay_webhook_secret = "different_webhook_secret"
    settings.razorpay_plan_starter = "plan_Starter"
    settings.razorpay_plan_growth = "plan_Growth"
    settings.razorpay_plan_scale = "plan_Scale"
    fake = FakeRazorpay()
    app.dependency_overrides[gateway_dependency] = lambda: fake
    token = auth_env.create_account("billing@example.com")
    with auth_env.session_factory() as session:
        user = session.scalar(
            select(UserRecord).where(UserRecord.email_canonical == "billing@example.com")
        )
        user.email_verified_at = datetime.now(UTC)
        session.commit()
    return fake, token


def _webhook(
    auth_env,
    event_id="evt_1",
    *,
    event="subscription.charged",
    signature_ok=True,
    period_end=None,
    subscription_id="sub_test_123",
    payment_id="pay_test_123",
):
    current_end = period_end or int((datetime.now(UTC) + timedelta(days=30)).timestamp())
    if subscription_id == "sub_test_123":
        app.dependency_overrides[gateway_dependency]().ends = current_end
    payload = {
        "entity": "event",
        "event": event,
        "payload": {
            "subscription": {
                "entity": {
                    "id": subscription_id,
                    "current_start": current_end - 31 * 24 * 60 * 60,
                    "current_end": current_end,
                }
            },
            "payment": {"entity": {"id": payment_id}},
        },
    }
    raw = json.dumps(payload).encode()
    secret = auth_env.settings.razorpay_webhook_secret if signature_ok else "bad"
    signature = hmac.new(secret.encode(), raw, hashlib.sha256).hexdigest()
    return auth_env.client.post(
        "/api/v1/billing/webhook",
        content=raw,
        headers={
            "X-Razorpay-Signature": signature,
            "X-Razorpay-Event-Id": event_id,
        },
    )


def _drain(auth_env, fake):
    return process_due_events(auth_env.session_factory, fake)


def _refund_webhook(auth_env):
    payload = {
        "entity": "event",
        "event": "refund.processed",
        "payload": {
            "refund": {
                "entity": {
                    "id": "rfnd_test_123",
                    "status": "processed",
                    "payment_id": "pay_test_123",
                }
            },
            "payment": {"entity": {"id": "pay_test_123"}},
        },
    }
    raw = json.dumps(payload).encode()
    signature = hmac.new(
        auth_env.settings.razorpay_webhook_secret.encode(), raw, hashlib.sha256
    ).hexdigest()
    return auth_env.client.post(
        "/api/v1/billing/webhook",
        content=raw,
        headers={
            "X-Razorpay-Signature": signature,
            "X-Razorpay-Event-Id": "evt_refund",
        },
    )


def _paid_starter_then_growth_checkout(auth_env):
    fake, token = _setup(auth_env)
    headers = auth_env.csrf_headers(token)
    assert (
        auth_env.client.post(
            "/api/v1/billing/subscriptions", json={"plan": "starter"}, headers=headers
        ).status_code
        == 200
    )
    fake.status = "active"
    assert _webhook(auth_env).status_code == 200
    assert _drain(auth_env, fake)["done"] == 1
    original_subscription = fake.get_subscription
    fake.get_plan = lambda plan_id: {
        "id": plan_id,
        "period": "monthly",
        "interval": 1,
        "item": {"amount": 19900 if plan_id == "plan_Growth" else 9900, "currency": "INR"},
    }
    fake.create_subscription = lambda plan_id, user_id: {
        "id": "sub_growth_123",
        "plan_id": plan_id,
        "quantity": 1,
        "status": "created",
        "short_url": "https://rzp.io/rzp/growth",
    }
    fake.growth_status = "created"
    fake.get_subscription = lambda subscription_id: (
        {
            "id": subscription_id,
            "plan_id": "plan_Growth",
            "status": fake.growth_status,
            "paid_count": 1 if fake.growth_status == "active" else 0,
            "quantity": 1,
        }
        if subscription_id == "sub_growth_123"
        else original_subscription(subscription_id)
    )
    checkout = auth_env.client.post(
        "/api/v1/billing/subscriptions", json={"plan": "growth"}, headers=headers
    )
    assert checkout.status_code == 200, checkout.text
    return fake, headers


def test_upgrade_stacks_only_verified_paid_periods_and_stops_old_renewal(auth_env, monkeypatch):
    fake, headers = _paid_starter_then_growth_checkout(auth_env)
    with auth_env.session_factory() as session:
        starter = session.scalar(
            select(BillingSubscriptionRecord).where(
                BillingSubscriptionRecord.provider_id == "sub_test_123"
            )
        )
        session.add(
            BatchRecord(
                user_id=starter.user_id,
                status="saved",
                labels_ready=200,
                completed_at=datetime.now(UTC),
                expires_at=datetime.now(UTC) + timedelta(days=30),
            )
        )
        session.commit()
    pending = auth_env.client.get("/api/v1/billing/subscription").json()
    assert pending["activePlan"] == "Starter"
    assert pending["dailyCredits"] == 300
    assert pending["pendingPlan"] == "Growth"
    assert pending["canCancelCheckout"] is True
    assert pending["canCancelRenewal"] is False
    assert auth_env.client.get("/api/v1/dashboard/summary").json()["availableCredits"] == 100
    assert fake.end_cancellations == 0
    assert (
        auth_env.client.post(
            "/api/v1/billing/subscriptions", json={"plan": "starter"}, headers=headers
        ).status_code
        == 409
    )

    end = int((datetime.now(UTC) + timedelta(days=30)).timestamp())
    fake.growth_status = "active"
    original_payment = fake.get_payment
    fake.get_payment = lambda payment_id: (
        {
            "id": "pay_growth_123",
            "status": "captured",
            "captured": True,
            "amount": 19900,
            "currency": "INR",
            "invoice_id": "inv_growth_123",
        }
        if payment_id == "pay_growth_123"
        else original_payment(payment_id)
    )
    original_invoice = fake.get_invoice
    fake.get_invoice = lambda invoice_id: (
        {
            "id": "inv_growth_123",
            "subscription_id": "sub_growth_123",
            "payment_id": "pay_growth_123",
            "status": "paid",
            "type": "invoice",
            "amount_paid": 19900,
            "currency": "INR",
            "line_items": [{"type": "plan", "quantity": 1, "amount": 19900, "currency": "INR"}],
            "billing_start": end - 31 * 24 * 3600,
            "billing_end": end,
        }
        if invoice_id == "inv_growth_123"
        else original_invoice(invoice_id)
    )
    assert (
        _webhook(
            auth_env,
            event_id="evt_growth",
            period_end=end,
            subscription_id="sub_growth_123",
            payment_id="pay_growth_123",
        ).status_code
        == 200
    )
    assert _drain(auth_env, fake)["done"] == 1
    stacked = auth_env.client.get("/api/v1/billing/subscription").json()
    assert stacked["activePlan"] == "Growth"
    assert stacked["dailyCredits"] == 1000
    assert [plan["name"] for plan in stacked["activePlans"]] == ["Growth", "Starter"]
    assert stacked["previousPlanRenewalPending"] is True
    assert stacked["canCancelRenewal"] is False
    assert auth_env.client.get("/api/v1/dashboard/summary").json()["availableCredits"] == 800

    monkeypatch.setattr("app.routes.migration_status", lambda _bind: "up_to_date")
    with auth_env.session_factory() as session:
        charge = session.scalar(
            select(BillingChargeRecord).where(
                BillingChargeRecord.provider_payment_id == "pay_growth_123"
            )
        )
        charge.paid_at = datetime.now(UTC) - timedelta(minutes=6)
        session.commit()
    unhealthy = auth_env.client.get("/health/ready")
    assert unhealthy.status_code == 503
    assert unhealthy.json()["billing_upgrade_cleanup"] == "stale"

    result = cancel_superseded_renewals(auth_env.session_factory, fake)
    assert result == {"cancelled": 1, "failed": 0}
    assert fake.end_cancellations == 1
    assert cancel_superseded_renewals(auth_env.session_factory, fake)["cancelled"] == 0
    healthy = auth_env.client.get("/health/ready")
    assert healthy.status_code == 200
    assert healthy.json()["billing_upgrade_cleanup"] == "clear"
    assert (
        auth_env.client.get("/api/v1/billing/subscription").json()["previousPlanRenewalPending"]
        is False
    )
    assert auth_env.client.get("/api/v1/billing/subscription").json()["canCancelRenewal"] is True
    with auth_env.session_factory() as session:
        starter = session.scalar(
            select(BillingSubscriptionRecord).where(
                BillingSubscriptionRecord.provider_id == "sub_test_123"
            )
        )
        starter.paid_through = datetime.now(UTC) - timedelta(seconds=1)
        session.commit()
    after_expiry = auth_env.client.get("/api/v1/billing/subscription").json()
    assert after_expiry["dailyCredits"] == 700
    assert auth_env.client.get("/api/v1/dashboard/summary").json()["availableCredits"] == 500


def test_cancelling_upgrade_checkout_does_not_cancel_paid_starter(auth_env):
    fake, headers = _paid_starter_then_growth_checkout(auth_env)
    cancelled_ids = []
    fake.cancel_now = lambda subscription_id: (
        cancelled_ids.append(subscription_id) or {"id": subscription_id, "status": "cancelled"}
    )
    cancelled = auth_env.client.post("/api/v1/billing/subscription/cancel", headers=headers)
    assert cancelled.status_code == 200, cancelled.text
    assert cancelled_ids == ["sub_growth_123"]
    assert cancelled.json()["activePlan"] == "Starter"
    assert cancelled.json()["pendingPlan"] is None


def test_failed_old_renewal_cancellation_is_retried(auth_env):
    fake, _headers = _paid_starter_then_growth_checkout(auth_env)
    with auth_env.session_factory() as session:
        growth = session.scalar(
            select(BillingSubscriptionRecord).where(
                BillingSubscriptionRecord.provider_id == "sub_growth_123"
            )
        )
        growth.paid_through = datetime.now(UTC) + timedelta(days=30)
        growth.status = "active"
        session.commit()

    def unavailable(_subscription_id):
        raise ApiError(
            status_code=503,
            code="BILLING_PROVIDER_UNAVAILABLE",
            message="Billing is temporarily unavailable.",
        )

    original_cancel = fake.cancel_at_cycle_end
    fake.cancel_at_cycle_end = unavailable
    assert cancel_superseded_renewals(auth_env.session_factory, fake) == {
        "cancelled": 0,
        "failed": 1,
    }
    with auth_env.session_factory() as session:
        starter = session.scalar(
            select(BillingSubscriptionRecord).where(
                BillingSubscriptionRecord.provider_id == "sub_test_123"
            )
        )
        assert starter.cancel_at_cycle_end is False
    fake.cancel_at_cycle_end = original_cancel
    assert cancel_superseded_renewals(auth_env.session_factory, fake) == {
        "cancelled": 1,
        "failed": 0,
    }


def test_one_failed_lower_tier_does_not_undo_another_cancellation(auth_env):
    fake, _headers = _paid_starter_then_growth_checkout(auth_env)
    fake.growth_status = "active"
    with auth_env.session_factory() as session:
        growth = session.scalar(
            select(BillingSubscriptionRecord).where(
                BillingSubscriptionRecord.provider_id == "sub_growth_123"
            )
        )
        growth.paid_through = datetime.now(UTC) + timedelta(days=30)
        growth.status = "active"
        session.add(
            BillingSubscriptionRecord(
                user_id=growth.user_id,
                plan_code="scale",
                provider_id="sub_scale_123",
                provider_plan_id="plan_Scale",
                status="active",
                checkout_url="https://rzp.io/rzp/scale",
                paid_through=datetime.now(UTC) + timedelta(days=30),
            )
        )
        session.commit()
    original_get = fake.get_subscription
    fake.get_subscription = lambda subscription_id: (
        {
            "id": "sub_scale_123",
            "plan_id": "plan_Scale",
            "status": "active",
            "quantity": 1,
            "paid_count": 1,
        }
        if subscription_id == "sub_scale_123"
        else original_get(subscription_id)
    )
    original_cancel = fake.cancel_at_cycle_end

    def fail_growth(subscription_id):
        if subscription_id == "sub_growth_123":
            raise ApiError(
                status_code=503,
                code="BILLING_PROVIDER_UNAVAILABLE",
                message="Provider unavailable.",
            )
        return original_cancel(subscription_id)

    fake.cancel_at_cycle_end = fail_growth
    assert cancel_superseded_renewals(auth_env.session_factory, fake) == {
        "cancelled": 1,
        "failed": 1,
    }
    with auth_env.session_factory() as session:
        rows = {
            row.plan_code: row.cancel_at_cycle_end
            for row in session.scalars(select(BillingSubscriptionRecord))
        }
    assert rows == {"starter": True, "growth": False, "scale": False}
    fake.cancel_at_cycle_end = lambda subscription_id: {
        "id": subscription_id,
        "plan_id": "plan_Growth",
        "status": "active",
    }
    assert cancel_superseded_renewals(auth_env.session_factory, fake) == {
        "cancelled": 1,
        "failed": 0,
    }


def test_upgrade_close_to_renewal_requires_support_before_new_checkout(auth_env):
    fake, token = _setup(auth_env)
    headers = auth_env.csrf_headers(token)
    assert (
        auth_env.client.post(
            "/api/v1/billing/subscriptions", json={"plan": "starter"}, headers=headers
        ).status_code
        == 200
    )
    fake.status = "active"
    assert _webhook(auth_env).status_code == 200
    assert _drain(auth_env, fake)["done"] == 1
    with auth_env.session_factory() as session:
        starter = session.scalar(select(BillingSubscriptionRecord))
        starter.paid_through = datetime.now(UTC) + timedelta(hours=12)
        session.commit()
    original_plan = fake.get_plan
    fake.get_plan = lambda plan_id: (
        {
            "id": plan_id,
            "period": "monthly",
            "interval": 1,
            "item": {"amount": 19900, "currency": "INR"},
        }
        if plan_id == "plan_Growth"
        else original_plan(plan_id)
    )
    attempt = auth_env.client.post(
        "/api/v1/billing/subscriptions", json={"plan": "growth"}, headers=headers
    )
    assert attempt.status_code == 409
    assert attempt.json()["error"]["code"] == "UPGRADE_TOO_CLOSE_TO_RENEWAL"
    assert fake.created == 1


def test_billing_off_by_default(auth_env):
    token = auth_env.create_account("free@example.com")
    status = auth_env.client.get("/api/v1/billing/subscription")
    assert status.status_code == 200
    assert status.json()["available"] is False
    attempt = auth_env.client.post(
        "/api/v1/billing/subscriptions",
        json={"plan": "starter"},
        headers=auth_env.csrf_headers(token),
    )
    assert attempt.status_code == 403  # Verify email before any checkout.


def test_webhook_body_bound_applies_even_with_non_json_content_type(auth_env):
    response = auth_env.client.post(
        "/api/v1/billing/webhook",
        content=b"x" * (128 * 1024 + 1),
        headers={"Content-Type": "text/plain"},
    )
    assert response.status_code == 413


def test_verified_charge_only_and_idempotent_webhook(auth_env):
    fake, token = _setup(auth_env)
    headers = auth_env.csrf_headers(token)
    first = auth_env.client.post(
        "/api/v1/billing/subscriptions", json={"plan": "starter"}, headers=headers
    )
    assert first.status_code == 200, first.text
    assert first.json()["checkoutUrl"] == "https://rzp.io/rzp/test"
    repeat = auth_env.client.post(
        "/api/v1/billing/subscriptions", json={"plan": "starter"}, headers=headers
    )
    assert repeat.status_code == 200
    assert fake.created == 1
    assert auth_env.client.get("/api/v1/dashboard/summary").json()["activePlan"] == "Early access"
    assert _webhook(auth_env, signature_ok=False).status_code == 401
    assert auth_env.client.get("/api/v1/dashboard/summary").json()["activePlan"] == "Early access"
    fake.status = "active"
    assert _webhook(auth_env).status_code == 200
    assert _webhook(auth_env).json()["status"] == "duplicate"
    assert _webhook(auth_env, event_id="evt_2").json()["status"] == "duplicate"
    assert _drain(auth_env, fake)["done"] == 1
    with auth_env.session_factory() as session:
        assert len(list(session.scalars(select(BillingChargeRecord)))) == 1
        assert len(list(session.scalars(select(BillingSubscriptionRecord)))) == 1
    summary = auth_env.client.get("/api/v1/dashboard/summary").json()
    assert summary["activePlan"] == "Starter"
    assert summary["availableCredits"] == 300
    cancelled = auth_env.client.post("/api/v1/billing/subscription/cancel", headers=headers)
    assert cancelled.status_code == 200
    assert cancelled.json()["renews"] is False
    assert auth_env.client.get("/api/v1/dashboard/summary").json()["activePlan"] == "Starter"


def test_authentication_without_charge_never_grants_paid_credits(auth_env):
    fake, token = _setup(auth_env)
    headers = auth_env.csrf_headers(token)
    assert (
        auth_env.client.post(
            "/api/v1/billing/subscriptions", json={"plan": "starter"}, headers=headers
        ).status_code
        == 200
    )
    fake.status = "authenticated"
    assert (
        _webhook(
            auth_env, event_id="evt_authenticated", event="subscription.authenticated"
        ).status_code
        == 200
    )
    assert _drain(auth_env, fake)["done"] == 1
    with auth_env.session_factory() as session:
        row = session.scalar(select(BillingSubscriptionRecord))
        assert row.status == "authenticated"
        assert row.paid_through is None
    assert auth_env.client.get("/api/v1/dashboard/summary").json()["activePlan"] == "Early access"


def test_abandoned_checkout_can_be_cancelled(auth_env):
    fake, token = _setup(auth_env)
    headers = auth_env.csrf_headers(token)
    assert (
        auth_env.client.post(
            "/api/v1/billing/subscriptions", json={"plan": "starter"}, headers=headers
        ).status_code
        == 200
    )
    assert (
        auth_env.client.post("/api/v1/billing/subscription/cancel", headers=headers).status_code
        == 200
    )
    assert fake.status == "cancelled"
    assert auth_env.client.get("/api/v1/billing/subscription").json()["pendingPlan"] is None
    assert auth_env.client.get("/api/v1/dashboard/summary").json()["activePlan"] == "Early access"


def test_wrong_charge_amount_never_grants_credits(auth_env):
    fake, token = _setup(auth_env)
    assert (
        auth_env.client.post(
            "/api/v1/billing/subscriptions",
            json={"plan": "starter"},
            headers=auth_env.csrf_headers(token),
        ).status_code
        == 200
    )
    fake.status = "active"
    fake.payment_amount = 100
    assert _webhook(auth_env).status_code == 200
    assert _drain(auth_env, fake)["retry"] == 1
    assert auth_env.client.get("/api/v1/dashboard/summary").json()["activePlan"] == "Early access"


def test_old_charge_webhook_cannot_extend_current_access(auth_env):
    fake, token = _setup(auth_env)
    assert (
        auth_env.client.post(
            "/api/v1/billing/subscriptions",
            json={"plan": "starter"},
            headers=auth_env.csrf_headers(token),
        ).status_code
        == 200
    )
    fake.status = "active"
    yesterday = int((datetime.now(UTC) - timedelta(days=1)).timestamp())
    assert _webhook(auth_env, event_id="evt_old", period_end=yesterday).status_code == 200
    assert _drain(auth_env, fake)["done"] == 1
    assert auth_env.client.get("/api/v1/dashboard/summary").json()["activePlan"] == "Early access"


def test_full_refund_revokes_paid_allowance(auth_env):
    fake, token = _setup(auth_env)
    assert (
        auth_env.client.post(
            "/api/v1/billing/subscriptions",
            json={"plan": "starter"},
            headers=auth_env.csrf_headers(token),
        ).status_code
        == 200
    )
    fake.status = "active"
    assert _webhook(auth_env).status_code == 200
    assert _drain(auth_env, fake)["done"] == 1
    fake.payment_status = "refunded"
    response = _refund_webhook(auth_env)
    assert response.status_code == 200, response.text
    assert _drain(auth_env, fake)["done"] == 1
    assert auth_env.client.get("/api/v1/dashboard/summary").json()["activePlan"] == "Early access"


def test_unrelated_refund_without_invoice_is_not_retried(auth_env):
    fake, _token = _setup(auth_env)
    fake.payment_invoice_id = None
    fake.payment_status = "refunded"
    assert _refund_webhook(auth_env).status_code == 200
    assert _drain(auth_env, fake)["ignored"] == 1
    with auth_env.session_factory() as session:
        event = session.scalar(select(BillingWebhookEventRecord))
        assert event.status == "ignored"
        assert event.last_error == "NON_SUBSCRIPTION_REFUND"


def test_partial_refund_is_recorded_for_manual_review_without_retry(auth_env):
    fake, token = _setup(auth_env)
    assert (
        auth_env.client.post(
            "/api/v1/billing/subscriptions",
            json={"plan": "starter"},
            headers=auth_env.csrf_headers(token),
        ).status_code
        == 200
    )
    fake.status = "active"
    assert _webhook(auth_env).status_code == 200
    assert _drain(auth_env, fake)["done"] == 1
    fake.partial_refund_amount = 5000
    assert _refund_webhook(auth_env).status_code == 200
    assert _drain(auth_env, fake)["ignored"] == 1
    with auth_env.session_factory() as session:
        event = session.scalar(
            select(BillingWebhookEventRecord).where(
                BillingWebhookEventRecord.event_type == "refund.processed"
            )
        )
        assert event.last_error == "PARTIAL_REFUND_MANUAL_REVIEW"
    assert auth_env.client.get("/api/v1/dashboard/summary").json()["activePlan"] == "Starter"


def test_activated_before_charged_never_offers_immediate_cancellation(auth_env):
    fake, token = _setup(auth_env)
    headers = auth_env.csrf_headers(token)
    assert (
        auth_env.client.post(
            "/api/v1/billing/subscriptions", json={"plan": "starter"}, headers=headers
        ).status_code
        == 200
    )
    fake.status = "active"
    assert _webhook(auth_env, event="subscription.activated").status_code == 200
    assert _drain(auth_env, fake)["done"] == 1
    status = auth_env.client.get("/api/v1/billing/subscription").json()
    assert status["pendingPlan"] == "Starter"
    assert status["canCancelCheckout"] is False
    assert status["canCancelRenewal"] is True
    assert (
        auth_env.client.post("/api/v1/billing/subscription/cancel", headers=headers).status_code
        == 200
    )
    assert fake.immediate_cancellations == 0
    assert fake.end_cancellations == 1


def test_authenticated_state_is_not_assumed_unpaid(auth_env):
    fake, token = _setup(auth_env)
    headers = auth_env.csrf_headers(token)
    assert (
        auth_env.client.post(
            "/api/v1/billing/subscriptions", json={"plan": "starter"}, headers=headers
        ).status_code
        == 200
    )
    fake.status = "authenticated"
    assert _webhook(auth_env, event="subscription.authenticated").status_code == 200
    assert _drain(auth_env, fake)["done"] == 1
    status = auth_env.client.get("/api/v1/billing/subscription").json()
    assert status["canCancelRenewal"] is False
    assert status["canCancelCheckout"] is False
    response = auth_env.client.post("/api/v1/billing/subscription/cancel", headers=headers)
    assert response.status_code == 409
    assert fake.immediate_cancellations == 0


def test_invoice_reconciliation_recovers_missing_webhook_once(auth_env):
    fake, token = _setup(auth_env)
    assert (
        auth_env.client.post(
            "/api/v1/billing/subscriptions",
            json={"plan": "starter"},
            headers=auth_env.csrf_headers(token),
        ).status_code
        == 200
    )
    fake.status = "active"
    assert reconcile_due_subscriptions(auth_env.session_factory, fake)["recovered"] == 1
    assert (
        reconcile_one_subscription(auth_env.session_factory, fake, "sub_test_123")["recovered"] == 0
    )
    assert auth_env.client.get("/api/v1/dashboard/summary").json()["activePlan"] == "Starter"
    fake.payment_status = "refunded"
    assert (
        reconcile_one_subscription(auth_env.session_factory, fake, "sub_test_123")["refunded"] == 1
    )
    assert auth_env.client.get("/api/v1/dashboard/summary").json()["activePlan"] == "Early access"


def test_expired_terminal_subscription_stops_hourly_reconciliation(auth_env):
    fake, token = _setup(auth_env)
    assert (
        auth_env.client.post(
            "/api/v1/billing/subscriptions",
            json={"plan": "starter"},
            headers=auth_env.csrf_headers(token),
        ).status_code
        == 200
    )
    fake.status = "cancelled"
    fake.ends = int((datetime.now(UTC) - timedelta(days=1)).timestamp())
    assert reconcile_due_subscriptions(auth_env.session_factory, fake)["recovered"] == 1
    with auth_env.session_factory() as session:
        row = session.scalar(select(BillingSubscriptionRecord))
        assert row.next_reconcile_at is None
        assert row.last_reconciled_at is not None
    assert reconcile_due_subscriptions(auth_env.session_factory, fake) == {
        "checked": 0,
        "recovered": 0,
        "refunded": 0,
        "flagged": 0,
    }


def test_cancelled_subscription_keeps_reconciling_until_paid_period_ends(auth_env):
    fake, token = _setup(auth_env)
    assert (
        auth_env.client.post(
            "/api/v1/billing/subscriptions",
            json={"plan": "starter"},
            headers=auth_env.csrf_headers(token),
        ).status_code
        == 200
    )
    fake.status = "cancelled"
    assert reconcile_due_subscriptions(auth_env.session_factory, fake)["recovered"] == 1
    with auth_env.session_factory() as session:
        row = session.scalar(select(BillingSubscriptionRecord))
        assert row.next_reconcile_at is not None


def test_deleted_subscription_does_not_abort_reconciliation_batch(auth_env):
    fake, token = _setup(auth_env)
    assert (
        auth_env.client.post(
            "/api/v1/billing/subscriptions",
            json={"plan": "starter"},
            headers=auth_env.csrf_headers(token),
        ).status_code
        == 200
    )
    get_payment = fake.get_payment

    def delete_account_before_payment_apply(payment_id):
        with auth_env.session_factory() as session:
            session.execute(delete(BillingSubscriptionRecord))
            session.commit()
        return get_payment(payment_id)

    fake.get_payment = delete_account_before_payment_apply
    assert reconcile_due_subscriptions(auth_env.session_factory, fake)["recovered"] == 0


def test_unverified_charge_is_recorded_for_retry_without_poisoning_webhook(auth_env):
    fake, token = _setup(auth_env)
    assert (
        auth_env.client.post(
            "/api/v1/billing/subscriptions",
            json={"plan": "starter"},
            headers=auth_env.csrf_headers(token),
        ).status_code
        == 200
    )
    fake.status = "active"
    fake.payment_amount = 100
    assert _webhook(auth_env).status_code == 200
    assert _drain(auth_env, fake)["retry"] == 1
    with auth_env.session_factory() as session:
        event = session.scalar(select(BillingWebhookEventRecord))
        assert event.status == "retry"
        assert event.last_error == "BILLING_CHARGE_UNVERIFIED"
    assert auth_env.client.get("/api/v1/dashboard/summary").json()["activePlan"] == "Early access"


def test_equal_value_addon_is_not_mistaken_for_plan_charge(auth_env):
    fake, token = _setup(auth_env)
    assert (
        auth_env.client.post(
            "/api/v1/billing/subscriptions",
            json={"plan": "starter"},
            headers=auth_env.csrf_headers(token),
        ).status_code
        == 200
    )
    fake.status = "active"
    fake.invoice_line_type = "addon"
    assert _webhook(auth_env).status_code == 200
    assert _drain(auth_env, fake)["retry"] == 1
    assert auth_env.client.get("/api/v1/dashboard/summary").json()["activePlan"] == "Early access"


def test_refund_status_lag_is_retried_and_not_lost(auth_env):
    fake, token = _setup(auth_env)
    assert (
        auth_env.client.post(
            "/api/v1/billing/subscriptions",
            json={"plan": "starter"},
            headers=auth_env.csrf_headers(token),
        ).status_code
        == 200
    )
    fake.status = "active"
    assert _webhook(auth_env).status_code == 200
    assert _drain(auth_env, fake)["done"] == 1
    assert _refund_webhook(auth_env).status_code == 200
    assert _drain(auth_env, fake)["retry"] == 1
    assert auth_env.client.get("/api/v1/dashboard/summary").json()["activePlan"] == "Starter"
    fake.payment_status = "refunded"
    with auth_env.session_factory() as session:
        refund_event = session.scalar(
            select(BillingWebhookEventRecord).where(
                BillingWebhookEventRecord.event_type == "refund.processed"
            )
        )
        refund_event.next_attempt_at = datetime.now(UTC) - timedelta(seconds=1)
        session.commit()
    assert _drain(auth_env, fake)["done"] == 1
    assert auth_env.client.get("/api/v1/dashboard/summary").json()["activePlan"] == "Early access"


def test_refund_before_charge_never_grants_refunded_credits(auth_env):
    fake, token = _setup(auth_env)
    assert (
        auth_env.client.post(
            "/api/v1/billing/subscriptions",
            json={"plan": "starter"},
            headers=auth_env.csrf_headers(token),
        ).status_code
        == 200
    )
    fake.status = "active"
    fake.payment_status = "refunded"
    assert _refund_webhook(auth_env).status_code == 200
    assert _drain(auth_env, fake)["retry"] == 1
    assert _webhook(auth_env).status_code == 200
    assert _drain(auth_env, fake)["retry"] == 1
    assert auth_env.client.get("/api/v1/dashboard/summary").json()["activePlan"] == "Early access"
