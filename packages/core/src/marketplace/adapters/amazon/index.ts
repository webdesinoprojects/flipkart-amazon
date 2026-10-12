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

export const AMAZON_LAYOUT_V1 =
  "amazon/a4-raster-label-with-supplier-invoice/v1";

export class AmazonAdapter implements MarketplaceAdapter<
  PdfDocumentAnalysis,
  PdfPageAnalysis
> {
  readonly id = "amazon";
  readonly version = "1.0.0";

  async detectDocument(
    context: DocumentContext<PdfDocumentAnalysis>,
  ): Promise<DetectionResult> {
    const supplierInvoices = context.document.pages.filter(isSupplierInvoice);
    const rasterLabelCandidates = context.document.pages.filter(
      (page) => isRasterLabelCandidate(page) && !isSupplierInvoice(page),
    );
    const hasAmazonAnchor = context.document.pages.some((page) =>
      pageContains(page, "amazon.in"),
    );
    const layoutFingerprint = detectDocumentFingerprint(context.document);

    if (
      supplierInvoices.length === 0 ||
      (!hasAmazonAnchor && !layoutFingerprint)
    ) {
      return unknownDetection(this.id, this.version);
    }

    const evidence: Evidence[] = [
      {
        code: "amazon.anchor.supplier_copy",
        message: "Found Amazon supplier-only invoice anchors.",
        source: "text_anchor",
        weight: 0.45,
      },
    ];
    if (hasAmazonAnchor) {
      evidence.push({
        code: "amazon.anchor.amazon_in",
        message: "Found the amazon.in document anchor.",
        source: "text_anchor",
        weight: 0.2,
      });
    }
    if (rasterLabelCandidates.length > 0) {
      evidence.push({
        code: "amazon.structure.raster_label_page",
        message:
          "Found a nonblank image-native page distinct from supplier invoice pages.",
        source: "pdf_structure",
        weight: 0.25,
      });
    }

    if (layoutFingerprint) {
      evidence.push({
        code: "amazon.layout.v1",
        message: "Matched the versioned Amazon raster-label layout family.",
        source: "layout_fingerprint",
        weight: 0.1,
      });
    }

    return {
      marketplace: "amazon",
      confidence: layoutFingerprint ? 1 : 0.65,
      evidence,
      adapterId: this.id,
      adapterVersion: this.version,
      ...(layoutFingerprint ? { layoutFingerprint } : {}),
    };
  }

  async classifyPage(
    context: PageContext<PdfDocumentAnalysis, PdfPageAnalysis>,
  ): Promise<PageClassification> {
    const { page } = context;
    const layoutFingerprint = detectDocumentFingerprint(
      context.documentContext.document,
    );

    if (isSupplierInvoice(page)) {
      return {
        marketplace: "amazon",
        pageKind: "seller_invoice",
        confidence: 1,
        evidence: [
          {
            code: "amazon.page.supplier_invoice",
            message:
              "Tax Invoice/Bill of Supply/Cash Memo is marked as the supplier triplicate.",
            source: "text_anchor",
            weight: 1,
          },
        ],
        ...(layoutFingerprint ? { layoutFingerprint } : {}),
      };
    }

    if (isRasterLabelCandidate(page) && layoutFingerprint) {
      return {
        marketplace: "amazon",
        pageKind: "shipping_label",
        confidence: 0.96,
        evidence: [
          {
            code: "amazon.page.image_native_label",
            message:
              "Classified a nonblank image-native page using the surrounding Amazon document signature.",
            source: "pdf_structure",
            weight: 0.56,
          },
          {
            code: "amazon.page.visual_content",
            message: "Meaningful visual content was measured on the page.",
            source: "computer_vision",
            weight: 0.25,
          },
          {
            code: "amazon.layout.v1",
            message: "The page belongs to a known Amazon layout family.",
            source: "layout_fingerprint",
            weight: 0.15,
          },
        ],
        layoutFingerprint,
      };
    }

    if ((page.rasterInkRatio ?? 0) < 0.0005 && page.textItems.length === 0) {
      return {
        marketplace: "amazon",
        pageKind: "blank",
        confidence: 0.95,
        evidence: [
          {
            code: "page.blank.visual",
            message: "No meaningful text or visual ink was measured.",
            source: "computer_vision",
            weight: 0.95,
          },
        ],
      };
    }

    return {
      marketplace: "amazon",
      pageKind: "unknown",
      confidence: 0.35,
      evidence: [
        {
          code: "amazon.page.unrecognized",
          message: "The Amazon document matched, but this page layout did not.",
          source: "layout_fingerprint",
          weight: 0.35,
        },
      ],
    };
  }

  async findPrintableRegions(
    context: PageContext<PdfDocumentAnalysis, PdfPageAnalysis>,
  ): Promise<readonly RegionDetection[]> {
    const classification = await this.classifyPage(context);
    if (classification.pageKind !== "shipping_label") return [];

    const measured = context.page.rasterContentBoundsPt;
    const bounds = measured
      ? clampRect(expandRect(measured, 5), context.geometry.mediaBox)
      : context.geometry.mediaBox;
    const fingerprintMatched = Boolean(classification.layoutFingerprint);
    return [
      {
        id: `${context.pageId}:region:0`,
        documentId: context.documentContext.documentId,
        pageId: context.pageId,
        regionIndex: 0,
        boundsPt: bounds,
        confidence: measured && fingerprintMatched ? 0.96 : 0.55,
        evidence: [
          {
            code: measured
              ? "amazon.crop.visual_bounds"
              : "amazon.crop.full_page_fallback",
            message: measured
              ? "Trimmed only measured outer whitespace with a safety margin."
              : "Visual bounds were unavailable; retained the full page for review.",
            source: measured ? "computer_vision" : "geometry",
            weight: measured ? 0.76 : 0.35,
          },
          ...(fingerprintMatched
            ? [
                {
                  code: "amazon.layout.v1",
                  message: "Crop is supported by the known layout fingerprint.",
                  source: "layout_fingerprint" as const,
                  weight: 0.2,
                },
              ]
            : []),
        ],
        ...(classification.layoutFingerprint
          ? { layoutFingerprint: classification.layoutFingerprint }
          : {}),
        requiresReview: !measured || !fingerprintMatched,
      },
    ];
  }

  normalizeRegion(
    context: NormalizationContext<PdfDocumentAnalysis, PdfPageAnalysis>,
  ) {
    return normalizePdfRegionNative(context, {
      marketplace: "amazon",
      adapterId: this.id,
      adapterVersion: this.version,
    });
  }

  async validate(context: ValidationContext) {
    return validateWithEvidence(
      context,
      MARKETPLACE_VALIDATION_POLICIES.amazon,
    );
  }
}

function isSupplierInvoice(page: PdfPageAnalysis): boolean {
  return (
    pageContains(page, "triplicate for supplier") &&
    (pageContains(page, "tax invoice") ||
      pageContains(page, "bill of supply") ||
      pageContains(page, "cash memo"))
  );
}

function isRasterLabelCandidate(page: PdfPageAnalysis): boolean {
  return (
    page.textItems.every((item) => item.text.trim().length === 0) &&
    Boolean(page.rasterContentBoundsPt) &&
    (page.rasterInkRatio ?? 0) >= 0.01
  );
}

function detectDocumentFingerprint(
  document: PdfDocumentAnalysis,
): string | undefined {
  const hasInvoice = document.pages.some(isSupplierInvoice);
  const hasRasterLabel = document.pages.some(isRasterLabelCandidate);
  const supportedGeometry = document.pages
    .filter((page) => isSupplierInvoice(page) || isRasterLabelCandidate(page))
    .every(
      (page) =>
        near(page.geometry.widthPt, 595, 3) &&
        near(page.geometry.heightPt, 842, 3) &&
        page.geometry.rotation === 0,
    );
  return hasInvoice && hasRasterLabel && supportedGeometry
    ? AMAZON_LAYOUT_V1
    : undefined;
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
