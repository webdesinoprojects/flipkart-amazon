import { A4_SHEET_CONFIG } from "@label-normalizer/config";
import { PDFDocument, rgb, type PDFPage } from "pdf-lib";
import { hasExactTargetLabelDimensions } from "./constants";
import {
  A4_ROW_GUTTER_PT,
  A4_SIZE_PT,
  A4_SLOTS_PER_SHEET,
  describeOutputLayout,
  outputPageCount,
  placeLabelInSlot,
  sheetSlotFor,
  type OutputLayout,
} from "./output-layout";
import { assembleNormalizedLabels } from "./pdf-native";
import type { CombinedPdfArtifact, NormalizedLabel } from "./types";

const CUT_GUIDE_COLOUR = rgb(0.8, 0.8, 0.8);

/**
 * Impose already-normalized labels onto physical pages for `layout`.
 *
 * This runs *after* crop, review, normalization, validation, duplicate
 * handling, and source-order sorting. Changing layout re-imposes the same
 * canonical labels; it never re-runs marketplace detection or cropping.
 */
export async function assembleLabelsForLayout(
  labels: readonly NormalizedLabel[],
  layout: OutputLayout,
): Promise<CombinedPdfArtifact> {
  return layout === "a4_4up"
    ? assembleFourUpSheets(labels)
    : assembleNormalizedLabels(labels);
}

/**
 * Build one ISO A4 portrait PDF holding up to four labels per sheet.
 *
 * Each normalized label page is embedded with `pdf-lib`, so text, vectors, and
 * barcodes stay PDF-native. Nothing is rasterized and no UI preview is used.
 */
export async function assembleFourUpSheets(
  labels: readonly NormalizedLabel[],
): Promise<CombinedPdfArtifact> {
  if (labels.length === 0) {
    throw new Error("At least one normalized label is required for assembly.");
  }

  const descriptor = describeOutputLayout("a4_4up");
  const output = await PDFDocument.create();
  output.setTitle("PRINT_READY_LABELS_A4");
  output.setProducer("SellerLabel");

  // Source order is the contract: upload order, then source page, then region.
  // Marketplace identity has no influence on slot geometry or ordering.
  const ordered = [...labels].sort(
    (left, right) => left.outputOrder - right.outputOrder,
  );
  const sheetCount = outputPageCount(ordered.length, "a4_4up");
  const sheets: PDFPage[] = [];
  for (let index = 0; index < sheetCount; index += 1) {
    const sheet = output.addPage([A4_SIZE_PT.width, A4_SIZE_PT.height]);
    // Drawn before any label so the guides can never sit on top of a barcode.
    drawCutGuides(sheet);
    sheets.push(sheet);
  }

  for (const [index, label] of ordered.entries()) {
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
    const slot = sheetSlotFor(index);
    const sheet = sheets[slot.pageIndex];
    if (!sheet) throw new Error(`Sheet ${slot.pageIndex} is unavailable.`);
    const embedded = await output.embedPage(sourcePage);
    const placement = placeLabelInSlot(
      slot,
      sourcePage.getWidth(),
      sourcePage.getHeight(),
    );
    sheet.drawPage(embedded, {
      x: placement.x,
      y: placement.y,
      width: placement.width,
      height: placement.height,
    });
  }

  return {
    filename: descriptor.filename,
    pdfBytes: await output.save(),
    pageCount: sheetCount,
    labelCount: ordered.length,
    layout: "a4_4up",
    widthPt: A4_SIZE_PT.width,
    heightPt: A4_SIZE_PT.height,
  };
}

/** Subtle hairlines at slot boundaries, centred inside any cutting gutter. */
function drawCutGuides(sheet: PDFPage): void {
  const { columns, rows, cutGuideWidthPt } = A4_SHEET_CONFIG;
  const slotWidth = A4_SIZE_PT.width / columns;
  const slotHeight =
    (A4_SIZE_PT.height - A4_ROW_GUTTER_PT * Math.max(0, rows - 1)) / rows;
  for (let column = 1; column < columns; column += 1) {
    sheet.drawLine({
      start: { x: column * slotWidth, y: 0 },
      end: { x: column * slotWidth, y: A4_SIZE_PT.height },
      thickness: cutGuideWidthPt,
      color: CUT_GUIDE_COLOUR,
    });
  }
  for (let row = 1; row < rows; row += 1) {
    const y =
      A4_SIZE_PT.height - row * slotHeight - (row - 0.5) * A4_ROW_GUTTER_PT;
    sheet.drawLine({
      start: { x: 0, y },
      end: { x: A4_SIZE_PT.width, y },
      thickness: cutGuideWidthPt,
      color: CUT_GUIDE_COLOUR,
    });
  }
}

export { A4_SLOTS_PER_SHEET };
