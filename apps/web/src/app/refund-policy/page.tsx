import type { Metadata } from "next";
import { LegalPage } from "@/features/legal/legal-page";
import { absoluteUrl } from "@/lib/site";

export const metadata: Metadata = {
  title: "Cancellation and Refund Policy | SellerLabel",
  description: "SellerLabel cancellation and refund information.",
  alternates: { canonical: absoluteUrl("/refund-policy") },
};

export default function RefundPolicyPage() {
  return (
    <LegalPage
      eyebrow="SELLERLABEL / BILLING"
      title="Cancellation and refund policy"
      summary="Free early access has no fee. Paid monthly subscriptions are available only when checkout is enabled."
    >
      <section>
        <h2>Early access</h2>
        <p>The free plan has no fee or payment to refund.</p>
      </section>
      <section>
        <h2>Paid subscription cancellation</h2>
        <p>
          Paid plans renew automatically each month after you authorise a
          Razorpay subscription. You can cancel renewal in Account /
          Subscription. Your paid daily allowance continues until the end of the
          period already paid for. Contact support if cancellation is not
          confirmed.
        </p>
      </section>
      <section>
        <h2>Duplicate or failed payments</h2>
        <p>
          If you see a duplicate charge or a charge without corresponding paid
          access, contact us with the payment reference. We will investigate and
          resolve a verified billing error, including a refund where applicable.
        </p>
      </section>
      <section>
        <h2>Before authorising payment</h2>
        <p>
          The checkout page will show the final price, renewal terms, included
          daily credits and payment method before you authorise a payment.
          Unused daily credits do not roll over; cancellation does not
          automatically refund an already paid period.
        </p>
      </section>
      <section>
        <h2>Billing support</h2>
        <p>
          Email{" "}
          <a href="mailto:sellerlabels@gmail.com">sellerlabels@gmail.com</a>
          with your account email and payment reference. Never send a password,
          OTP, card number or UPI PIN.
        </p>
      </section>
    </LegalPage>
  );
}
