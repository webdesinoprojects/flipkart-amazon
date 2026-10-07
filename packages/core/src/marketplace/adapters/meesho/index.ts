import type {
  DetectionResult,
  Evidence,
  PageClassification,
  PdfDocumentAnalysis,
  PdfPageAnalysis,
  PdfRect,
  RegionDetection,
} from "../../../types";
import type {
  DocumentContext,
  MarketplaceAdapter,
  NormalizationContext,
  PageContext,
  ValidationContext,
} from "../../../adapter";
import { normalizePdfRegionNative } from "../../../pdf-native";
import {
  MARKETPLACE_VALIDATION_POLICIES,
  validateWithEvidence,
} from "../../../confidence";
import { clampRect, pageContains } from "../../shared";

export const MEESHO_LAYOUT_V1 = "meesho/a4-sub-order-label-invoice/v1";
export const MEESHO_EXCHANGE_LAYOUT_V1 = "meesho/a4-exchange-label/v1";

const STRUCTURAL_ANCHORS = [
  "customer address",
  "if undelivered, return to",
  "product details",
  "tax invoice",
  "original for recipient",
] as const;

const EXCHANGE_ANCHORS = [
  "exchange",
  "customer address",
  "if undelivered, return to",
  "product details",
] as const;

const CARRIER_ANCHORS = [
  "shadowfax",
  "valmo",
  "valmo plus",
  "delhivery",
  "xpressbees",
  "xpress bees",
] as const;

export class MeeshoAdapter implements MarketplaceAdapter<
  PdfDocumentAnalysis,
  PdfPageAnalysis
