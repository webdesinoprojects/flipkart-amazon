import { absoluteUrl, SITE_DESCRIPTION, SITE_NAME } from "@/lib/site";

const content = `# ${SITE_NAME}: full product context

Canonical URL: ${absoluteUrl("/")}
Source: https://github.com/webdesinoprojects/flipkart-amazon

## Summary

${SITE_DESCRIPTION}

## What the application does

The application inspects every source PDF page, classifies the marketplace and page type, extracts shipment-label regions, normalizes approved labels to a 100 x 150 mm portrait PDF page, validates machine-readable evidence, and assembles ready labels into one combined PDF. Input PDF count is independent of output label count: one PDF may contain multiple source pages and shipments.

## Marketplace behavior

### Flipkart

The Flipkart adapter identifies the top E-Kart shipment label using marketplace anchors, geometry, content regions, and layout fingerprints. It excludes the lower tax invoice instead of relying on a fixed-percentage crop as the primary rule.

### Amazon

The Amazon adapter classifies pages and retains shipping-label pages while excluding supplier or seller-only invoice pages. It does not permanently assume a fixed page count.

### Meesho

The Meesho adapter detects meaningful content bounds, trims unnecessary bottom and outer whitespace, and preserves package-label content while maximizing useful physical print area.

## Output and validation

- Output filename: PRINT_READY_LABELS.pdf
- Page size: exactly 100 x 150 mm
- Orientation: portrait
- Page semantics: one shipment label per output page
- Quality: original PDF/native page content is retained where the source PDF permits it; raster rendering is used for preview, detection, CV, and validation rather than final print output.
- Validation evidence can include marketplace anchors, page type, geometry, expected text, crop boundaries, barcode/QR detection and decoding, clipping risk, and layout fingerprint.
- Uncertain labels are routed to manual review instead of silently approved.

## User controls

The review flow supports crop movement and resizing, rotation, re-detection, approval, skipping, and downloading an individual label. The final batch provides label counts, thumbnails or list view, preview, combined PDF download, and Print All through the browser/operating-system print dialog. For signed-in users, the generated combined PDF is automatically saved to private history, where it can be previewed in an in-app drawer or downloaded.

## Privacy and security model

Normal processing is local to the browser. Selected source shipping PDFs are not uploaded by the primary workflow. Only the generated combined output PDF and aggregate non-PII counts are automatically retained for signed-in history. PDFs are treated as untrusted input, with document, page, and size limits. Optional server fallback uses private temporary storage and cleanup controls; optional cloud AI providers remain disabled without credentials and are secondary to deterministic validation.

## Important limitations

- Marketplace layout changes can require new fingerprint versions or manual review.
- Barcode decoding depends on source quality, crop geometry, supported symbologies, and browser capabilities.
- Print settings remain controlled by the browser, operating system, and printer driver; the application does not perform unsafe silent USB printing.
- Search engines and LLM systems decide independently whether and when to crawl, index, cite, or display this application.
`;

export function GET(): Response {
  return new Response(content, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=3600",
    },
  });
}
