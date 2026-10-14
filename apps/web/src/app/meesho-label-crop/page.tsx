import type { Metadata } from "next";
import { MarketplaceLanding } from "@/features/marketing/marketplace-landing";
import { absoluteUrl } from "@/lib/site";

const title = "Meesho Label Crop for Thermal Printing | SellerLabel";
const description =
  "Crop Meesho courier labels, remove unused whitespace, and prepare 100 x 150 mm or four-up A4 PDFs for printing.";

export const metadata: Metadata = {
  title,
  description,
  alternates: { canonical: absoluteUrl("/meesho-label-crop") },
  openGraph: { title, description, url: absoluteUrl("/meesho-label-crop") },
};

export default function MeeshoLabelCropPage() {
  return (
    <MarketplaceLanding
      content={{
        marketplace: "Meesho",
        eyebrow: "MEESHO LABEL CROP",
        title: "Turn Meesho PDFs into clean courier labels.",
        description:
          "Trim excess page space, keep the complete courier label and prepare the whole batch for thermal or A4 printing.",
        image: "/images/marketing/meesho-comparison.webp",
        imageAlt:
          "Meesho PDF before processing beside its cropped courier shipping label",
        benefits: [
          "Finds the meaningful courier-label content on the page.",
          "Trims unused whitespace without cutting package details.",
          "Prepares consistent pages for faster batch printing.",
        ],
        steps: [
          {
            title: "Add Meesho PDFs",
            description: "Select the order PDFs you need to print today.",
          },
          {
            title: "Check the labels",
            description:
              "SellerLabel trims the page and sends unusual layouts to review.",
          },
          {
            title: "Print your way",
            description:
              "Download individual-size labels or an A4 PDF with four labels per sheet.",
          },
        ],
        questions: [
          {
            question: "Does it remove extra white space?",
            answer:
              "Yes. SellerLabel detects the useful label bounds and removes unnecessary page space.",
          },
          {
            question: "Can I use normal A4 paper?",
            answer:
              "Yes. A4 four-up places four labels on each sheet with spacing for cutting.",
          },
          {
            question: "Are my customer addresses uploaded?",
            answer:
              "Original PDFs are processed in your browser and are not uploaded for detection or cropping.",
          },
        ],
      }}
    />
  );
}
