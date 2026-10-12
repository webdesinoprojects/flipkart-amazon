export const INGEST_LIMITS = Object.freeze({
  maxDocumentsPerBatch: 100,
  maxBytesPerDocument: 50 * 1024 * 1024,
  maxPagesPerBatch: 500,
  parseConcurrency: 2,
  previewWidthPx: 280,
});

export const PRINT_CONFIG = Object.freeze({
  widthMm: 100,
  heightMm: 150,
  pointsPerInch: 72,
  millimetresPerInch: 25.4,
  validationDpi: 203,
  orientation: "portrait" as const,
  targetPrinter: "PeriPeri S1",
});

/**
 * ISO A4 four-up imposition for inkjet/ink-tank/office printers.
 *
 * Millimetres only: point values are derived through `millimetresToPoints` so
 * the A4 size exists in exactly one place. A 2 x 2 grid with a small row
 * gutter gives each label a visible horizontal cutting boundary while staying
 * about 97% scale — close to physical size, with no distortion.
 */
export const A4_SHEET_CONFIG = Object.freeze({
  widthMm: 210,
  heightMm: 297,
  columns: 2,
  rows: 2,
  /** Clear paper between the top and bottom label rows for safer cutting. */
  rowGutterMm: 5,
  orientation: "portrait" as const,
  /** Thin cut guide drawn along the quadrant boundaries, behind label content. */
  cutGuideWidthPt: 0.25,
});

export const CONFIDENCE_THRESHOLDS = Object.freeze({
  autoApprove: 0.95,
  secondaryVerification: 0.8,
});
