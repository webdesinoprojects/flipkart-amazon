import {
  assertBatchTransition,
  createBatchId,
  createEmptyBatch,
  createProcessingEvent,
  createSourceDescriptor,
  deriveBatchCounts,
  DEFAULT_OUTPUT_LAYOUT,
  type Batch,
  type BatchDocument,
  type BatchLabel,
  type BatchStatus,
  type CombinedPdfArtifact,
  type OutputLayout,
  type ProcessingEventDraft,
  type PdfPageAnalysis,
} from "@label-normalizer/core";
import { create } from "zustand";

/** Lifecycle of the artifact for the currently selected output layout. */
export type OutputArtifactStatus = "idle" | "generating" | "ready" | "failed";

interface BatchStoreState {
  readonly batch: Batch | null;
  readonly sourceFiles: ReadonlyMap<string, File>;
  readonly pageAnalyses: ReadonlyMap<string, PdfPageAnalysis>;
  readonly selectedDocumentId: string | null;
  readonly selectedPageId: string | null;
  readonly beginBatch: (files: readonly File[]) => string;
  readonly transitionBatch: (batchId: string, status: BatchStatus) => void;
  readonly updateDocument: (
    batchId: string,
    documentId: string,
    update: (document: BatchDocument) => BatchDocument,
  ) => void;
  readonly appendEvent: (batchId: string, event: ProcessingEventDraft) => void;
  readonly setPageAnalysis: (
    batchId: string,
    analysis: PdfPageAnalysis,
  ) => void;
  readonly setLabels: (batchId: string, labels: readonly BatchLabel[]) => void;
  readonly updateLabel: (
    batchId: string,
    labelId: string,
    update: (label: BatchLabel) => BatchLabel,
  ) => void;
  readonly setCombinedPdf: (
    batchId: string,
    combinedPdf: CombinedPdfArtifact | null,
  ) => void;
  /**
   * Output-layout selection and generated variants.
   *
   * Kept beside the batch rather than inside it: the layout is a presentation
   * choice made after processing, not part of the marketplace domain object.
   * `batch.combinedPdf` always mirrors the variant for `outputLayout`, so every
   * existing consumer keeps reading one selected artifact.
   */
  readonly outputLayout: OutputLayout;
  readonly outputVariants: ReadonlyMap<OutputLayout, CombinedPdfArtifact>;
  readonly outputStatus: OutputArtifactStatus;
  readonly outputError: string | null;
  readonly beginOutputLayout: (layout: OutputLayout) => void;
  readonly setOutputVariant: (
    batchId: string,
    layout: OutputLayout,
    artifact: CombinedPdfArtifact,
  ) => void;
  readonly failOutputLayout: (layout: OutputLayout, message: string) => void;
  readonly selectDocument: (documentId: string) => void;
  readonly selectPage: (documentId: string, pageId: string) => void;
  readonly reset: () => void;
}

function revokeObjectUrl(objectUrl: string | undefined): void {
  if (typeof URL === "undefined" || !objectUrl) return;
  URL.revokeObjectURL(objectUrl);
}

function disposePreviews(
  batch: Batch | null,
  variants?: ReadonlyMap<OutputLayout, CombinedPdfArtifact>,
): void {
  if (typeof URL === "undefined") return;
  for (const document of batch?.documents ?? []) {
    for (const page of document.pages) {
      if (page.preview) revokeObjectUrl(page.preview.objectUrl);
    }
  }
  // `batch.combinedPdf` is a mirror of one variant, so only the variant cache
  // owns the blob URLs; revoking both would double-revoke the selected one.
  if (variants) {
    for (const artifact of variants.values())
      revokeObjectUrl(artifact.objectUrl);
  } else {
    revokeObjectUrl(batch?.combinedPdf?.objectUrl);
  }
}

function withObjectUrl(artifact: CombinedPdfArtifact): CombinedPdfArtifact {
  return {
    ...artifact,
    objectUrl: URL.createObjectURL(
      new Blob([artifact.pdfBytes.slice().buffer as ArrayBuffer], {
        type: "application/pdf",
      }),
    ),
  };
}