> {
  readonly id = "meesho";
  readonly version = "1.0.0";

  async detectDocument(
    context: DocumentContext<PdfDocumentAnalysis>,
  ): Promise<DetectionResult> {
    const matchedPages = context.document.pages.filter(
      (page) => anchorCount(page) >= 4 || isExchangeLabelPage(page),
    );
    if (matchedPages.length === 0)
      return unknownDetection(this.id, this.version);

    const pageFingerprints = matchedPages.map(detectPageFingerprint);
    const fingerprintMatched = pageFingerprints.every(Boolean);
    const uniqueFingerprints = new Set(pageFingerprints.filter(Boolean));
    const documentFingerprint =
      uniqueFingerprints.size === 1
        ? pageFingerprints.find((fingerprint): fingerprint is string =>
            Boolean(fingerprint),
          )
        : undefined;
    const evidence: Evidence[] = [
      {
        code: "meesho.structure.sub_order_label",
        message:
          "Found the customer, returns, product, and recipient-invoice sections used by the Sub Order label export.",
        source: "text_anchor",
        weight: 0.7,
      },
    ];
    if (fingerprintMatched) {
      evidence.push({
        code: "meesho.layout.v1",
        message: "Matched the versioned Meesho Sub Order layout family.",
        source: "layout_fingerprint",
        weight: 0.25,
      });
    }
    if (matchedPages.some(isExchangeLabelPage)) {
      evidence.push({
        code: "meesho.structure.exchange_label",
        message:
          "Found the exchange, customer, returns, and product sections used by Meesho exchange labels.",
        source: "text_anchor",
        weight: 0.15,
      });
    }
    if (matchedPages.some(hasKnownCarrierAnchor)) {
      evidence.push({
        code: "meesho.carrier.variant",
        message: "Found a confirmed carrier variant within the layout family.",
        source: "text_anchor",
        weight: 0.05,
      });
    }

    return {
      marketplace: "meesho",
      confidence: fingerprintMatched ? 1 : 0.72,
      evidence,
      adapterId: this.id,
      adapterVersion: this.version,
      ...(documentFingerprint
        ? { layoutFingerprint: documentFingerprint }
        : {}),
    };
  }

  async classifyPage(
    context: PageContext<PdfDocumentAnalysis, PdfPageAnalysis>,
  ): Promise<PageClassification> {
    const matchedAnchors = anchorCount(context.page);
    const layoutFingerprint = detectPageFingerprint(context.page);
    if (matchedAnchors >= 4) {
      return {
        marketplace: "meesho",
        pageKind: "shipping_plus_invoice",
        confidence: layoutFingerprint ? 1 : 0.72,
        evidence: [
          {
            code: "meesho.page.package_label",
            message:
              "The shipping, product, and recipient invoice sections form one package label.",
            source: "text_anchor",
            weight: 0.72,
          },
          ...(layoutFingerprint
            ? [
                {
                  code: "meesho.layout.v1",
                  message:
                    "Stable section geometry matches the confirmed layout.",
                  source: "layout_fingerprint" as const,
                  weight: 0.28,
                },
              ]
            : []),
        ],
        ...(layoutFingerprint ? { layoutFingerprint } : {}),
      };
    }

    if (isExchangeLabelPage(context.page)) {
      return {
        marketplace: "meesho",
        pageKind: "shipping_label",
        confidence: layoutFingerprint === MEESHO_EXCHANGE_LAYOUT_V1 ? 0.9 : 0.7,
        evidence: [
          {
            code: "meesho.page.exchange_label",
            message:
              "The exchange, customer, returns, and product sections identify a Meesho exchange shipping label.",
            source: "text_anchor",
            weight: 0.7,
          },
          ...(layoutFingerprint === MEESHO_EXCHANGE_LAYOUT_V1
            ? [
                {
                  code: "meesho.layout.exchange.v1",
                  message:
                    "Section geometry matches the versioned Meesho exchange-label layout.",
                  source: "layout_fingerprint" as const,
                  weight: 0.2,
                },
              ]
            : []),
          ...(hasKnownCarrierAnchor(context.page)
            ? [
                {
                  code: "meesho.carrier.exchange_variant",
                  message:
                    "A known carrier name supports the exchange-label classification but is not used alone.",
                  source: "text_anchor" as const,
                  weight: 0.05,
                },
              ]
            : []),
        ],
        ...(layoutFingerprint ? { layoutFingerprint } : {}),
      };
    }

    return {
      marketplace: "meesho",
      pageKind: "unknown",
      confidence: 0.25,
      evidence: [
        {
          code: "meesho.page.unrecognized",
          message: "The page lacks the confirmed package-label section set.",
          source: "layout_fingerprint",
          weight: 0.25,
        },
      ],
    };
  }

  async findPrintableRegions(
    context: PageContext<PdfDocumentAnalysis, PdfPageAnalysis>,
  ): Promise<readonly RegionDetection[]> {
    const classification = await this.classifyPage(context);
    if (
      classification.pageKind !== "shipping_plus_invoice" &&
      classification.pageKind !== "shipping_label"
    )
      return [];

    const measured = context.page.rasterContentBoundsPt;
    const bounds = measured
      ? clampRect(expandRect(measured, 5), context.geometry.mediaBox)
      : context.geometry.mediaBox;
    const fingerprintMatched = Boolean(classification.layoutFingerprint);
    const exchangeVariant = classification.pageKind === "shipping_label";
    return [
      {
        id: `${context.pageId}:region:0`,
        documentId: context.documentContext.documentId,
        pageId: context.pageId,
        regionIndex: 0,
        boundsPt: bounds,
        confidence:
          measured && fingerprintMatched
            ? exchangeVariant
              ? 0.9
              : 0.97
            : 0.55,
        evidence: [
          {
            code: measured
              ? "meesho.crop.meaningful_content"
              : "meesho.crop.full_page_fallback",
            message: measured
              ? "Measured all meaningful package content and removed only outer whitespace."
              : "Visual content bounds were unavailable; retained the full page for review.",
            source: measured ? "computer_vision" : "geometry",
            weight: measured ? 0.77 : 0.35,
          },
          ...(fingerprintMatched
            ? [
                {
                  code: "meesho.layout.v1",
                  message:
                    "Crop is supported by the confirmed layout fingerprint.",
                  source: "layout_fingerprint" as const,
                  weight: 0.2,
                },
              ]
            : []),
        ],
        ...(classification.layoutFingerprint
          ? { layoutFingerprint: classification.layoutFingerprint }
          : {}),
        // Exchange-only labels are retained, but require an explicit first-pass
        // approval while this newer layout family has limited golden coverage.
        requiresReview: exchangeVariant || !measured || !fingerprintMatched,
      },
    ];
  }

  normalizeRegion(
    context: NormalizationContext<PdfDocumentAnalysis, PdfPageAnalysis>,
  ) {
    return normalizePdfRegionNative(context, {
      marketplace: "meesho",
      adapterId: this.id,
      adapterVersion: this.version,
    });
  }

  async validate(context: ValidationContext) {
    return validateWithEvidence(
      context,
      MARKETPLACE_VALIDATION_POLICIES.meesho,
    );
  }
}

