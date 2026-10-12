import type { Batch } from "@label-normalizer/core";
import { browserApiRequest } from "@/features/auth/browser-api";
import type { SavedBatch } from "./contracts";

export async function saveBatchToHistory(batch: Batch): Promise<SavedBatch> {
  const artifact = batch.combinedPdf;
  if (!artifact || artifact.pageCount < 1) {
    throw new Error(
      "A generated combined PDF is required before this batch can be saved.",
    );
  }
  const marketplaceCounts = batch.labels.reduce<Record<string, number>>(
    (counts, label) => {
      counts[label.marketplace] = (counts[label.marketplace] ?? 0) + 1;
      return counts;
    },
    {},
  );
  const metadata = {
    clientBatchId: batch.id,
    sourceDocumentCount: batch.counts.documentsTotal,
    sourcePageCount: batch.counts.sourcePages,
    labelsDiscovered: batch.counts.labelsDiscovered,
    labelsReady: batch.counts.labelsReady,
    reviewRequired: batch.counts.reviewRequired,
    labelsFailed: batch.counts.labelsFailed,
    duplicateWarnings: batch.labels.filter((label) => label.duplicateOf).length,
    // Physical pages and the layout that produced them. For A4 four-up these
    // differ from the label count, and the API validates the relationship.
    outputPageCount: artifact.pageCount,
    outputLayout: artifact.layout,
    marketplaceCounts,
  };
  const bytes = artifact.pdfBytes.slice().buffer;
  const form = new FormData();
  form.set("metadata", JSON.stringify(metadata));
  form.set(
    "output",
    new File([bytes], artifact.filename, { type: "application/pdf" }),
  );
  return browserApiRequest<SavedBatch>(
    "/api/v1/history/batches",
    { method: "POST", body: form },
    true,
  );
}
