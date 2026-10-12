import { degrees, PDFDocument } from "pdf-lib";
import type { NormalizationContext } from "./adapter";
import {
  hasExactTargetLabelDimensions,
  TARGET_LABEL_SIZE_PT,
} from "./constants";
import { describeOutputLayout } from "./output-layout";
import type {
  CombinedPdfArtifact,
  Marketplace,
  NormalizedLabel,
  PdfDocumentAnalysis,
  PdfPageAnalysis,
  PdfRect,
} from "./types";
import { clampRect } from "./marketplace/shared";

export interface NativeNormalizationIdentity {
  readonly marketplace: Marketplace;
  readonly adapterId: string;
  readonly adapterVersion: string;
}

export interface NativePlacement {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly scale: number;
}

export function calculateNativePlacement(
  sourceBounds: Pick<PdfRect, "width" | "height">,
  targetWidth = TARGET_LABEL_SIZE_PT.width,
  targetHeight = TARGET_LABEL_SIZE_PT.height,
): NativePlacement {
  if (
    sourceBounds.width <= 0 ||
    sourceBounds.height <= 0 ||
    targetWidth <= 0 ||
    targetHeight <= 0
  ) {
    throw new Error("Native placement dimensions must be positive.");
  }
  const scale = Math.min(
    targetWidth / sourceBounds.width,
    targetHeight / sourceBounds.height,
  );
  const width = sourceBounds.width * scale;
  const height = sourceBounds.height * scale;
  return {
    x: Math.max(0, (targetWidth - width) / 2),
    y: Math.max(0, (targetHeight - height) / 2),
    width,
    height,
    scale,
  };
}

/** Embeds the original source page region directly; no screenshot is created. */
export async function normalizePdfRegionNative(
  context: NormalizationContext<PdfDocumentAnalysis, PdfPageAnalysis>,
  identity: NativeNormalizationIdentity,
): Promise<NormalizedLabel> {
  if (
    context.pageContext.geometry.rotation !== 0 &&
    context.region.rotation === undefined
  ) {
    throw new Error(
      "Rotated source pages require review before normalization.",
    );
  }

  const sourceDocument = await PDFDocument.load(context.sourcePdfBytes, {
    updateMetadata: false,
  });
  const sourcePage = sourceDocument.getPage(context.pageContext.pageNumber - 1);
  if (!sourcePage) throw new Error("The source page is unavailable.");
  const mediaBox = sourcePage.getMediaBox();
  const sourceBounds = clampRect(context.region.boundsPt, mediaBox);
  if (sourceBounds.width < 1 || sourceBounds.height < 1) {
    throw new Error("The detected source crop is empty.");
  }

  const outputDocument = await PDFDocument.create();
  outputDocument.setProducer("Marketplace Shipping Label Normalizer");
  const outputPage = outputDocument.addPage([
    TARGET_LABEL_SIZE_PT.width,
    TARGET_LABEL_SIZE_PT.height,
  ]);
  const embedded = await outputDocument.embedPage(sourcePage, {
    left: sourceBounds.x,
    bottom: sourceBounds.y,
    right: sourceBounds.x + sourceBounds.width,
    top: sourceBounds.y + sourceBounds.height,
  });
  const rotation = context.region.rotation ?? 0;
  const placement = calculateNativePlacement(
    rotation === 90 || rotation === 270
      ? { width: sourceBounds.height, height: sourceBounds.width }
      : sourceBounds,
  );
  const sourceWidth = sourceBounds.width * placement.scale;
  const sourceHeight = sourceBounds.height * placement.scale;
  const origin = rotatedDrawOrigin(
    placement.x,
    placement.y,
    placement.width,
    placement.height,
    rotation,
  );
  outputPage.drawPage(embedded, {
    x: origin.x,
    y: origin.y,
    width: sourceWidth,
    height: sourceHeight,
    rotate: degrees(rotation),
  });
  const pdfBytes = await outputDocument.save();

  return {
    id: `${context.region.id}:label`,
    batchId: context.pageContext.documentContext.batchId,
    documentId: context.pageContext.documentContext.documentId,
    pageId: context.pageContext.pageId,
    regionId: context.region.id,
    sourcePageNumber: context.pageContext.pageNumber,
    outputOrder: context.outputOrder,
    marketplace: identity.marketplace,
    widthPt: TARGET_LABEL_SIZE_PT.width,
    heightPt: TARGET_LABEL_SIZE_PT.height,
    sourceBoundsPt: sourceBounds,
    pdfBytes,
    adapterId: identity.adapterId,
    adapterVersion: identity.adapterVersion,
    ...(context.region.layoutFingerprint
      ? { layoutFingerprint: context.region.layoutFingerprint }
      : {}),
    rotationApplied: rotation,
  };
}

function rotatedDrawOrigin(
  x: number,
  y: number,
  visualWidth: number,
  visualHeight: number,
  rotation: 0 | 90 | 180 | 270,
): { readonly x: number; readonly y: number } {
  switch (rotation) {
    case 90:
      return { x: x + visualWidth, y };
    case 180:
      return { x: x + visualWidth, y: y + visualHeight };
    case 270:
      return { x, y: y + visualHeight };
    default:
      return { x, y };
  }
}

export async function assembleNormalizedLabels(
  labels: readonly NormalizedLabel[],
): Promise<CombinedPdfArtifact> {
  if (labels.length === 0) {
    throw new Error("At least one normalized label is required for assembly.");
  }

  const output = await PDFDocument.create();
  output.setTitle("PRINT_READY_LABELS");
  output.setProducer("Marketplace Shipping Label Normalizer");
  const ordered = [...labels].sort(
    (left, right) => left.outputOrder - right.outputOrder,
  );

  for (const label of ordered) {
    const source = await PDFDocument.load(label.pdfBytes, {
      updateMetadata: false,
    });
    const sourcePage = source.getPage(0);
    if (
      !sourcePage ||
      !hasExactTargetLabelDimensions(
        sourcePage.getWidth(),
        sourcePage.getHeight(),
      )
    ) {
      throw new Error(
        `Label ${label.id} does not have exact target dimensions.`,
      );
    }
    const [copied] = await output.copyPages(source, [0]);
    if (!copied) throw new Error(`Label ${label.id} could not be copied.`);
    output.addPage(copied);
  }

  return {
    filename: describeOutputLayout("label_100x150").filename,
    pdfBytes: await output.save(),
    // One label per page, so the physical page count and the label count are
    // the same number here. They are still reported separately because the A4
    // layout breaks that equality.
    pageCount: ordered.length,
    labelCount: ordered.length,
    layout: "label_100x150",
    widthPt: TARGET_LABEL_SIZE_PT.width,
    heightPt: TARGET_LABEL_SIZE_PT.height,
  };
}
