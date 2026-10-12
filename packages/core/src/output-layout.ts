import { A4_SHEET_CONFIG } from "@label-normalizer/config";
import { millimetresToPoints, TARGET_LABEL_SIZE_PT } from "./constants";

/**
 * How approved labels are imposed onto physical pages at final assembly.
 *
 * This is the only representation of that choice. Nothing compares layout
 * strings inline, so adding a third layout later means extending this module
 * rather than hunting for scattered comparisons.
 */
export type OutputLayout = "label_100x150" | "a4_4up";

export const OUTPUT_LAYOUTS: readonly OutputLayout[] = Object.freeze([
  "label_100x150",
  "a4_4up",
]);

/** Thermal label printers are the primary workflow, so they stay the default. */
export const DEFAULT_OUTPUT_LAYOUT: OutputLayout = "label_100x150";

export const A4_SIZE_PT = Object.freeze({
  width: millimetresToPoints(A4_SHEET_CONFIG.widthMm),
  height: millimetresToPoints(A4_SHEET_CONFIG.heightMm),
});

export const A4_ROW_GUTTER_PT = millimetresToPoints(
  A4_SHEET_CONFIG.rowGutterMm,
);

export const A4_SLOTS_PER_SHEET =
  A4_SHEET_CONFIG.columns * A4_SHEET_CONFIG.rows;

export interface OutputLayoutDescriptor {
  readonly id: OutputLayout;
  /** Short control label, e.g. `100 × 150 MM`. */
  readonly shortLabel: string;
  /** One line describing the physical result and intended printer. */
  readonly description: string;
  /** Singular noun for one physical page produced by this layout. */
  readonly pageNoun: string;
  /** Plural noun for several physical pages produced by this layout. */
  readonly pageNounPlural: string;
  readonly filename: string;
  readonly widthPt: number;
  readonly heightPt: number;
  readonly labelsPerPage: number;
}

const DESCRIPTORS: Readonly<Record<OutputLayout, OutputLayoutDescriptor>> =
  Object.freeze({
    label_100x150: {
      id: "label_100x150",
      shortLabel: "100 × 150 MM",
      description: "One label per page for thermal label printers.",
      pageNoun: "LABEL PAGE",
      pageNounPlural: "LABEL PAGES",
      filename: "PRINT_READY_LABELS.pdf",
      widthPt: TARGET_LABEL_SIZE_PT.width,
      heightPt: TARGET_LABEL_SIZE_PT.height,
      labelsPerPage: 1,
    },
    a4_4up: {
      id: "a4_4up",
      shortLabel: "A4 / 4 PER SHEET",
      description: "Four labels per A4 sheet for inkjet and ink-tank printers.",
      pageNoun: "A4 SHEET",
      pageNounPlural: "A4 SHEETS",
      filename: "PRINT_READY_LABELS_A4.pdf",
      widthPt: A4_SIZE_PT.width,
      heightPt: A4_SIZE_PT.height,
      labelsPerPage: A4_SLOTS_PER_SHEET,
    },
  });

export function isOutputLayout(value: unknown): value is OutputLayout {
  return (
    typeof value === "string" &&
    (OUTPUT_LAYOUTS as readonly string[]).includes(value)
  );
}

export function describeOutputLayout(
  layout: OutputLayout,
): OutputLayoutDescriptor {
  return DESCRIPTORS[layout];
}

/**
 * Physical pages produced for `labelCount` shipment labels.
 *
 * 1-4 labels -> 1 A4 sheet, 5 -> 2, 100 -> 25, 101 -> 26.
 */
export function outputPageCount(
  labelCount: number,
  layout: OutputLayout,
): number {
  if (!Number.isInteger(labelCount) || labelCount < 0) {
    throw new Error("Label count must be a non-negative integer.");
  }
  const perPage = DESCRIPTORS[layout].labelsPerPage;
  return Math.ceil(labelCount / perPage);
}

export interface SheetSlot {
  /** Zero-based physical page this slot belongs to. */
  readonly pageIndex: number;
  /** Zero-based slot position within the page, row-major. */
  readonly slotIndex: number;
  readonly column: number;
  readonly row: number;
  /** Available label rectangle in PDF points, bottom-left origin. */
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/**
 * Resolve the quadrant for the `index`-th label in row-major order.
 *
 * Slot order is top-left, top-right, bottom-left, bottom-right. PDF user space
 * puts the origin at the bottom-left, so the first row is the *highest* `y`.
 */
export function sheetSlotFor(index: number): SheetSlot {
  if (!Number.isInteger(index) || index < 0) {
    throw new Error("Slot index must be a non-negative integer.");
  }
  const { columns, rows } = A4_SHEET_CONFIG;
  const pageIndex = Math.floor(index / A4_SLOTS_PER_SHEET);
  const slotIndex = index % A4_SLOTS_PER_SHEET;
  const row = Math.floor(slotIndex / columns);
  const column = slotIndex % columns;
  const width = A4_SIZE_PT.width / columns;
  const totalRowGutter = A4_ROW_GUTTER_PT * Math.max(0, rows - 1);
  const height = (A4_SIZE_PT.height - totalRowGutter) / rows;
  return {
    pageIndex,
    slotIndex,
    column,
    row,
    x: column * width,
    y: Math.max(
      0,
      A4_SIZE_PT.height -
        (row + 1) * height -
        row * A4_ROW_GUTTER_PT,
    ),
    width,
    height,
  };
}

export interface SlotPlacement {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly scale: number;
}

/**
 * Fit a label into a quadrant without distortion, cropping, or overlap.
 *
 * A single uniform scale is applied to both axes and the result is centred, so
 * aspect ratio is preserved and a barcode can never be squashed.
 */
export function placeLabelInSlot(
  slot: Pick<SheetSlot, "x" | "y" | "width" | "height">,
  labelWidthPt = TARGET_LABEL_SIZE_PT.width,
  labelHeightPt = TARGET_LABEL_SIZE_PT.height,
): SlotPlacement {
  if (
    labelWidthPt <= 0 ||
    labelHeightPt <= 0 ||
    slot.width <= 0 ||
    slot.height <= 0
  ) {
    throw new Error("Slot placement dimensions must be positive.");
  }
  const scale = Math.min(
    slot.width / labelWidthPt,
    slot.height / labelHeightPt,
  );
  const width = labelWidthPt * scale;
  const height = labelHeightPt * scale;
  return {
    x: slot.x + (slot.width - width) / 2,
    y: slot.y + (slot.height - height) / 2,
    width,
    height,
    scale,
  };
}

/** Human summary such as `100 LABELS / 25 A4 SHEETS`. Never calls a sheet a label. */
export function describeOutputVolume(
  labelCount: number,
  layout: OutputLayout,
): string {
  const pages = outputPageCount(labelCount, layout);
  const descriptor = DESCRIPTORS[layout];
  const pageNoun =
    pages === 1 ? descriptor.pageNoun : descriptor.pageNounPlural;
  const labelNoun = labelCount === 1 ? "LABEL" : "LABELS";
  return `${labelCount} ${labelNoun} / ${pages} ${pageNoun}`;
}
