import { INGEST_LIMITS } from "@label-normalizer/config";
import {
  assembleLabelsForLayout,
  assembleNormalizedLabels,
  analyzeMachineReadablePixels,
  hasExactTargetLabelDimensions,
  getMarketplaceAdapterById,
  sha256Bytes,
  detectRasterBounds,
  selectMarketplaceAdapter,
  toMachineReadableCodeResults,
} from "@label-normalizer/core";
import type {
  BatchLabel,
  BatchPage,
  DocumentMetadata,
  PageGeometry,
  PdfDocumentAnalysis,
  PdfMarketplaceAdapter,
  PdfPageAnalysis,
  PdfRect,
  PdfTextItem,
  ProcessingError,
  RegionDetection,
} from "@label-normalizer/core";
import type {
  PDFDocumentLoadingTask,
  PDFDocumentProxy,
  PDFPageProxy,
} from "pdfjs-dist";
import { useBatchStore } from "./batch-store";
import { validatePdfFile } from "./file-validation";

let activeController: AbortController | null = null;
let pdfJsPromise: Promise<typeof import("pdfjs-dist")> | null = null;

export function cancelActiveBatch(): void {
  activeController?.abort();
  activeController = null;
}

export async function redetectReviewLabel(
  labelId: string,
  boundsPt: PdfRect,
  rotation: 0 | 90 | 180 | 270,
): Promise<void> {
  const store = useBatchStore.getState();
  const batch = store.batch;
  const label = batch?.labels.find((item) => item.id === labelId);
  if (!batch || !label) throw new Error("Review label is unavailable.");
  const document = batch.documents.find((item) => item.id === label.documentId);
  const page = document?.pages.find((item) => item.id === label.pageId);
  const pageAnalysis = store.pageAnalyses.get(label.pageId);
  const sourceFile = store.sourceFiles.get(label.documentId);
  if (!document || !page || !pageAnalysis || !sourceFile) {
    throw new Error("Review source data is unavailable.");
  }
  const adapter = getMarketplaceAdapterById(
    label.normalized?.adapterId ?? label.marketplace,
  );
  const region: RegionDetection = {
    ...label.region,
    boundsPt: clampManualBounds(boundsPt, pageAnalysis.geometry.mediaBox),
    rotation,
    requiresReview: true,
    evidence: [
      ...label.region.evidence,
      {
        code: "manual.crop_adjustment",
        message: "Crop and rotation were adjusted in manual review.",
        source: "manual",
        weight: 1,
      },
    ],
  };
  const analysis: PdfDocumentAnalysis = {
    documentId: document.id,
    pages: document.pages.flatMap((record) => {
      const candidate = store.pageAnalyses.get(record.id);
      return candidate ? [candidate] : [];
    }),
  };
  const sourcePdfBytes = new Uint8Array(await sourceFile.arrayBuffer());
  const normalized = await adapter.normalizeRegion({
    pageContext: {
      documentContext: {
        batchId: batch.id,
        documentId: document.id,
        source: document.source,
        document: analysis,
        emit: (event) => store.appendEvent(batch.id, event),
      },
      pageId: pageAnalysis.pageId,
      pageNumber: pageAnalysis.pageNumber,
      page: pageAnalysis,
      geometry: pageAnalysis.geometry,
      textItems: pageAnalysis.textItems,
    },
    region,
    sourcePdfBytes,
    outputOrder: label.outputOrder,
  });
  const candidate: BatchLabel = {
    ...label,
    region,
    normalized,
    status: "review_required",
  };
  const validation = await validateNormalizedLabel(
    candidate,
    adapter,
    document,
    page,
  );
  store.updateLabel(batch.id, label.id, () => ({
    ...candidate,
    validation,
  }));
  store.appendEvent(batch.id, {
    batchId: batch.id,
    documentId: label.documentId,
    pageId: label.pageId,
    stage: "review",
    status: validation.valid ? "running" : "warning",
    progress: 1,
    message: validation.valid
      ? `Re-detection passed with ${validation.machineReadableCodes.length} decoded code${validation.machineReadableCodes.length === 1 ? "" : "s"}; awaiting approval.`
      : "Re-detection remains uncertain; inspect the crop before approval.",
  });
}

export async function approveReviewLabel(labelId: string): Promise<void> {
  await resolveReviewLabel(labelId, "success");
}

export async function approveAllReviewLabels(): Promise<number> {
  const store = useBatchStore.getState();
  const batch = store.batch;
  if (!batch) throw new Error("Review batch is unavailable.");

  const reviewIds = new Set(
    batch.labels
      .filter((label) => label.status === "review_required")
      .map((label) => label.id),
  );
  if (reviewIds.size === 0) return 0;

  store.setLabels(
    batch.id,
    batch.labels.map((label) =>
      reviewIds.has(label.id) ? withReviewResolution(label, "success") : label,
    ),
  );
  store.appendEvent(batch.id, {
    batchId: batch.id,
    stage: "review",
    status: "success",
    progress: 1,
    message: `${reviewIds.size} manual-review label${reviewIds.size === 1 ? "" : "s"} approved together.`,
    metadata: { approvedCount: reviewIds.size, action: "approve_all" },
  });
  await reassembleReadyLabels(batch.id);
  return reviewIds.size;
}

export async function skipReviewLabel(labelId: string): Promise<void> {
  await resolveReviewLabel(labelId, "skipped");
}

async function resolveReviewLabel(
  labelId: string,
  status: "success" | "skipped",
): Promise<void> {
  const store = useBatchStore.getState();
  const batch = store.batch;
  const label = batch?.labels.find((item) => item.id === labelId);
  if (!batch || !label) throw new Error("Review label is unavailable.");
  store.updateLabel(batch.id, label.id, (current) =>
    withReviewResolution(current, status),
  );
  store.appendEvent(batch.id, {
    batchId: batch.id,
    documentId: label.documentId,
    pageId: label.pageId,
    stage: "review",
    status: "success",
    progress: 1,
    message:
      status === "success"
        ? "Manual crop approved."
        : "Label skipped; remaining ready labels are unaffected.",
  });
  await reassembleReadyLabels(batch.id);
}

function withReviewResolution(
  label: BatchLabel,
  status: "success" | "skipped",
): BatchLabel {
  return {
    ...label,
    status,
    region: {
      ...label.region,
      requiresReview: false,
      evidence: [
        ...label.region.evidence,
        {
          code: status === "success" ? "manual.approved" : "manual.skipped",
          message:
            status === "success"
              ? "A user explicitly approved this crop."
              : "A user explicitly skipped this label.",
          source: "manual",
          weight: 1,
        },
      ],
    },
  };
}

async function reassembleReadyLabels(batchId: string): Promise<void> {
  const state = useBatchStore.getState();
  const ready =
    state.batch?.labels.flatMap((label) =>
      label.status === "success" && label.normalized ? [label.normalized] : [],
    ) ?? [];
  state.setCombinedPdf(
    batchId,
    ready.length > 0
      ? await assembleLabelsForLayout(ready, state.outputLayout)
      : null,
  );
}

