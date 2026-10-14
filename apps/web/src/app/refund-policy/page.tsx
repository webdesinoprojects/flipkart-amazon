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
      summary="SellerLabel is free during early access and does not currently collect subscription payments."
    >
      <section>
        <h2>Early access</h2>
        <p>
          No subscription fee is collected during the current early-access
          period, so there is no paid plan to cancel or refund.
        </p>
      </section>
      <section>
        <h2>Duplicate or failed payments</h2>
        <p>
          If a payment appears because of a duplicate or failed transaction
          after billing becomes available, contact us with the payment
          reference. Verified duplicate or failed-payment charges will be
          returned to the original payment method.
        </p>
      </section>
      <section>
        <h2>Before paid plans begin</h2>
        <p>
          The checkout page will show the final price, renewal terms, included
          daily credits and paid-plan cancellation rules before you authorise a
          payment. This policy will be updated before subscriptions are enabled.
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
