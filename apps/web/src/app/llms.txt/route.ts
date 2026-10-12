import { absoluteUrl, SITE_DESCRIPTION, SITE_NAME } from "@/lib/site";

const content = `# ${SITE_NAME}

> ${SITE_DESCRIPTION}

${SITE_NAME} is a local-first web application for ecommerce sellers who need to prepare marketplace shipping labels for thermal printing. The deterministic browser workflow is primary: selected PDF files remain on the user's device during normal processing.

## Primary links

- [Application](${absoluteUrl("/")}): Upload and normalize marketplace shipping PDFs.
- [Sitemap](${absoluteUrl("/sitemap.xml")}): Canonical indexable URLs.
- [Full product context](${absoluteUrl("/llms-full.txt")}): Detailed capabilities, workflow, and limitations.
- [Source repository](https://github.com/webdesinoprojects/flipkart-amazon): Open-source project code and documentation.

## Supported workflows

- Flipkart E-Kart shipping-label extraction with invoice exclusion.
- Amazon shipping-label page retention with seller-only invoice exclusion.
- Meesho meaningful-content detection and excess-whitespace trimming.
- Mixed Flipkart, Amazon, and Meesho batches.
- PDF-native normalization to one 100 x 150 mm portrait shipment label per output page.
- Barcode and QR evidence checks, confidence scoring, and manual crop review.
- Combined PRINT_READY_LABELS.pdf preview, download, and browser print flow.

## Privacy

Normal PDF processing happens locally in the browser. Original marketplace PDFs are not uploaded by the standard workflow. For signed-in users, only the generated combined output PDF and aggregate non-PII counts are saved automatically to private history. Optional server and AI fallback architecture is separate and should only be used when deterministic processing is uncertain and explicitly enabled.
`;

export function GET(): Response {
  return new Response(content, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=3600",
    },
  });
}