function clampManualBounds(bounds: PdfRect, mediaBox: PdfRect): PdfRect {
  const minimum = 20;
  const left = Math.max(
    mediaBox.x,
    Math.min(bounds.x, mediaBox.x + mediaBox.width - minimum),
  );
  const bottom = Math.max(
    mediaBox.y,
    Math.min(bounds.y, mediaBox.y + mediaBox.height - minimum),
  );
  const right = Math.min(
    mediaBox.x + mediaBox.width,
    Math.max(left + minimum, bounds.x + bounds.width),
  );
  const top = Math.min(
    mediaBox.y + mediaBox.height,
    Math.max(bottom + minimum, bounds.y + bounds.height),
  );
  return { x: left, y: bottom, width: right - left, height: top - bottom };
}

export async function processBatchFiles(files: readonly File[]): Promise<void> {
  cancelActiveBatch();
  const controller = new AbortController();
  activeController = controller;

  const store = useBatchStore.getState();
  const batchId = store.beginBatch(files);
  store.transitionBatch(batchId, "ingesting");
  store.appendEvent(batchId, {
    batchId,
    stage: "ingest",
    status: "running",
    progress: 0,
    message: `Checking ${files.length} selected file${files.length === 1 ? "" : "s"}.`,
  });

  const validDocumentIds: string[] = [];
  const documents = useBatchStore.getState().batch?.documents ?? [];

  for (const [index, document] of documents.entries()) {
    if (controller.signal.aborted) return;
    const file = useBatchStore.getState().sourceFiles.get(document.id);
    if (!file) continue;
    const result = await validatePdfFile(file, index);
    const progress = (index + 1) / Math.max(1, documents.length);

    if (result.valid) {
      validDocumentIds.push(document.id);
      store.updateDocument(batchId, document.id, (current) => ({
        ...current,
        status: "queued",
      }));
      store.appendEvent(batchId, {
        batchId,
        documentId: document.id,
        stage: "ingest",
        status: "running",
        progress,
        message: `Document ${pad(index + 1)} passed local PDF checks.`,
        metadata: { sizeBytes: file.size },
      });
    } else {
      store.updateDocument(batchId, document.id, (current) => ({
        ...current,
        status: "failed",
        error: result.error,
      }));
      store.appendEvent(batchId, {
        batchId,
        documentId: document.id,
        stage: "ingest",
        status: "warning",
        progress,
        message: `Document ${pad(index + 1)} failed local PDF checks.`,
        metadata: { errorCode: result.error.code },
      });
    }
  }

  const invalidCount = documents.length - validDocumentIds.length;
  store.appendEvent(batchId, {
    batchId,
    stage: "ingest",
    status: invalidCount === 0 ? "success" : "warning",
    progress: 1,
    message:
      invalidCount === 0
        ? `${validDocumentIds.length} PDF${validDocumentIds.length === 1 ? "" : "s"} accepted.`
        : `${validDocumentIds.length} accepted; ${invalidCount} isolated as invalid.`,
    metadata: { accepted: validDocumentIds.length, rejected: invalidCount },
  });

  if (controller.signal.aborted) return;
  if (validDocumentIds.length === 0) {
    store.transitionBatch(batchId, "failed");
    return;
  }

  store.transitionBatch(batchId, "parsing");
  store.appendEvent(batchId, {
    batchId,
    stage: "parse",
    status: "running",
    progress: 0,
    message: "Starting local PDF.js inspection.",
  });

  let pagesReserved = 0;
  for (const [validIndex, documentId] of validDocumentIds.entries()) {
    if (controller.signal.aborted) return;
    const file = useBatchStore.getState().sourceFiles.get(documentId);
    if (!file) continue;
    const baseProgress = validIndex / validDocumentIds.length;

    const outcome = await parseDocument({
      batchId,
      documentId,
      file,
      signal: controller.signal,
      baseProgress,
      remainingPageBudget: INGEST_LIMITS.maxPagesPerBatch - pagesReserved,
    });
    pagesReserved += outcome.pageCount;

    store.appendEvent(batchId, {
      batchId,
      documentId,
      stage: "parse",
      status: outcome.status,
      progress: (validIndex + 1) / validDocumentIds.length,
      message: outcome.message,
      metadata: { pageCount: outcome.pageCount },
    });
  }

  if (controller.signal.aborted) return;
  const finalBatch = useBatchStore.getState().batch;
  if (!finalBatch || finalBatch.id !== batchId) return;

  const usableDocuments = finalBatch.documents.filter((document) =>
    ["success", "warning"].includes(document.status),
  ).length;
  const failedDocuments = finalBatch.documents.length - usableDocuments;

  if (usableDocuments === 0) {
    store.appendEvent(batchId, {
      batchId,
      stage: "parse",
      status: "failed",
      progress: 1,
      message: "No selected document could be inspected safely.",
    });
    store.transitionBatch(batchId, "failed");
    if (activeController === controller) activeController = null;
    return;
  }

  store.appendEvent(batchId, {
    batchId,
    stage: "parse",
    status: failedDocuments === 0 ? "success" : "warning",
    progress: 1,
    message:
      failedDocuments === 0
        ? `${finalBatch.counts.sourcePages} source pages inspected locally.`
        : `${finalBatch.counts.sourcePages} pages inspected; ${failedDocuments} document issue${failedDocuments === 1 ? "" : "s"} isolated.`,
  });

  await classifyAndExtractBatch(batchId, controller.signal);

  if (activeController === controller) activeController = null;
}

interface ParseDocumentInput {
  readonly batchId: string;
  readonly documentId: string;
  readonly file: File;
  readonly signal: AbortSignal;
  readonly baseProgress: number;
  readonly remainingPageBudget: number;
}

interface ParseDocumentOutcome {
  readonly pageCount: number;
  readonly status: "success" | "warning" | "failed";
  readonly message: string;
}

