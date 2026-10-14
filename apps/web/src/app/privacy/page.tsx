import type { Metadata } from "next";
import { LegalPage } from "@/features/legal/legal-page";
import { absoluteUrl } from "@/lib/site";

export const metadata: Metadata = {
  title: "Privacy Policy | SellerLabel",
  description: "How SellerLabel handles account and shipping-label data.",
  alternates: { canonical: absoluteUrl("/privacy") },
};

export default function PrivacyPage() {
  return (
    <LegalPage
      eyebrow="SELLERLABEL / LEGAL"
      title="Privacy policy"
      summary="This policy explains what SellerLabel processes, what stays on your device, and what is retained in your account."
    >
      <section>
        <h2>Information we collect</h2>
        <p>
          We collect the email address you use to create an account, a securely
          hashed password, session and security records, and basic usage totals
          such as prepared label and batch counts.
        </p>
      </section>
      <section>
        <h2>Your shipping documents</h2>
        <p>
          Original Flipkart, Amazon and Meesho PDFs are processed in your
          browser during the normal workflow. They are not uploaded for label
          detection or cropping.
        </p>
        <p>
          The finished combined PDF is retained in your private account history
          so you can preview or download it again. Saved outputs are removed
          after the configured retention period, normally 30 days.
        </p>
      </section>
      <section>
        <h2>How we use information</h2>
        <ul>
          <li>Provide and secure your SellerLabel account.</li>
          <li>Deliver verification codes and password-reset messages.</li>
          <li>Show private history, usage and remaining daily credits.</li>
          <li>Prevent abuse and investigate service errors.</li>
        </ul>
      </section>
      <section>
        <h2>Service providers</h2>
        <p>
          SellerLabel uses infrastructure providers to host the service and
          Resend to deliver account email. Providers receive only the data
          needed to perform their service and are not permitted to use it for
          their own marketing.
        </p>
      </section>
      <section>
        <h2>Cookies and security</h2>
        <p>
          We use secure, HTTP-only session cookies and a CSRF cookie needed to
          protect account actions. We do not use these cookies for advertising.
          Reasonable technical safeguards are used, but no internet service can
          promise absolute security.
        </p>
      </section>
      <section>
        <h2>Your choices</h2>
        <p>
          You may ask for access, correction or deletion of your account data by
          emailing{" "}
          <a href="mailto:sellerlabels@gmail.com">sellerlabels@gmail.com</a>. We
          may retain limited records where required for security, legal or
          accounting obligations.
        </p>
      </section>
    </LegalPage>
  );
}