export const useBatchStore = create<BatchStoreState>((set, get) => ({
  batch: null,
  sourceFiles: new Map(),
  pageAnalyses: new Map(),
  selectedDocumentId: null,
  selectedPageId: null,

  beginBatch(files) {
    disposePreviews(get().batch, get().outputVariants);
    const batchId = createBatchId();
    const documents = files.map<BatchDocument>((file, uploadIndex) => {
      const source = createSourceDescriptor(file, batchId, uploadIndex);
      return {
        id: source.id,
        batchId,
        source,
        status: "queued",
        pageCount: 0,
        pages: [],
      };
    });
    const sourceFiles = new Map(
      documents.map((document, index) => [document.id, files[index] as File]),
    );

    set({
      batch: createEmptyBatch(batchId, documents),
      sourceFiles,
      pageAnalyses: new Map(),
      selectedDocumentId: documents[0]?.id ?? null,
      selectedPageId: null,
      outputLayout: DEFAULT_OUTPUT_LAYOUT,
      outputVariants: new Map(),
      outputStatus: "idle",
      outputError: null,
    });
    return batchId;
  },

  transitionBatch(batchId, status) {
    set((state) => {
      if (!state.batch || state.batch.id !== batchId) return state;
      assertBatchTransition(state.batch.status, status);
      return {
        batch: {
          ...state.batch,
          status,
          updatedAt: new Date().toISOString(),
        },
      };
    });
  },

  updateDocument(batchId, documentId, update) {
    set((state) => {
      if (!state.batch || state.batch.id !== batchId) return state;
      const documents = state.batch.documents.map((document) =>
        document.id === documentId ? update(document) : document,
      );
      return {
        batch: {
          ...state.batch,
          documents,
          counts: deriveBatchCounts(documents, state.batch.labels),
          updatedAt: new Date().toISOString(),
        },
      };
    });
  },

  appendEvent(batchId, event) {
    set((state) => {
      if (!state.batch || state.batch.id !== batchId) return state;
      const nextEvent = createProcessingEvent(event, state.batch.events.length);
      return {
        batch: {
          ...state.batch,
          events: [...state.batch.events, nextEvent],
          updatedAt: nextEvent.timestamp,
        },
      };
    });
  },

  setPageAnalysis(batchId, analysis) {
    set((state) => {
      if (!state.batch || state.batch.id !== batchId) return state;
      const pageAnalyses = new Map(state.pageAnalyses);
      pageAnalyses.set(analysis.pageId, analysis);
      return { pageAnalyses };
    });
  },

  setLabels(batchId, labels) {
    set((state) => {
      if (!state.batch || state.batch.id !== batchId) return state;
      return {
        batch: {
          ...state.batch,
          labels,
          counts: deriveBatchCounts(state.batch.documents, labels),
          updatedAt: new Date().toISOString(),
        },
      };
    });
  },

  updateLabel(batchId, labelId, update) {
    set((state) => {
      if (!state.batch || state.batch.id !== batchId) return state;
      const labels = state.batch.labels.map((label) =>
        label.id === labelId ? update(label) : label,
      );
      return {
        batch: {
          ...state.batch,
          labels,
          counts: deriveBatchCounts(state.batch.documents, labels),
          updatedAt: new Date().toISOString(),
        },
      };
    });
  },

  setCombinedPdf(batchId, combinedPdf) {
    set((state) => {
      if (!state.batch || state.batch.id !== batchId) return state;
      // Reassembly from the processing pipeline invalidates every cached
      // variant, because the underlying approved labels just changed.
      for (const artifact of state.outputVariants.values()) {
        revokeObjectUrl(artifact.objectUrl);
      }
      const artifact = combinedPdf ? withObjectUrl(combinedPdf) : null;
      const variants = new Map<OutputLayout, CombinedPdfArtifact>();
      if (artifact) variants.set(artifact.layout, artifact);
      return {
        batch: {
          ...state.batch,
          combinedPdf: artifact,
          updatedAt: new Date().toISOString(),
        },
        outputVariants: variants,
        outputLayout: artifact?.layout ?? state.outputLayout,
        outputStatus: artifact ? "ready" : "idle",
        outputError: null,
      };
    });
  },

  outputLayout: DEFAULT_OUTPUT_LAYOUT,
  outputVariants: new Map(),
  outputStatus: "idle",
  outputError: null,

  beginOutputLayout(layout) {
    set((state) => {
      const cached = state.outputVariants.get(layout);
      if (cached) {
        return {
          outputLayout: layout,
          outputStatus: "ready",
          outputError: null,
          batch: state.batch
            ? { ...state.batch, combinedPdf: cached }
            : state.batch,
        };
      }
      return {
        outputLayout: layout,
        outputStatus: "generating",
        outputError: null,
      };
    });
  },

  setOutputVariant(batchId, layout, artifact) {
    set((state) => {
      if (!state.batch || state.batch.id !== batchId) return state;
      const variants = new Map(state.outputVariants);
      revokeObjectUrl(variants.get(layout)?.objectUrl);
      const stored = withObjectUrl(artifact);
      variants.set(layout, stored);
      // Only promote to the visible artifact when this is still the selection:
      // a slow generation must never overwrite a newer user choice.
      const isSelected = state.outputLayout === layout;
      return {
        outputVariants: variants,
        ...(isSelected
          ? {
              outputStatus: "ready" as OutputArtifactStatus,
              outputError: null,
              batch: { ...state.batch, combinedPdf: stored },
            }
          : {}),
      };
    });
  },

  failOutputLayout(layout, message) {
    set((state) =>
      state.outputLayout === layout
        ? { outputStatus: "failed", outputError: message }
        : state,
    );
  },

  selectDocument(documentId) {
    const document = get().batch?.documents.find(
      (item) => item.id === documentId,
    );
    set({
      selectedDocumentId: documentId,
      selectedPageId: document?.pages[0]?.id ?? null,
    });
  },

  selectPage(documentId, pageId) {
    set({ selectedDocumentId: documentId, selectedPageId: pageId });
  },

  reset() {
    disposePreviews(get().batch, get().outputVariants);
    set({
      batch: null,
      sourceFiles: new Map(),
      pageAnalyses: new Map(),
      selectedDocumentId: null,
      selectedPageId: null,
      outputLayout: DEFAULT_OUTPUT_LAYOUT,
      outputVariants: new Map(),
      outputStatus: "idle",
      outputError: null,
    });
  },
}));