async function parseDocument({
  batchId,
  documentId,
  file,
  signal,
  baseProgress,
  remainingPageBudget,
}: ParseDocumentInput): Promise<ParseDocumentOutcome> {
  const store = useBatchStore.getState();
  const startedAt = performance.now();
  let pdfDocument: PDFDocumentProxy | null = null;
  let loadingTask: PDFDocumentLoadingTask | null = null;

  store.updateDocument(batchId, documentId, (document) => ({
    ...document,
    status: "processing",
  }));

  try {
    const pdfjs = await loadPdfJs();
    if (signal.aborted) return cancelledOutcome();
    const bytes = new Uint8Array(await file.arrayBuffer());
    loadingTask = pdfjs.getDocument({
      data: bytes,
      useSystemFonts: true,
      wasmUrl: new URL("/pdfjs/wasm/", window.location.href).href,
    });
    pdfDocument = await loadingTask.promise;

    if (pdfDocument.numPages > remainingPageBudget) {
      throw pageLimitError(remainingPageBudget);
    }

    const metadata = await readMetadata(pdfDocument);
    store.updateDocument(batchId, documentId, (document) => ({
      ...document,
      pageCount: pdfDocument?.numPages ?? 0,
      metadata,
    }));

    let pageFailures = 0;
    for (
      let pageNumber = 1;
      pageNumber <= pdfDocument.numPages;
      pageNumber += 1
    ) {
      if (signal.aborted) return cancelledOutcome();
      const pageId = `${documentId}:page:${pageNumber}`;
      const pageStartedAt = performance.now();
      let pdfPage: PDFPageProxy | null = null;

      try {
        pdfPage = await pdfDocument.getPage(pageNumber);
        const textContent = await pdfPage.getTextContent();
        const previewResult = await renderPreview(pdfPage);
        const geometry = getPageGeometry(pdfPage);
        const analysis: PdfPageAnalysis = {
          pageId,
          pageNumber,
          geometry,
          textItems: toPdfTextItems(textContent.items),
          ...(previewResult.rasterContentBoundsPt
            ? {
                rasterContentBoundsPt: previewResult.rasterContentBoundsPt,
              }
            : {}),
          rasterInkRatio: previewResult.rasterInkRatio,
        };
        store.setPageAnalysis(batchId, analysis);
        const page: BatchPage = {
          id: pageId,
          documentId,
          pageNumber,
          status: "success",
          geometry,
          textItemCount: textContent.items.filter(
            (item) => "str" in item && typeof item.str === "string",
          ).length,
          hasExtractableText: textContent.items.some(
            (item) => "str" in item && item.str.trim().length > 0,
          ),
          preview: previewResult.preview,
          durationMs: Math.round(performance.now() - pageStartedAt),
        };
        store.updateDocument(batchId, documentId, (document) => ({
          ...document,
          pages: [...document.pages, page],
        }));
        store.appendEvent(batchId, {
          batchId,
          documentId,
          pageId,
          stage: "parse",
          status: "running",
          progress: baseProgress,
          message: `Enumerated source page ${pageNumber} of ${pdfDocument.numPages}.`,
          metadata: {
            widthPt: page.geometry?.widthPt,
            heightPt: page.geometry?.heightPt,
            rotation: page.geometry?.rotation,
            textItemCount: page.textItemCount,
          },
        });
      } catch (error) {
        pageFailures += 1;
        const processingError = toProcessingError(error, "page_parse_failed");
        const failedPage: BatchPage = {
          id: pageId,
          documentId,
          pageNumber,
          status: "failed",
          textItemCount: 0,
          hasExtractableText: false,
          durationMs: Math.round(performance.now() - pageStartedAt),
          error: processingError,
        };
        store.updateDocument(batchId, documentId, (document) => ({
          ...document,
          pages: [...document.pages, failedPage],
        }));
        store.appendEvent(batchId, {
          batchId,
          documentId,
          pageId,
          stage: "parse",
          status: "warning",
          progress: baseProgress,
          message: `Source page ${pageNumber} could not be inspected; processing continued.`,
          metadata: { errorCode: processingError.code },
        });
      } finally {
        pdfPage?.cleanup();
      }
    }

    const successfulPages = pdfDocument.numPages - pageFailures;
    const status =
      successfulPages === 0
        ? "failed"
        : pageFailures > 0
          ? "warning"
          : "success";
    store.updateDocument(batchId, documentId, (document) => ({
      ...document,
      status,
      durationMs: Math.round(performance.now() - startedAt),
      ...(status === "failed"
        ? {
            error: {
              code: "all_pages_failed",
              message: "No page in this document could be inspected.",
              recoverable: true,
            },
          }
        : {}),
    }));

    return {
      pageCount: pdfDocument.numPages,
      status,
      message:
        status === "success"
          ? `Document inspected: ${pdfDocument.numPages} page${pdfDocument.numPages === 1 ? "" : "s"}.`
          : `${successfulPages} page${successfulPages === 1 ? "" : "s"} inspected; ${pageFailures} isolated failure${pageFailures === 1 ? "" : "s"}.`,
    };
  } catch (error) {
    const processingError = toProcessingError(error, "pdf_parse_failed");
    store.updateDocument(batchId, documentId, (document) => ({
      ...document,
      status: "failed",
      error: processingError,
      durationMs: Math.round(performance.now() - startedAt),
    }));
    return {
      pageCount: 0,
      status: "failed",
      message: `Document inspection failed (${processingError.code}).`,
    };
  } finally {
    await loadingTask?.destroy();
  }
}

