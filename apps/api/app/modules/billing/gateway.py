"""Minimal server-only Razorpay API boundary. No provider response is logged."""

from __future__ import annotations

import httpx

from ...config import Settings
from ...platform.http.errors import ApiError


class RazorpayGateway:
    def __init__(self, settings: Settings) -> None:
        self.settings = settings

    def _request(self, method: str, path: str, *, body: dict | None = None) -> dict:
        try:
            with httpx.Client(
                base_url="https://api.razorpay.com",
                auth=(self.settings.razorpay_key_id, self.settings.razorpay_key_secret),
                timeout=10.0,
            ) as client:
                response = client.request(method, path, json=body)
                response.raise_for_status()
                result = response.json()
            if isinstance(result, dict):
                return result
        except (httpx.HTTPError, ValueError) as error:
            raise ApiError(
                status_code=503,
                code="BILLING_PROVIDER_UNAVAILABLE",
                message="Billing is temporarily unavailable. Please try again later.",
            ) from error
        raise ApiError(
            status_code=503,
            code="BILLING_PROVIDER_UNAVAILABLE",
            message="Billing is temporarily unavailable. Please try again later.",
        )

    def get_plan(self, plan_id: str) -> dict:
        return self._request("GET", f"/v1/plans/{plan_id}")

    def create_subscription(self, plan_id: str, user_id: str) -> dict:
        return self._request(
            "POST",
            "/v1/subscriptions",
            body={
                "plan_id": plan_id,
                "total_count": 120,
                "quantity": 1,
                "customer_notify": True,
                "notes": {"sellerlabel_user_id": user_id},
            },
        )

    def get_subscription(self, subscription_id: str) -> dict:
        return self._request("GET", f"/v1/subscriptions/{subscription_id}")

    def get_payment(self, payment_id: str) -> dict:
        return self._request("GET", f"/v1/payments/{payment_id}")

    def get_invoices(self, subscription_id: str, *, skip: int = 0) -> dict:
        return self._request(
            "GET", f"/v1/invoices?subscription_id={subscription_id}&count=100&skip={skip}"
        )

    def get_invoice(self, invoice_id: str) -> dict:
        return self._request("GET", f"/v1/invoices/{invoice_id}")

    def cancel_at_cycle_end(self, subscription_id: str) -> dict:
        return self._request(
            "POST",
            f"/v1/subscriptions/{subscription_id}/cancel",
            body={"cancel_at_cycle_end": True},
        )

    def cancel_now(self, subscription_id: str) -> dict:
        return self._request(
            "POST",
            f"/v1/subscriptions/{subscription_id}/cancel",
            body={"cancel_at_cycle_end": False},
        )


def get_gateway(settings: Settings) -> RazorpayGateway:
    return RazorpayGateway(settings)
