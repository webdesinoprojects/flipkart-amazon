import type { Metadata } from "next";
import { MarketplaceLanding } from "@/features/marketing/marketplace-landing";
import { absoluteUrl } from "@/lib/site";

const title = "Flipkart Label Crop for Thermal Printers | SellerLabel";
const description =
  "Crop Flipkart and E-Kart shipping labels, remove the tax invoice, and create sharp 100 x 150 mm or A4 print-ready PDFs.";

export const metadata: Metadata = {
  title,
  description,
  alternates: { canonical: absoluteUrl("/flipkart-label-crop") },
  openGraph: { title, description, url: absoluteUrl("/flipkart-label-crop") },
};

export default function FlipkartLabelCropPage() {
  return (
    <MarketplaceLanding
      content={{
        marketplace: "Flipkart",
        eyebrow: "FLIPKART / E-KART LABEL CROP",
        title: "Keep the Flipkart label. Remove the invoice.",
        description:
          "Turn mixed Flipkart seller PDFs into clean shipping labels for a 100 × 150 mm thermal printer or four-up A4 sheets.",
        image: "/images/marketing/flipkart-comparison.webp",
        imageAlt:
          "Flipkart PDF before processing beside the cropped E-Kart shipping label",
        benefits: [
          "Finds the E-Kart shipping label inside a full seller PDF.",
          "Removes the lower tax invoice from the print run.",
          "Keeps barcodes and QR codes sharp for scanning.",
        ],
        steps: [
          {
            title: "Add the PDF",
            description:
              "Drop one file or a mixed batch into your private workspace.",
          },
          {
            title: "Review the crop",
            description:
              "SellerLabel keeps the E-Kart label and flags uncertain pages for you.",
          },
          {
            title: "Print the batch",
            description:
              "Download 100 × 150 mm labels or place four labels on each A4 sheet.",
          },
        ],
        questions: [
          {
            question: "Does it remove the Flipkart tax invoice?",
            answer:
              "Yes. Confirmed Flipkart layouts keep the E-Kart shipping label and exclude the invoice area.",
          },
          {
            question: "Can one PDF contain several orders?",
            answer:
              "Yes. SellerLabel checks the page content instead of assuming one PDF equals one shipment.",
          },
          {
            question: "Can I check the result before downloading?",
            answer:
              "Yes. Preview the prepared PDF before you download or print the full batch.",
          },
        ],
      }}
    />
  );
}