async function classifyAndExtractBatch(
  batchId: string,
  signal: AbortSignal,
): Promise<void> {
  const store = useBatchStore.getState();
  const batch = useBatchStore.getState().batch;
  if (!batch || batch.id !== batchId || signal.aborted) return;

  const documents = batch.documents.filter((document) =>
    ["success", "warning"].includes(document.status),
  );
  const selections: Array<{
    readonly documentId: string;
    readonly adapter: PdfMarketplaceAdapter;
    readonly analysis: PdfDocumentAnalysis;
  }> = [];
  let unknownDocuments = 0;

  store.transitionBatch(batchId, "classifying");
  store.appendEvent(batchId, {
    batchId,
    stage: "classify",
    status: "running",
    progress: 0,
    message: "Running page-aware marketplace classification.",
  });

  for (const [documentIndex, document] of documents.entries()) {
    if (signal.aborted) return;
    const analyses = document.pages
      .map((page) => useBatchStore.getState().pageAnalyses.get(page.id))
      .filter((page): page is PdfPageAnalysis => Boolean(page));
    const analysis: PdfDocumentAnalysis = {
      documentId: document.id,
      pages: analyses,
    };
    const documentContext = {
      batchId,
      documentId: document.id,
      source: document.source,
      document: analysis,
      signal,
      emit: (event: Parameters<typeof store.appendEvent>[1]) =>
        store.appendEvent(batchId, event),
    };
    const { adapter, detection } =
      await selectMarketplaceAdapter(documentContext);
    selections.push({ documentId: document.id, adapter, analysis });
    if (detection.marketplace === "unknown") unknownDocuments += 1;

    store.updateDocument(batchId, document.id, (current) => ({
      ...current,
      detection,
    }));
    store.appendEvent(batchId, {
      batchId,
      documentId: document.id,
      stage: "classify",
      status: detection.marketplace === "unknown" ? "warning" : "running",
      progress: documentIndex / Math.max(1, documents.length),
      message:
        detection.marketplace === "flipkart"
          ? `Detected Flipkart with ${Math.round(detection.confidence * 100)}% evidence confidence.`
          : detection.marketplace === "amazon"
            ? `Detected Amazon with ${Math.round(detection.confidence * 100)}% evidence confidence.`
            : detection.marketplace === "meesho"
              ? `Detected Meesho with ${Math.round(detection.confidence * 100)}% evidence confidence.`
              : "No marketplace adapter matched; pages will be retained for review.",
      metadata: {
        marketplace: detection.marketplace,
        confidence: detection.confidence,
        adapterVersion: detection.adapterVersion,
        layoutFingerprint: detection.layoutFingerprint,
      },
    });

    for (const [pageIndex, pageAnalysis] of analyses.entries()) {
      const pageContext = {
        documentContext,
        pageId: pageAnalysis.pageId,
        pageNumber: pageAnalysis.pageNumber,
        page: pageAnalysis,
        geometry: pageAnalysis.geometry,
        textItems: pageAnalysis.textItems,
      };
      const classification = await adapter.classifyPage(pageContext);
      store.updateDocument(batchId, document.id, (current) => ({
        ...current,
        pages: current.pages.map((page) =>
          page.id === pageAnalysis.pageId ? { ...page, classification } : page,
        ),
      }));
      store.appendEvent(batchId, {
        batchId,
        documentId: document.id,
        pageId: pageAnalysis.pageId,
        stage: "classify",
        status: classification.pageKind === "unknown" ? "warning" : "running",
        progress:
          (documentIndex + (pageIndex + 1) / Math.max(1, analyses.length)) /
          Math.max(1, documents.length),
        message:
          classification.pageKind === "shipping_plus_invoice"
            ? "Classified page as shipping label plus invoice."
            : `Classified page as ${classification.pageKind.replaceAll("_", " ")}.`,
        metadata: {
          marketplace: classification.marketplace,
          pageKind: classification.pageKind,
          confidence: classification.confidence,
        },
      });
    }
  }

  store.appendEvent(batchId, {
    batchId,
    stage: "classify",
    status: unknownDocuments === 0 ? "success" : "warning",
    progress: 1,
    message:
      unknownDocuments === 0
        ? `${documents.length} document${documents.length === 1 ? "" : "s"} classified.`
        : `${documents.length - unknownDocuments} classified; ${unknownDocuments} retained as unknown.`,
  });

  store.transitionBatch(batchId, "extracting");
  store.appendEvent(batchId, {
    batchId,
    stage: "extract",
    status: "running",
    progress: 0,
    message: "Locating printable regions in canonical PDF coordinates.",
  });

  let extractedPages = 0;
  let reviewRegions = 0;
  const totalPages = selections.reduce(
    (total, selection) => total + selection.analysis.pages.length,
    0,
  );

  for (const selection of selections) {
    const currentDocument = useBatchStore
      .getState()
      .batch?.documents.find(
        (document) => document.id === selection.documentId,
      );
    if (!currentDocument || signal.aborted) return;
    const documentContext = {
      batchId,
      documentId: currentDocument.id,
      source: currentDocument.source,
      document: selection.analysis,
      signal,
      emit: (event: Parameters<typeof store.appendEvent>[1]) =>
        store.appendEvent(batchId, event),
    };

    for (const pageAnalysis of selection.analysis.pages) {
      if (signal.aborted) return;
      const pageRecord = useBatchStore
        .getState()
        .batch?.documents.find(
          (document) => document.id === selection.documentId,
        )
        ?.pages.find((page) => page.id === pageAnalysis.pageId);
      const classification = pageRecord?.classification;
      let regions: readonly RegionDetection[] = [];

      if (
        classification?.pageKind !== "blank" &&
        classification?.pageKind !== "seller_invoice"
      ) {
        try {
          regions = await selection.adapter.findPrintableRegions({
            documentContext,
            pageId: pageAnalysis.pageId,
            pageNumber: pageAnalysis.pageNumber,
            page: pageAnalysis,
            geometry: pageAnalysis.geometry,
            textItems: pageAnalysis.textItems,
          });
        } catch {
          regions = [fallbackReviewRegion(selection.documentId, pageAnalysis)];
        }
        regions = retainPageForReview(
          selection.documentId,
          pageAnalysis,
          regions,
        );
      }
      reviewRegions += regions.filter((region) => region.requiresReview).length;
      extractedPages += 1;

      store.updateDocument(batchId, selection.documentId, (current) => ({
        ...current,
        pages: current.pages.map((page) =>
          page.id === pageAnalysis.pageId ? { ...page, regions } : page,
        ),
      }));
      const flipkartRegion =
        classification?.marketplace === "flipkart" && regions.length === 1;
      const amazonLabel =
        classification?.marketplace === "amazon" && regions.length === 1;
      const amazonInvoice =
        classification?.marketplace === "amazon" &&
        classification.pageKind === "seller_invoice";
      const meeshoRegion =
        classification?.marketplace === "meesho" &&
        classification.pageKind === "shipping_plus_invoice" &&
        regions.length === 1;
      const meeshoExchange =
        classification?.marketplace === "meesho" &&
        classification.pageKind === "shipping_label" &&
        regions.length === 1;
      store.appendEvent(batchId, {
        batchId,
        documentId: selection.documentId,
        pageId: pageAnalysis.pageId,
        stage: "extract",
        status: regions.some((region) => region.requiresReview)
          ? "warning"
          : "running",
        progress: extractedPages / Math.max(1, totalPages),
        message: flipkartRegion
          ? "Found E-Kart label boundary; lower Tax Invoice excluded."
          : amazonLabel
            ? "Found Amazon shipping label; trimmed measured outer whitespace."
            : amazonInvoice
              ? "Amazon supplier-only invoice excluded."
              : meeshoExchange
                ? "Found Meesho exchange label; trimmed outer whitespace and retained it for review."
                : meeshoRegion
                  ? "Found Meesho package label; retained invoice content and trimmed outer whitespace."
                  : regions.length > 0
                    ? "Retained a conservative region for manual review."
                    : "No printable region emitted for this page type.",
        metadata: {
          regionCount: regions.length,
          layoutFingerprint: regions[0]?.layoutFingerprint,
          cropConfidence: regions[0]?.confidence,
        },
      });
    }
  }

  const discovered =
    useBatchStore.getState().batch?.counts.labelsDiscovered ?? 0;
  store.appendEvent(batchId, {
    batchId,
    stage: "extract",
    status: reviewRegions === 0 ? "success" : "warning",
    progress: 1,
    message: `${discovered} printable region${discovered === 1 ? "" : "s"} discovered; ${reviewRegions} require review.`,
    metadata: { labelsDiscovered: discovered, reviewRequired: reviewRegions },
  });
  await normalizeAndAssembleBatch(batchId, selections, signal);
}

