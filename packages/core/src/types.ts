import type { OutputLayout } from "./output-layout";

export type Marketplace = "flipkart" | "amazon" | "meesho" | "unknown";

export type PageKind =
  | "shipping_label"
  | "shipping_plus_invoice"
  | "seller_invoice"
  | "blank"
  | "unknown";

export type ProcessStatus =
  | "pending"
  | "queued"
  | "processing"
  | "success"
  | "warning"
  | "failed"
  | "review_required"
  | "skipped";

export type BatchStatus =
  | "idle"
  | "ingesting"
  | "parsing"
  | "classifying"
  | "extracting"
  | "normalizing"
  | "validating"
  | "review_required"
  | "assembling"
  | "ready"
  | "failed"
  | "cancelled";

export type ProcessingStage =
  | "ingest"
  | "parse"
  | "classify"
  | "extract"
  | "normalize"
  | "validate"
  | "review"
  | "assemble"
  | "complete";

export type ProcessingEventStatus =
  "queued" | "running" | "success" | "warning" | "failed";

export interface PdfPoint {
  readonly x: number;
  readonly y: number;
}

export interface PdfRect extends PdfPoint {
  readonly width: number;
  readonly height: number;
}

export interface PageGeometry {
  readonly widthPt: number;
  readonly heightPt: number;
  readonly rotation: 0 | 90 | 180 | 270;
  readonly mediaBox: PdfRect;
}

export interface Evidence {
  readonly code: string;
  readonly message: string;
  readonly source:
    | "pdf_structure"
    | "text_anchor"
    | "geometry"
    | "layout_fingerprint"
    | "barcode"
    | "computer_vision"
    | "manual";
  readonly weight?: number;
}

export interface SourceDocumentDescriptor {
  readonly id: string;
  readonly name: string;
  readonly sizeBytes: number;
  readonly mimeType: string;
  readonly uploadIndex: number;
  readonly lastModified: number;
}

export interface DocumentMetadata {
  readonly pdfVersion?: string;
  readonly title?: string;
  readonly author?: string;
  readonly creator?: string;
  readonly producer?: string;
  readonly creationDate?: string;
  readonly modificationDate?: string;
  readonly language?: string;
  readonly hasAcroForm: boolean;
  readonly hasXfa: boolean;
  readonly isPureXfa: boolean;
}

export interface PagePreview {
  readonly objectUrl: string;
  readonly widthPx: number;
  readonly heightPx: number;
  readonly mimeType: "image/webp" | "image/png";
}

export interface BatchPage {
  readonly id: string;
  readonly documentId: string;
  readonly pageNumber: number;
  readonly status: ProcessStatus;
  readonly geometry?: PageGeometry;
  readonly textItemCount: number;
  readonly hasExtractableText: boolean;
  readonly preview?: PagePreview;
  readonly classification?: PageClassification;
  readonly regions?: readonly RegionDetection[];
  readonly durationMs: number;
  readonly error?: ProcessingError;
}

export interface ProcessingError {
  readonly code: string;
  readonly message: string;
  readonly recoverable: boolean;
}

export interface BatchDocument {
  readonly id: string;
  readonly batchId: string;
  readonly source: SourceDocumentDescriptor;
  readonly status: ProcessStatus;
  readonly pageCount: number;
  readonly pages: readonly BatchPage[];
  readonly metadata?: DocumentMetadata;
  readonly detection?: DetectionResult;
  readonly durationMs?: number;
  readonly error?: ProcessingError;
}