function anchorCount(page: PdfPageAnalysis): number {
  return STRUCTURAL_ANCHORS.filter((anchor) => pageContains(page, anchor))
    .length;
}

function detectPageFingerprint(page: PdfPageAnalysis): string | undefined {
  const items = new Map(
    STRUCTURAL_ANCHORS.map((anchor) => [
      anchor,
      page.textItems.find((item) =>
        item.text.toLowerCase().replaceAll(/\s+/g, " ").includes(anchor),
      )?.boundsPt,
    ]),
  );
  const customer = items.get("customer address");
  const product = items.get("product details");
  const invoice = items.get("tax invoice");
  const recipient = items.get("original for recipient");
  const standardMatches =
    near(page.geometry.widthPt, 595, 3) &&
    near(page.geometry.heightPt, 842, 3) &&
    page.geometry.rotation === 0 &&
    customer &&
    product &&
    invoice &&
    recipient &&
    near(customer.x, 19, 3) &&
    near(customer.y, 812.44, 3) &&
    near(product.x, 20, 3) &&
    near(product.y, 537, 5) &&
    near(invoice.x, 265.55, 3) &&
    near(invoice.y, 483, 5) &&
    near(recipient.x, 495.42, 3) &&
    near(recipient.y, 483, 5);
  if (standardMatches) return MEESHO_LAYOUT_V1;

  const exchange = findAnchorBounds(page, "exchange");
  const destination = findAnchorBounds(page, "destination code");
  const exchangeMatches =
    near(page.geometry.widthPt, 595, 3) &&
    near(page.geometry.heightPt, 842, 3) &&
    page.geometry.rotation === 0 &&
    customer &&
    product &&
    exchange &&
    destination &&
    near(customer.x, 19, 3) &&
    near(customer.y, 812.44, 3) &&
    near(product.x, 20, 3) &&
    near(product.y, 548.16, 8) &&
    near(exchange.x, 261.24, 5) &&
    near(exchange.y, 811.22, 5) &&
    near(destination.x, 265.24, 5) &&
    near(destination.y, 732.76, 8);
  return exchangeMatches ? MEESHO_EXCHANGE_LAYOUT_V1 : undefined;
}

function isExchangeLabelPage(page: PdfPageAnalysis): boolean {
  return EXCHANGE_ANCHORS.every((anchor) => pageContains(page, anchor));
}

function hasKnownCarrierAnchor(page: PdfPageAnalysis): boolean {
  return CARRIER_ANCHORS.some((anchor) => pageContains(page, anchor));
}

function findAnchorBounds(
  page: PdfPageAnalysis,
  anchor: string,
): PdfRect | undefined {
  return page.textItems.find((item) =>
    item.text.toLowerCase().replaceAll(/\s+/g, " ").includes(anchor),
  )?.boundsPt;
}

function expandRect(rect: PdfRect, margin: number): PdfRect {
  return {
    x: rect.x - margin,
    y: rect.y - margin,
    width: rect.width + margin * 2,
    height: rect.height + margin * 2,
  };
}

function unknownDetection(
  adapterId: string,
  adapterVersion: string,
): DetectionResult {
  return {
    marketplace: "unknown",
    confidence: 0,
    evidence: [],
    adapterId,
    adapterVersion,
  };
}

function near(value: number, expected: number, tolerance: number): boolean {
  return Math.abs(value - expected) <= tolerance;
}