async function normalizeAndAssembleBatch(
  batchId: string,
  selections: readonly {
    readonly documentId: string;
    readonly adapter: PdfMarketplaceAdapter;
    readonly analysis: PdfDocumentAnalysis;
  }[],
  signal: AbortSignal,
): Promise<void> {
  const store = useBatchStore.getState();
  const totalRegions =
    useBatchStore.getState().batch?.counts.labelsDiscovered ?? 0;
  let labels: BatchLabel[] = [];
  let completed = 0;
  let outputOrder = 0;

  store.transitionBatch(batchId, "normalizing");
  store.appendEvent(batchId, {
    batchId,
    stage: "normalize",
    status: "running",
    progress: 0,
    message:
      "Embedding original PDF regions into exact 100 × 150 mm portrait pages.",
  });

  for (const selection of selections) {
    if (signal.aborted) return;
    const currentDocument = useBatchStore
      .getState()
      .batch?.documents.find(
        (document) => document.id === selection.documentId,
      );
    const sourceFile = useBatchStore
      .getState()
      .sourceFiles.get(selection.documentId);
    if (!currentDocument || !sourceFile) continue;

    let sourcePdfBytes: Uint8Array;
    try {
      sourcePdfBytes = new Uint8Array(await sourceFile.arrayBuffer());
    } catch {
      for (const page of currentDocument.pages) {
        for (const region of page.regions ?? []) {
          labels.push(
            failedLabel(
              selection,
              page.pageNumber,
              region,
              outputOrder,
              "source_bytes_unavailable",
            ),
          );
          outputOrder += 1;
          completed += 1;
        }
      }
      store.setLabels(batchId, labels);
      continue;
    }

    for (const pageAnalysis of selection.analysis.pages) {
      const pageRecord = currentDocument.pages.find(
        (page) => page.id === pageAnalysis.pageId,
      );
      for (const region of pageRecord?.regions ?? []) {
        if (signal.aborted) return;
        try {
          const normalized = await selection.adapter.normalizeRegion({
            pageContext: {
              documentContext: {
                batchId,
                documentId: selection.documentId,
                source: currentDocument.source,
                document: selection.analysis,
                signal,
                emit: (event) => store.appendEvent(batchId, event),
              },
              pageId: pageAnalysis.pageId,
              pageNumber: pageAnalysis.pageNumber,
              page: pageAnalysis,
              geometry: pageAnalysis.geometry,
              textItems: pageAnalysis.textItems,
            },
            region,
            sourcePdfBytes,
            outputOrder,
          });
          labels.push({
            id: normalized.id,
            documentId: normalized.documentId,
            pageId: normalized.pageId,
            regionId: normalized.regionId,
            sourcePageNumber: normalized.sourcePageNumber,
            outputOrder,
            marketplace: normalized.marketplace,
            status: region.requiresReview ? "review_required" : "success",
            region,
            normalized,
          });
          store.appendEvent(batchId, {
            batchId,
            documentId: selection.documentId,
            pageId: pageAnalysis.pageId,
            stage: "normalize",
            status: region.requiresReview ? "warning" : "running",
            progress: (completed + 1) / Math.max(1, totalRegions),
            message: region.requiresReview
              ? "Normalized to 100 × 150 mm; final crop approval is required."
              : "Normalized to 100 × 150 mm using native PDF content.",
            metadata: {
              outputOrder,
              widthPt: normalized.widthPt,
              heightPt: normalized.heightPt,
              sourceContentPreserved: "pdf_native",
            },
          });
        } catch {
          labels.push(
            failedLabel(
              selection,
              pageAnalysis.pageNumber,
              region,
              outputOrder,
              "native_normalization_failed",
            ),
          );
          store.appendEvent(batchId, {
            batchId,
            documentId: selection.documentId,
            pageId: pageAnalysis.pageId,
            stage: "normalize",
            status: "warning",
            progress: (completed + 1) / Math.max(1, totalRegions),
            message:
              "One label could not be normalized; the remaining batch continued.",
            metadata: { outputOrder, errorCode: "native_normalization_failed" },
          });
        }
        outputOrder += 1;
        completed += 1;
        store.setLabels(batchId, labels);
      }
    }
  }

  const failed = labels.filter((label) => label.status === "failed").length;
  store.appendEvent(batchId, {
    batchId,
    stage: "normalize",
    status: failed === 0 ? "success" : "warning",
    progress: 1,
    message: `${labels.length - failed} label${labels.length - failed === 1 ? "" : "s"} normalized natively; ${failed} failed.`,
    metadata: { normalized: labels.length - failed, failed },
  });

  labels = await validateBatchLabels(batchId, labels, selections, signal);
  if (signal.aborted) return;

  const reviewCount = labels.filter(
    (label) => label.status === "review_required",
  ).length;
  if (reviewCount > 0) {
    store.transitionBatch(batchId, "review_required");
    store.appendEvent(batchId, {
      batchId,
      stage: "review",
      status: "warning",
      progress: 1,
      message: `${reviewCount} label${reviewCount === 1 ? "" : "s"} require manual approval before printing.`,
    });
  } else {
    store.appendEvent(batchId, {
      batchId,
      stage: "review",
      status: "success",
      progress: 1,
      message: "No labels require manual review.",
    });
  }

  store.transitionBatch(batchId, "assembling");
  store.appendEvent(batchId, {
    batchId,
    stage: "assemble",
    status: "running",
    progress: 0,
    message: "Assembling approved labels in source order.",
  });
  const ready = labels.flatMap((label) =>
    label.status === "success" && label.normalized ? [label.normalized] : [],
  );
  if (ready.length > 0) {
    try {
      const combinedPdf = await assembleNormalizedLabels(ready);
      store.setCombinedPdf(batchId, combinedPdf);
      store.appendEvent(batchId, {
        batchId,
        stage: "assemble",
        status: "success",
        progress: 1,
        message: `PRINT_READY_LABELS.pdf assembled with ${combinedPdf.pageCount} page${combinedPdf.pageCount === 1 ? "" : "s"}.`,
        metadata: { pageCount: combinedPdf.pageCount },
      });
    } catch {
      store.setCombinedPdf(batchId, null);
      store.appendEvent(batchId, {
        batchId,
        stage: "assemble",
        status: "failed",
        progress: 1,
        message:
          "Combined PDF assembly failed; individual normalized labels remain available.",
      });
    }
  } else {
    store.setCombinedPdf(batchId, null);
    store.appendEvent(batchId, {
      batchId,
      stage: "assemble",
      status: "warning",
      progress: 1,
      message: "No automatically approved labels are available for assembly.",
    });
  }

  store.transitionBatch(batchId, "ready");
  store.appendEvent(batchId, {
    batchId,
    stage: "complete",
    status: failed === 0 ? "success" : "warning",
    progress: 1,
    message: `${ready.length} print-ready label${ready.length === 1 ? "" : "s"}; ${reviewCount} require review; ${failed} failed.`,
  });
}

