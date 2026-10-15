"use client";

import { useEffect, useState } from "react";
import { Check } from "lucide-react";
import { browserApiRequest } from "@/features/auth/browser-api";
import { plans } from "./catalog";
import { CancelSubscriptionDialog } from "./cancel-subscription-dialog";
import styles from "@/features/dashboard/dashboard.module.css";

type BillingStatus = {
  available: boolean;
  activePlan: string;
  currentStatus: string | null;
  dailyCredits: number;
  paidThrough: string | null;
  renews: boolean;
  pendingPlan: string | null;
  pendingCheckoutUrl: string | null;
  pendingStatus: string | null;
  canCancelCheckout: boolean;
  canCancelRenewal: boolean;
};

function hostedCheckoutUrl(value: string | null): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === "rzp.io"
      ? url.href
      : null;
  } catch {
    return null;
  }
}

export function SubscriptionPlans() {
  const [status, setStatus] = useState<BillingStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelError, setCancelError] = useState("");
  const resumeUrl = hostedCheckoutUrl(status?.pendingCheckoutUrl ?? null);
  useEffect(() => {
    let active = true;
    browserApiRequest<BillingStatus>("/api/v1/billing/subscription").then(
      (result) => {
        if (active) setStatus(result);
      },
      () => {
        if (active)
          setError(
            "We couldn't load billing details. Please refresh this page.",
          );
      },
    );
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!status?.pendingPlan) return;
    const timer = window.setInterval(() => {
      browserApiRequest<BillingStatus>("/api/v1/billing/subscription").then(
        setStatus,
        () => undefined, // Keep the current state; the next poll can recover.
      );
    }, 5000);
    return () => window.clearInterval(timer);
  }, [status?.pendingPlan]);

  async function start(plan: "starter" | "growth" | "scale") {
    setBusy(true);
    setError("");
    try {
      const result = await browserApiRequest<{ checkoutUrl: string }>(
        "/api/v1/billing/subscriptions",
        { method: "POST", body: JSON.stringify({ plan }) },
        true,
      );
      const checkoutUrl = hostedCheckoutUrl(result.checkoutUrl);
      if (!checkoutUrl) throw new Error("Invalid checkout link.");
      window.location.assign(checkoutUrl);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Checkout could not start.",
      );
      setBusy(false);
    }
  }

  async function cancel() {
    setBusy(true);
    setCancelError("");
    try {
      setStatus(
        await browserApiRequest<BillingStatus>(
          "/api/v1/billing/subscription/cancel",
          { method: "POST" },
          true,
        ),
      );
      setCancelOpen(false);
    } catch (cause) {
      setCancelError(
        cause instanceof Error
          ? cause.message
          : "Cancellation could not be confirmed.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className={styles.card} aria-live="polite">
        <span className={styles.pageEyebrow}>CURRENT PLAN</span>
        <p className={styles.planCapacity}>
          {status
            ? `${status.activePlan} · ${status.dailyCredits.toLocaleString("en-IN")} credits/day`
            : "Loading your plan…"}
        </p>
        {status?.paidThrough && (
          <p>
            Paid through{" "}
            {new Date(status.paidThrough).toLocaleDateString("en-IN", {
              dateStyle: "medium",
            })}
            .{" "}
            {status.renews
              ? "Renews automatically each month."
              : status.currentStatus === "authenticated"
                ? "Mandate state is being checked. Contact support to cancel."
                : status.canCancelRenewal
                  ? "Renewal needs attention. Check your payment status or contact support."
                  : "Renewal is cancelled."}
          </p>
        )}
        {status?.pendingPlan && (
          <p>
            {status.pendingPlan}{" "}
            {status.pendingStatus === "created"
              ? "checkout is open."
              : status.pendingStatus === "authenticated"
                ? "mandate is authenticated. Contact support to cancel while payment is being checked."
                : status.pendingStatus === "halted" ||
                    status.pendingStatus === "paused" ||
                    status.pendingStatus === "pending"
                  ? "payment needs attention. Check Razorpay or contact support."
                  : "payment confirmation is being checked."}{" "}
            Do not start another subscription.
          </p>
        )}
        {resumeUrl && (
          <a className={styles.secondaryAction} href={resumeUrl}>
            RESUME CHECKOUT
          </a>
        )}
        {(status?.canCancelRenewal || status?.canCancelCheckout) && (
          <CancelSubscriptionDialog
            kind={status.canCancelRenewal ? "renewal" : "checkout"}
            hasPaidPeriod={Boolean(status.paidThrough)}
            open={cancelOpen}
            busy={busy}
            error={cancelError}
            onOpenChange={(next) => {
              setCancelOpen(next);
              if (!next) setCancelError("");
            }}
            onConfirm={() => void cancel()}
          />
        )}
        {!status?.available && (
          <p>
            Paid checkout is not open yet. Your free credits remain available.
          </p>
        )}
        {error && <p role="alert">{error}</p>}
      </div>
      <div className={styles.planGrid}>
        {plans
          .filter((plan) => plan.code !== "free")
          .map((plan) => (
            <article className={styles.card} key={plan.code}>
              <span className={styles.pageEyebrow}>
                {plan.name.toUpperCase()}
              </span>
              <div className={styles.planPrice}>
                <strong>₹{plan.monthlyPriceInr}</strong>
                <span>/ MONTH</span>
              </div>
              <p className={styles.planCapacity}>
                {plan.dailyCredits.toLocaleString("en-IN")} labels per day
              </p>
              <div className={styles.workflowList}>
                {[
                  "Mixed marketplace batches",
                  "Sharp PDF output",
                  "Review before printing",
                ].map((feature) => (
                  <div className={styles.workflowItem} key={feature}>
                    <Check aria-hidden="true" size={14} />
                    <strong>{feature}</strong>
                  </div>
                ))}
              </div>
              <button
                className={styles.secondaryAction}
                type="button"
                disabled={
                  !status?.available ||
                  busy ||
                  status.activePlan !== "Early access" ||
                  !!status.pendingPlan
                }
                onClick={() =>
                  void start(plan.code as "starter" | "growth" | "scale")
                }
              >
                {status?.available ? "SUBSCRIBE" : "COMING SOON"}
              </button>
            </article>
          ))}
      </div>
      <p>
        Plans renew monthly until cancelled (maximum 120 billing cycles). Cancel
        renewal from this page. One prepared label uses one daily credit; unused
        credits do not roll over.
      </p>
    </>
  );
}
