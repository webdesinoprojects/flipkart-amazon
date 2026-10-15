from dataclasses import dataclass

from ...config import Settings


@dataclass(frozen=True)
class PaidPlan:
    code: str
    name: str
    amount_paise: int
    daily_credits: int


PLANS = {
    "starter": PaidPlan("starter", "Starter", 9900, 300),
    "growth": PaidPlan("growth", "Growth", 19900, 700),
    "scale": PaidPlan("scale", "Scale", 29900, 1200),
}


def provider_plan_id(settings: Settings, code: str) -> str:
    return {
        "starter": settings.razorpay_plan_starter,
        "growth": settings.razorpay_plan_growth,
        "scale": settings.razorpay_plan_scale,
    }[code]