async function validateBatchLabels(
  batchId: string,
  labels: readonly BatchLabel[],
  selections: readonly {
    readonly documentId: string;
    readonly adapter: PdfMarketplaceAdapter;
    readonly analysis: PdfDocumentAnalysis;
  }[],
  signal: AbortSignal,
): Promise<BatchLabel[]> {
  const store = useBatchStore.getState();
  const validated: BatchLabel[] = [];
  const sourceBytes = new Map<string, Uint8Array>();
  const documentHashes = new Map<string, string>();

  store.transitionBatch(batchId, "validating");
  store.appendEvent(batchId, {
    batchId,
    stage: "validate",
    status: "running",
    progress: 0,
    message:
      "Rendering normalized labels at 203 DPI for barcode/QR validation.",
  });

  for (const [index, label] of labels.entries()) {
    if (signal.aborted) return validated;
    if (!label.normalized || label.status === "failed") {
      validated.push(label);
      continue;
    }
    const selection = selections.find(
      (candidate) => candidate.documentId === label.documentId,
    );
    const currentDocument = useBatchStore
      .getState()
      .batch?.documents.find((document) => document.id === label.documentId);
    const pageAnalysis = selection?.analysis.pages.find(
      (page) => page.pageId === label.pageId,
    );
    const pageRecord = currentDocument?.pages.find(
      (page) => page.id === label.pageId,
    );
    if (!selection || !currentDocument || !pageAnalysis || !pageRecord) {
      validated.push({ ...label, status: "review_required" });
      continue;
    }

    try {
      let activeLabel = label;
      let result = await validateNormalizedLabel(
        activeLabel,
        selection.adapter,
        currentDocument,
        pageRecord,
      );

      if (result.retryRecommended) {
        const expandedRegion = expandRegionForRetry(
          activeLabel.region,
          pageAnalysis.geometry.mediaBox,
          8,
        );
        const file = useBatchStore.getState().sourceFiles.get(label.documentId);
        if (file && !sameRect(expandedRegion.boundsPt, label.region.boundsPt)) {
          let bytes = sourceBytes.get(label.documentId);
          if (!bytes) {
            bytes = new Uint8Array(await file.arrayBuffer());
            sourceBytes.set(label.documentId, bytes);
          }
          const retriedNormalized = await selection.adapter.normalizeRegion({
            pageContext: {
              documentContext: {
                batchId,
                documentId: label.documentId,
                source: currentDocument.source,
                document: selection.analysis,
                signal,
                emit: (event) => store.appendEvent(batchId, event),
              },
              pageId: pageAnalysis.pageId,
              pageNumber: pageAnalysis.pageNumber,
              page: pageAnalysis,
              geometry: pageAnalysis.geometry,
              textItems: pageAnalysis.textItems,
            },
            region: expandedRegion,
            sourcePdfBytes: bytes,
            outputOrder: label.outputOrder,
          });
          const retriedLabel: BatchLabel = {
            ...activeLabel,
            region: expandedRegion,
            normalized: retriedNormalized,
          };
          const retriedResult = await validateNormalizedLabel(
            retriedLabel,
            selection.adapter,
            currentDocument,
            pageRecord,
          );
          if (
            retriedResult.valid ||
            retriedResult.contentClippingRisk < result.contentClippingRisk
          ) {
            activeLabel = retriedLabel;
            result = retriedResult;
          }
          store.appendEvent(batchId, {
            batchId,
            documentId: label.documentId,
            pageId: label.pageId,
            stage: "validate",
            status: result.valid ? "running" : "warning",
            progress: (index + 1) / Math.max(1, labels.length),
            message: "Retried validation with expanded native crop margins.",
          });
        }
      }

      const status =
        activeLabel.region.requiresReview || !result.valid
          ? "review_required"
          : "success";
      validated.push({ ...activeLabel, status, validation: result });
      store.appendEvent(batchId, {
        batchId,
        documentId: label.documentId,
        pageId: label.pageId,
        stage: "validate",
        status: status === "success" ? "running" : "warning",
        progress: (index + 1) / Math.max(1, labels.length),
        message:
          status === "success"
            ? `Barcode/QR validation passed at 203 DPI (${result.machineReadableCodes.length} decoded).`
            : "Barcode/QR evidence is uncertain; routed to review.",
        metadata: {
          confidence: result.confidence,
          decodedCount: result.machineReadableCodes.length,
          clippingRisk: result.contentClippingRisk,
        },
      });
    } catch {
      validated.push({ ...label, status: "review_required" });
      store.appendEvent(batchId, {
        batchId,
        documentId: label.documentId,
        pageId: label.pageId,
        stage: "validate",
        status: "warning",
        progress: (index + 1) / Math.max(1, labels.length),
        message: "Validation could not confirm this label; routed to review.",
      });
    }
  }

  for (const documentId of new Set(
    validated.map((label) => label.documentId),
  )) {
    const file = useBatchStore.getState().sourceFiles.get(documentId);
    if (!file) continue;
    let bytes = sourceBytes.get(documentId);
    if (!bytes) {
      bytes = new Uint8Array(await file.arrayBuffer());
      sourceBytes.set(documentId, bytes);
    }
    documentHashes.set(documentId, await sha256Bytes(bytes));
  }
  const withDuplicates = markDuplicateLabels(validated, documentHashes);
  for (const label of withDuplicates.filter((item) => item.duplicateOf)) {
    store.appendEvent(batchId, {
      batchId,
      documentId: label.documentId,
      pageId: label.pageId,
      stage: "validate",
      status: "warning",
      progress: 1,
      message:
        "Potential duplicate label detected and retained with a warning.",
      metadata: { evidence: label.duplicateEvidence },
    });
  }
  store.setLabels(batchId, withDuplicates);
  const review = withDuplicates.filter(
    (label) => label.status === "review_required",
  ).length;
  store.appendEvent(batchId, {
    batchId,
    stage: "validate",
    status: review === 0 ? "success" : "warning",
    progress: 1,
    message: `${withDuplicates.length - review} validated; ${review} require review.`,
  });
  return withDuplicates;
}

