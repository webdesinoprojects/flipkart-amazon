import { Check } from "lucide-react";
import { DashboardPage } from "@/features/dashboard/page-shell";
import { plans } from "@/features/plans/catalog";
import styles from "@/features/dashboard/dashboard.module.css";

export const metadata = { title: "Subscription plans" };

export default function SubscriptionPage() {
  return (
    <DashboardPage
      eyebrow="ACCOUNT / SUBSCRIPTION"
      title="Choose capacity that fits."
      description="Your 100 daily credits are free during early access. Larger allowances are coming when paid plans launch; checkout is not open yet."
    >
      <div className={styles.planGrid}>
        {plans
          .filter((plan) => !plan.available)
          .map((plan) => (
            <article className={styles.card} key={plan.name}>
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
                COMING SOON
              </span>
            </article>
          ))}
      </div>
    </DashboardPage>
  );
}
