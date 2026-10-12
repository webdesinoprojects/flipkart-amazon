import { Check } from "lucide-react";
import { DashboardPage } from "@/features/dashboard/page-shell";
import styles from "@/features/dashboard/dashboard.module.css";

export const metadata = { title: "Subscription plans" };

const plans = [
  { name: "Starter", price: "₹99", capacity: "100 pages per day" },
  { name: "Growth", price: "₹199", capacity: "400 pages per day" },
  { name: "Scale", price: "₹299", capacity: "800 pages per day" },
] as const;

export default function SubscriptionPage() {
  return (
    <DashboardPage
      eyebrow="ACCOUNT / SUBSCRIPTION"
      title="Choose capacity that fits."
      description="These are the planned launch tiers. Checkout is intentionally disabled until Razorpay webhooks, credit grants, and reconciliation are implemented."
    >
      <div className={styles.planGrid}>
        {plans.map((plan) => (
          <article className={styles.card} key={plan.name}>
            <span className={styles.pageEyebrow}>
              {plan.name.toUpperCase()}
            </span>
            <div className={styles.planPrice}>
              <strong>{plan.price}</strong>
              <span>/ PLAN PERIOD</span>
            </div>
            <p className={styles.planCapacity}>{plan.capacity}</p>
            <div className={styles.workflowList}>
              {[
                "Mixed marketplace batches",
                "Native PDF output",
                "Manual review flow",
              ].map((feature) => (
                <div className={styles.workflowItem} key={feature}>
                  <Check aria-hidden="true" size={14} />
                  <strong>{feature}</strong>
                </div>
              ))}
            </div>
            <span className={styles.secondaryAction} aria-disabled="true">
              BILLING COMING NEXT
            </span>
          </article>
        ))}
      </div>
    </DashboardPage>
  );
}