async function validateNormalizedLabel(
  label: BatchLabel & {
    readonly normalized?: NonNullable<BatchLabel["normalized"]>;
  },
  adapter: PdfMarketplaceAdapter,
  document: NonNullable<
    ReturnType<typeof useBatchStore.getState>["batch"]
  >["documents"][number],
  page: NonNullable<
    ReturnType<typeof useBatchStore.getState>["batch"]
  >["documents"][number]["pages"][number],
) {
  if (!label.normalized) throw new Error("Normalized label is unavailable.");
  const rendered = await renderValidationPage(label.normalized.pdfBytes);
  const pixels = analyzeMachineReadablePixels(
    rendered.rgba,
    rendered.width,
    rendered.height,
  );
  const machineReadableCodes = await toMachineReadableCodeResults(
    pixels.decodedCodes,
  );
  const linearDecoded = machineReadableCodes.some(
    (code) => code.format === "code_128" || code.format === "other",
  );
  const twoDimensionalDecoded = machineReadableCodes.some(
    (code) => code.format === "qr" || code.format === "data_matrix",
  );
  const classification = page.classification;
  return adapter.validate({
    label: label.normalized,
    expectedMachineReadableCodes:
      label.marketplace === "amazon"
        ? ["linear"]
        : label.marketplace === "meesho"
          ? ["two_dimensional"]
          : ["machine_readable"],
    validationDpi: 203,
    machineReadableCodes,
    outputDimensionsValid: rendered.outputDimensionsValid,
    contentClippingRisk: pixels.clippingRisk,
    confidenceSignals: {
      marketplaceAnchors: document.detection?.confidence ?? 0,
      pageType: classification?.confidence ?? 0,
      geometry: rendered.outputDimensionsValid ? 1 : 0,
      expectedText: classification?.confidence ?? 0,
      cropBoundaries: label.region.confidence,
      barcodeDetected: pixels.linearPatternDetected ? 1 : 0,
      barcodeDecoded: linearDecoded ? 1 : 0,
      qrDetected: twoDimensionalDecoded ? 1 : 0,
      qrDecoded: twoDimensionalDecoded ? 1 : 0,
      clippingSafety: 1 - pixels.clippingRisk,
      layoutFingerprint: label.normalized.layoutFingerprint ? 1 : 0,
    },
  });
}

async function renderValidationPage(pdfBytes: Uint8Array) {
  const pdfjs = await loadPdfJs();
  const loadingTask = pdfjs.getDocument({
    data: pdfBytes.slice(),
    useSystemFonts: true,
    wasmUrl: new URL("/pdfjs/wasm/", window.location.href).href,
  });
  const document = await loadingTask.promise;
  try {
    const page = await document.getPage(1);
    const unitViewport = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: 203 / 72 });
    const canvas = window.document.createElement("canvas");
    canvas.width = Math.max(1, Math.ceil(viewport.width));
    canvas.height = Math.max(1, Math.ceil(viewport.height));
    const context = canvas.getContext("2d", { alpha: false });
    if (!context) throw new Error("Canvas rendering is unavailable.");
    await page.render({
      canvas,
      canvasContext: context,
      viewport,
      background: "#ffffff",
    }).promise;
    return {
      rgba: context.getImageData(0, 0, canvas.width, canvas.height).data,
      width: canvas.width,
      height: canvas.height,
      outputDimensionsValid: hasExactTargetLabelDimensions(
        unitViewport.width,
        unitViewport.height,
      ),
    };
  } finally {
    await loadingTask.destroy();
  }
}

function expandRegionForRetry(
  region: RegionDetection,
  mediaBox: RegionDetection["boundsPt"],
  margin: number,
): RegionDetection {
  const left = Math.max(mediaBox.x, region.boundsPt.x - margin);
  const bottom = Math.max(mediaBox.y, region.boundsPt.y - margin);
  const right = Math.min(
    mediaBox.x + mediaBox.width,
    region.boundsPt.x + region.boundsPt.width + margin,
  );
  const top = Math.min(
    mediaBox.y + mediaBox.height,
    region.boundsPt.y + region.boundsPt.height + margin,
  );
  return {
    ...region,
    boundsPt: { x: left, y: bottom, width: right - left, height: top - bottom },
    evidence: [
      ...region.evidence,
      {
        code: "validation.crop_margin_retry",
        message: "Expanded the native crop margin after clipping evidence.",
        source: "geometry",
        weight: 0.2,
      },
    ],
  };
}

function sameRect(
  left: RegionDetection["boundsPt"],
  right: RegionDetection["boundsPt"],
): boolean {
  return (
    left.x === right.x &&
    left.y === right.y &&
    left.width === right.width &&
    left.height === right.height
  );
}

function markDuplicateLabels(
  labels: readonly BatchLabel[],
  documentHashes: ReadonlyMap<string, string>,
): BatchLabel[] {
  const payloadOwners = new Map<string, string>();
  const pageOwners = new Map<string, string>();
  return labels.map((label) => {
    const duplicatePayload = label.validation?.machineReadableCodes
      .map((code) => code.payloadHash)
      .filter((hash): hash is string => Boolean(hash))
      .map((hash) => payloadOwners.get(hash))
      .find((owner): owner is string => Boolean(owner));
    const documentHash = documentHashes.get(label.documentId);
    const pageFingerprint = documentHash
      ? `${documentHash}:${label.sourcePageNumber}:${label.region.regionIndex}`
      : undefined;
    const duplicatePage = pageFingerprint
      ? pageOwners.get(pageFingerprint)
      : undefined;
    const duplicateOf = duplicatePayload ?? duplicatePage;

    for (const hash of label.validation?.machineReadableCodes
      .map((code) => code.payloadHash)
      .filter((value): value is string => Boolean(value)) ?? []) {
      if (!payloadOwners.has(hash)) payloadOwners.set(hash, label.id);
    }
    if (pageFingerprint && !pageOwners.has(pageFingerprint)) {
      pageOwners.set(pageFingerprint, label.id);
    }
    return duplicateOf
      ? {
          ...label,
          duplicateOf,
          duplicateEvidence: duplicatePayload
            ? "decoded_payload"
            : "strong_page_fingerprint",
        }
      : label;
  });
}

function failedLabel(
  selection: {
    readonly documentId: string;
    readonly adapter: PdfMarketplaceAdapter;
  },
  sourcePageNumber: number,
  region: RegionDetection,
  outputOrder: number,
  errorCode: string,
): BatchLabel {
  return {
    id: `${region.id}:label`,
    documentId: selection.documentId,
    pageId: region.pageId,
    regionId: region.id,
    sourcePageNumber,
    outputOrder,
    marketplace:
      selection.adapter.id === "flipkart" ||
      selection.adapter.id === "amazon" ||
      selection.adapter.id === "meesho"
        ? selection.adapter.id
        : "unknown",
    status: "failed",
    region,
    error: {
      code: errorCode,
      message: "This label could not be normalized from its source PDF.",
      recoverable: true,
    },
  };
}

function fallbackReviewRegion(
  documentId: string,
  page: PdfPageAnalysis,
): RegionDetection {
  return {
    id: `${page.pageId}:region:0`,
    documentId,
    pageId: page.pageId,
    regionIndex: 0,
    boundsPt: page.geometry.mediaBox,
    confidence: 0.1,
    evidence: [
      {
        code: "pipeline.extraction_failed",
        message:
          "Deterministic extraction failed; the full page is retained for review.",
        source: "geometry",
        weight: 0.1,
      },
    ],
    requiresReview: true,
  };
}

export function retainPageForReview(
  documentId: string,
  page: PdfPageAnalysis,
  regions: readonly RegionDetection[],
): readonly RegionDetection[] {
  return regions.length > 0
    ? regions
    : [fallbackReviewRegion(documentId, page)];
}

