import { absoluteUrl, SITE_DESCRIPTION, SITE_NAME } from "@/lib/site";

const content = `# ${SITE_NAME}

> ${SITE_DESCRIPTION}

${SITE_NAME} helps ecommerce sellers crop marketplace shipping labels for thermal and A4 printing. Selected source PDF files remain on the user's device during normal processing.

## Primary links

- [Application](${absoluteUrl("/")}): Crop marketplace shipping PDFs.
- [Flipkart label crop](${absoluteUrl("/flipkart-label-crop")}): Keep the E-Kart label and remove the invoice.
- [Amazon label without invoice](${absoluteUrl("/amazon-label-without-invoice")}): Separate package labels from invoice pages.
- [Meesho label crop](${absoluteUrl("/meesho-label-crop")}): Trim excess space around courier labels.
- [Sitemap](${absoluteUrl("/sitemap.xml")}): Canonical indexable URLs.
- [Full product context](${absoluteUrl("/llms-full.txt")}): Detailed capabilities, workflow, and limitations.

## Supported workflows

- Flipkart E-Kart shipping-label extraction with invoice exclusion.
- Amazon shipping-label page retention with seller-only invoice exclusion.
- Meesho meaningful-content detection and excess-whitespace trimming.
- Mixed Flipkart, Amazon, and Meesho batches.
- Sharp 100 x 150 mm label output and A4 four-up printing.
- Barcode and QR evidence checks, confidence scoring, and manual crop review.
- Combined PRINT_READY_LABELS.pdf preview, download, and browser print flow.

## Privacy

Normal PDF processing happens locally in the browser. Original marketplace PDFs are not uploaded by the standard workflow. For signed-in users, only the generated combined output PDF and aggregate non-PII counts are saved automatically to private history.
`;

export function GET(): Response {
  return new Response(content, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=3600",
    },
  });
}
