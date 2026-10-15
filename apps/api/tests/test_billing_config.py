import pytest
from pydantic import ValidationError

from app.config import Settings

PLAN_IDS = {
    "razorpay_plan_starter": "plan_Starter",
    "razorpay_plan_growth": "plan_Growth",
    "razorpay_plan_scale": "plan_Scale",
}


def billing_settings(**overrides):
    values = {
        "_env_file": None,
        "billing_enabled": True,
        "razorpay_mode": "test",
        "razorpay_key_id": "rzp_test_example",
        "razorpay_key_secret": "test_secret",
        "razorpay_webhook_secret": "independent_webhook_secret",
        **PLAN_IDS,
        **overrides,
    }
    return Settings(**values)


def test_test_mode_requires_matching_key():
    with pytest.raises(ValidationError, match="matching mode/key"):
        billing_settings(razorpay_key_id="rzp_live_example")


def test_live_mode_requires_production_environment():
    with pytest.raises(ValidationError, match="ENVIRONMENT=production"):
        billing_settings(razorpay_mode="live", razorpay_key_id="rzp_live_example")


def test_test_mode_rejects_live_site_origin():
    with pytest.raises(ValidationError, match="live SellerLabel domain"):
        billing_settings(app_public_origins="https://sellerlabel.in")


def test_isolated_test_mode_can_be_enabled():
    settings = billing_settings(app_public_origins="https://staging.example.com")
    assert settings.billing_configured