function toPdfTextItems(items: readonly unknown[]): readonly PdfTextItem[] {
  return items.flatMap((item) => {
    if (
      typeof item !== "object" ||
      item === null ||
      !("str" in item) ||
      typeof item.str !== "string" ||
      !("transform" in item) ||
      !Array.isArray(item.transform)
    ) {
      return [];
    }
    const transform = item.transform;
    if (
      transform.length < 6 ||
      !transform.slice(0, 6).every((value) => typeof value === "number")
    ) {
      return [];
    }
    const matrix = transform.slice(0, 6) as [
      number,
      number,
      number,
      number,
      number,
      number,
    ];
    const width =
      "width" in item && typeof item.width === "number" ? item.width : 0;
    const height =
      "height" in item && typeof item.height === "number" ? item.height : 0;
    return [
      {
        text: item.str,
        transform: matrix,
        boundsPt: {
          x: matrix[4],
          y: matrix[5],
          width,
          height,
        },
      },
    ];
  });
}

async function loadPdfJs(): Promise<typeof import("pdfjs-dist")> {
  pdfJsPromise ??= import("pdfjs-dist").then((pdfjs) => {
    pdfjs.GlobalWorkerOptions.workerSrc = new URL(
      "pdfjs-dist/build/pdf.worker.min.mjs",
      import.meta.url,
    ).toString();
    return pdfjs;
  });
  return pdfJsPromise;
}

async function readMetadata(
  pdfDocument: PDFDocumentProxy,
): Promise<DocumentMetadata> {
  const result = await pdfDocument.getMetadata();
  const info = result.info as unknown as Record<string, unknown>;
  const metadata = result.metadata;

  return {
    ...optionalString("pdfVersion", info.PDFFormatVersion),
    ...optionalString("title", info.Title),
    ...optionalString("author", info.Author),
    ...optionalString("creator", info.Creator),
    ...optionalString("producer", info.Producer),
    ...optionalString("creationDate", info.CreationDate),
    ...optionalString("modificationDate", info.ModDate),
    ...optionalString("language", metadata?.get("dc:language")),
    hasAcroForm: Boolean(info.IsAcroFormPresent),
    hasXfa: Boolean(info.IsXFAPresent),
    isPureXfa: pdfDocument.isPureXfa,
  };
}

function optionalString<Key extends string>(
  key: Key,
  value: unknown,
): { readonly [Property in Key]?: string } {
  return typeof value === "string" && value.trim().length > 0
    ? ({ [key]: value } as { readonly [Property in Key]?: string })
    : {};
}

function getPageGeometry(pdfPage: PDFPageProxy): PageGeometry {
  const [x1 = 0, y1 = 0, x2 = 0, y2 = 0] = pdfPage.view;
  const rotation = normalizeRotation(pdfPage.rotate);
  return {
    widthPt: Math.abs(x2 - x1),
    heightPt: Math.abs(y2 - y1),
    rotation,
    mediaBox: {
      x: Math.min(x1, x2),
      y: Math.min(y1, y2),
      width: Math.abs(x2 - x1),
      height: Math.abs(y2 - y1),
    },
  };
}

function normalizeRotation(rotation: number): 0 | 90 | 180 | 270 {
  const normalized = ((rotation % 360) + 360) % 360;
  return normalized === 90 || normalized === 180 || normalized === 270
    ? normalized
    : 0;
}

async function renderPreview(pdfPage: PDFPageProxy) {
  const baseViewport = pdfPage.getViewport({ scale: 1 });
  const scale = Math.min(1, INGEST_LIMITS.previewWidthPx / baseViewport.width);
  const viewport = pdfPage.getViewport({ scale });
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.ceil(viewport.width));
  canvas.height = Math.max(1, Math.ceil(viewport.height));
  const context = canvas.getContext("2d", { alpha: false });
  if (!context) throw new Error("Canvas rendering is unavailable.");

  await pdfPage.render({
    canvas,
    canvasContext: context,
    viewport,
    background: "#ffffff",
  }).promise;

  const raster = detectRasterBounds(
    context.getImageData(0, 0, canvas.width, canvas.height).data,
    canvas.width,
    canvas.height,
  );
  const rasterContentBoundsPt = raster.boundsPx
    ? viewportRectToPdfRect(viewport, raster.boundsPx)
    : undefined;

  const webpBlob = await canvasToBlob(canvas, "image/webp", 0.78);
  const blob =
    webpBlob.type === "image/webp"
      ? webpBlob
      : await canvasToBlob(canvas, "image/png");
  const mimeType = blob.type === "image/webp" ? "image/webp" : "image/png";

  return {
    preview: {
      objectUrl: URL.createObjectURL(blob),
      widthPx: canvas.width,
      heightPx: canvas.height,
      mimeType,
    } as const,
    rasterContentBoundsPt,
    rasterInkRatio: raster.inkRatio,
  };
}

function viewportRectToPdfRect(
  viewport: {
    convertToPdfPoint(x: number, y: number): number[];
  },
  rect: {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
  },
) {
  const [x1 = 0, y1 = 0] = viewport.convertToPdfPoint(rect.x, rect.y);
  const [x2 = 0, y2 = 0] = viewport.convertToPdfPoint(
    rect.x + rect.width,
    rect.y + rect.height,
  );
  return {
    x: Math.min(x1, x2),
    y: Math.min(y1, y2),
    width: Math.abs(x2 - x1),
    height: Math.abs(y2 - y1),
  };
}

function canvasToBlob(
  canvas: HTMLCanvasElement,
  type: "image/webp" | "image/png",
  quality?: number,
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) =>
        blob ? resolve(blob) : reject(new Error("Preview encoding failed.")),
      type,
      quality,
    );
  });
}

function toProcessingError(
  error: unknown,
  fallbackCode: string,
): ProcessingError {
  if (isProcessingError(error)) return error;
  const name = error instanceof Error ? error.name : "";

  if (name === "PasswordException") {
    return {
      code: "password_protected_pdf",
      message: "Password-protected PDFs require review or a later fallback.",
      recoverable: true,
    };
  }
  if (name === "InvalidPDFException") {
    return {
      code: "invalid_pdf",
      message: "PDF.js reported an invalid or damaged document.",
      recoverable: true,
    };
  }
  return {
    code: fallbackCode,
    message: "The PDF could not be inspected safely in this browser.",
    recoverable: true,
  };
}

function pageLimitError(remainingPageBudget: number): ProcessingError {
  return {
    code: "batch_page_limit",
    message: `This document exceeds the remaining ${Math.max(0, remainingPageBudget)}-page batch budget.`,
    recoverable: true,
  };
}

function isProcessingError(error: unknown): error is ProcessingError {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    "message" in error &&
    "recoverable" in error
  );
}

function cancelledOutcome(): ParseDocumentOutcome {
  return { pageCount: 0, status: "failed", message: "Processing cancelled." };
}

function pad(value: number): string {
  return value.toString().padStart(2, "0");
}
