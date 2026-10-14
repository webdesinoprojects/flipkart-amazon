import type { Metadata } from "next";
import { LegalPage } from "@/features/legal/legal-page";
import { absoluteUrl } from "@/lib/site";

export const metadata: Metadata = {
  title: "Terms and Conditions | SellerLabel",
  description: "Terms governing use of the SellerLabel service.",
  alternates: { canonical: absoluteUrl("/terms") },
};

export default function TermsPage() {
  return (
    <LegalPage
      eyebrow="SELLERLABEL / LEGAL"
      title="Terms and conditions"
      summary="These terms govern your account and use of SellerLabel's label-preparation service."
    >
      <section>
        <h2>Using SellerLabel</h2>
        <p>
          You must be legally able to enter a contract and may use SellerLabel
          only for documents you are authorised to process. Keep your account
          credentials secure and provide accurate registration information.
        </p>
      </section>
      <section>
        <h2>Label output</h2>
        <p>
          SellerLabel helps identify, crop and arrange marketplace shipping
          labels. You remain responsible for previewing each output and checking
          addresses, barcodes, page size and printer settings before dispatch.
        </p>
      </section>
      <section>
        <h2>Credits and fair use</h2>
        <p>
          One successfully prepared shipping label uses one credit. Early-access
          accounts receive a daily allowance. Attempts to bypass limits, disrupt
          the service, access another account or upload malicious files are not
          permitted.
        </p>
      </section>
      <section>
        <h2>Your content</h2>
        <p>
          You retain ownership of your documents and grant SellerLabel only the
          limited permission needed to provide private output history and the
          features you request. Do not submit unlawful content or personal data
          you are not authorised to handle.
        </p>
      </section>
      <section>
        <h2>Availability and changes</h2>
        <p>
          We may maintain, improve or discontinue features and may suspend an
          account for abuse, security risk or breach of these terms. We will use
          reasonable efforts to keep the service available but do not guarantee
          uninterrupted operation or compatibility with every marketplace PDF.
        </p>
      </section>
      <section>
        <h2>Liability</h2>
        <p>
          To the extent permitted by Indian law, SellerLabel is not responsible
          for indirect losses, failed shipments, marketplace penalties or print
          waste caused by unchecked output, source-document errors, printer
          settings or service interruption.
        </p>
      </section>
      <section>
        <h2>Contact</h2>
        <p>
          Questions about these terms can be sent to
          <a href="mailto:sellerlabels@gmail.com"> sellerlabels@gmail.com</a>.
        </p>
      </section>
    </LegalPage>
  );
}