export interface ProcessingEvent {
  readonly id: string;
  readonly sequence: number;
  readonly batchId: string;
  readonly documentId?: string;
  readonly pageId?: string;
  readonly stage: ProcessingStage;
  readonly status: ProcessingEventStatus;
  readonly progress?: number;
  readonly message: string;
  readonly timestamp: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export type ProcessingEventDraft = Omit<
  ProcessingEvent,
  "id" | "sequence" | "timestamp"
>;

export interface BatchCounts {
  readonly documentsTotal: number;
  readonly documentsReady: number;
  readonly documentsFailed: number;
  readonly sourcePages: number;
  readonly labelsDiscovered: number;
  readonly labelsReady: number;
  readonly reviewRequired: number;
  readonly labelsFailed: number;
}

export interface Batch {
  readonly id: string;
  readonly status: BatchStatus;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly documents: readonly BatchDocument[];
  readonly labels: readonly BatchLabel[];
  readonly combinedPdf: CombinedPdfArtifact | null;
  readonly events: readonly ProcessingEvent[];
  readonly counts: BatchCounts;
}

export interface BatchLabel {
  readonly id: string;
  readonly documentId: string;
  readonly pageId: string;
  readonly regionId: string;
  readonly sourcePageNumber: number;
  readonly outputOrder: number;
  readonly marketplace: Marketplace;
  readonly status: ProcessStatus;
  readonly region: RegionDetection;
  readonly normalized?: NormalizedLabel;
  readonly validation?: ValidationResult;
  readonly duplicateOf?: string;
  readonly duplicateEvidence?: "decoded_payload" | "strong_page_fingerprint";
  readonly error?: ProcessingError;
}

export interface CombinedPdfArtifact {
  readonly filename: string;
  readonly pdfBytes: Uint8Array;
  /** Physical pages in the PDF: label pages for 100 × 150, sheets for A4. */
  readonly pageCount: number;
  /** Shipment labels represented. Equals `pageCount` only for 100 × 150. */
  readonly labelCount: number;
  readonly layout: OutputLayout;
  readonly widthPt: number;
  readonly heightPt: number;
  readonly objectUrl?: string;
}

export interface DetectionResult {
  readonly marketplace: Marketplace;
  readonly confidence: number;
  readonly evidence: readonly Evidence[];
  readonly adapterId: string;
  readonly adapterVersion: string;
  readonly layoutFingerprint?: string;
}

export interface PageClassification {
  readonly marketplace: Marketplace;
  readonly pageKind: PageKind;
  readonly confidence: number;
  readonly evidence: readonly Evidence[];
  readonly layoutFingerprint?: string;
}

export interface RegionDetection {
  readonly id: string;
  readonly documentId: string;
  readonly pageId: string;
  readonly regionIndex: number;
  readonly boundsPt: PdfRect;
  readonly confidence: number;
  readonly evidence: readonly Evidence[];
  readonly layoutFingerprint?: string;
  readonly requiresReview: boolean;
  readonly rotation?: 0 | 90 | 180 | 270;
}

export interface PdfTextItem {
  readonly text: string;
  readonly boundsPt?: PdfRect;
  readonly transform?: readonly [
    number,
    number,
    number,
    number,
    number,
    number,
  ];
}

export interface PdfPageAnalysis {
  readonly pageId: string;
  readonly pageNumber: number;
  readonly geometry: PageGeometry;
  readonly textItems: readonly PdfTextItem[];
  /** Content bounds measured from a temporary low-resolution render. */
  readonly rasterContentBoundsPt?: PdfRect;
  /** Fraction of sampled preview pixels that are materially darker than white. */
  readonly rasterInkRatio?: number;
}

export interface PdfDocumentAnalysis {
  readonly documentId: string;
  readonly pages: readonly PdfPageAnalysis[];
}

export interface NormalizedLabel {
  readonly id: string;
  readonly batchId: string;
  readonly documentId: string;
  readonly pageId: string;
  readonly regionId: string;
  readonly sourcePageNumber: number;
  readonly outputOrder: number;
  readonly marketplace: Marketplace;
  readonly widthPt: number;
  readonly heightPt: number;
  readonly sourceBoundsPt: PdfRect;
  readonly pdfBytes: Uint8Array;
  readonly adapterId: string;
  readonly adapterVersion: string;
  readonly layoutFingerprint?: string;
  readonly rotationApplied?: 0 | 90 | 180 | 270;
}

export type ValidationDisposition =
  "auto_approved" | "secondary_verification" | "manual_review" | "failed";

export interface ValidationCheck {
  readonly id: string;
  readonly label: string;
  readonly status: "pass" | "warning" | "fail" | "not_run";
  readonly mandatory: boolean;
  readonly evidence: readonly Evidence[];
}

export interface MachineReadableCodeResult {
  readonly format: "code_128" | "qr" | "data_matrix" | "pdf_417" | "other";
  readonly detected: boolean;
  readonly decoded: boolean;
  readonly clipped: boolean;
  readonly payloadHash?: string;
  readonly boundsPx?: PdfRect;
}

export interface ConfidenceSignals {
  readonly marketplaceAnchors: number;
  readonly pageType: number;
  readonly geometry: number;
  readonly expectedText: number;
  readonly cropBoundaries: number;
  readonly barcodeDetected: number;
  readonly barcodeDecoded: number;
  readonly qrDetected: number;
  readonly qrDecoded: number;
  readonly clippingSafety: number;
  readonly layoutFingerprint: number;
}

export interface ValidationResult {
  readonly labelId: string;
  readonly valid: boolean;
  readonly confidence: number;
  readonly disposition: ValidationDisposition;
  readonly checks: readonly ValidationCheck[];
  readonly machineReadableCodes: readonly MachineReadableCodeResult[];
  readonly contentClippingRisk: number;
  readonly outputDimensionsValid: boolean;
  readonly retryRecommended: boolean;
}
