import { DashboardPage } from "@/features/dashboard/page-shell";
import { SubscriptionPlans } from "@/features/plans/subscription-plans";

export const metadata = { title: "Subscription plans" };

export default function SubscriptionPage() {
  return (
    <DashboardPage
      eyebrow="ACCOUNT / SUBSCRIPTION"
      title="Choose capacity that fits."
      description="Daily credits reset each day. Paid plans renew monthly until cancelled, and you review the amount before authorising payment on Razorpay."
    >
      <SubscriptionPlans />
    </DashboardPage>
  );
}
