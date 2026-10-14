import type { Metadata } from "next";
import { LegalPage } from "@/features/legal/legal-page";
import { absoluteUrl } from "@/lib/site";

export const metadata: Metadata = {
  title: "Contact SellerLabel",
  description:
    "Contact SellerLabel for support, business plans or privacy requests.",
  alternates: { canonical: absoluteUrl("/contact") },
};

export default function ContactPage() {
  return (
    <LegalPage
      eyebrow="SELLERLABEL / SUPPORT"
      title="Contact us"
      summary="Get help with an account, a label batch, privacy, or a custom business allowance."
    >
      <section>
        <h2>Customer support</h2>
        <p>
          Email{" "}
          <a href="mailto:sellerlabels@gmail.com">sellerlabels@gmail.com</a>.
          Include your account email and a short description, but do not attach
          a customer PDF unless support specifically asks for a safe sample.
        </p>
      </section>
      <section>
        <h2>Business plans</h2>
        <p>
          For higher daily volume or team onboarding, email
          <a href="mailto:sellerlabels@gmail.com?subject=SellerLabel%20Business%20Plan">
            {" "}
            sellerlabels@gmail.com
          </a>
          with your approximate number of labels per day.
        </p>
      </section>
      <section>
        <h2>Security and privacy</h2>
        <p>
          Use the same address for a security report or a request concerning
          access, correction or deletion of account data.
        </p>
      </section>
    </LegalPage>
  );
}
