import type { Metadata } from "next";
import { MarketplaceLanding } from "@/features/marketing/marketplace-landing";
import { absoluteUrl } from "@/lib/site";

const title = "Amazon Shipping Label Without Invoice | SellerLabel";
const description =
  "Separate Amazon shipping labels from supplier invoices and create print-ready 100 x 150 mm or A4 label PDFs.";

export const metadata: Metadata = {
  title,
  description,
  alternates: { canonical: absoluteUrl("/amazon-label-without-invoice") },
  openGraph: {
    title,
    description,
    url: absoluteUrl("/amazon-label-without-invoice"),
  },
};

export default function AmazonLabelWithoutInvoicePage() {
  return (
    <MarketplaceLanding
      content={{
        marketplace: "Amazon",
        eyebrow: "AMAZON LABEL / NO INVOICE PAGE",
        title: "Print the Amazon package label, not the invoice.",
        description:
          "Separate shipping-label pages from supplier invoice pages and prepare one clean PDF for your dispatch desk.",
        image: "/images/marketing/amazon-comparison.webp",
        imageAlt:
          "Amazon seller PDF before processing beside its extracted package label",
        benefits: [
          "Recognises package-label pages in Amazon seller PDFs.",
          "Leaves supplier and tax invoice pages out of the print batch.",
          "Combines the labels you need into one downloadable PDF.",
        ],
        steps: [
          {
            title: "Add Amazon PDFs",
            description:
              "Upload the seller documents you want to prepare in one batch.",
          },
          {
            title: "Check each page",
            description:
              "Package labels are kept while invoice-only pages are excluded.",
          },
          {
            title: "Choose a layout",
            description:
              "Use thermal-printer pages or A4 four-up, then preview before printing.",
          },
        ],
        questions: [
          {
            question: "Will the Amazon invoice be printed?",
            answer:
              "Invoice-only pages are excluded when the layout is recognised. Review is available before download.",
          },
          {
            question: "What if Amazon changes a layout?",
            answer:
              "Uncertain pages are flagged instead of being silently approved, so you can correct the crop.",
          },
          {
            question: "Can I combine many labels?",
            answer:
              "Yes. Confirmed labels are assembled into one print-ready output PDF.",
          },
        ],
      }}
    />
  );
}
