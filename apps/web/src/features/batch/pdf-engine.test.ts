// @vitest-environment node

import type {
  BatchLabel,
  NormalizedLabel,
  PdfPageAnalysis,
  RegionDetection,
} from "@label-normalizer/core";
import { TARGET_LABEL_SIZE_PT } from "@label-normalizer/core";
import { PDFDocument } from "pdf-lib";
import { useBatchStore } from "./batch-store";
import { approveAllReviewLabels, retainPageForReview } from "./pdf-engine";

const PAGE: PdfPageAnalysis = {
  pageId: "document:page:1",
  pageNumber: 1,
  geometry: {
    widthPt: 595,
    heightPt: 842,
    rotation: 0,
    mediaBox: { x: 0, y: 0, width: 595, height: 842 },
  },
  textItems: [],
};

describe("uncertain page retention", () => {
  it("creates a full-page manual-review region when an adapter emits none", () => {
    const regions = retainPageForReview("document", PAGE, []);

    expect(regions).toHaveLength(1);
    expect(regions[0]?.requiresReview).toBe(true);
    expect(regions[0]?.boundsPt).toEqual(PAGE.geometry.mediaBox);
    expect(regions[0]?.evidence[0]?.code).toBe("pipeline.extraction_failed");
  });

  it("does not replace a region already emitted by an adapter", () => {
    const existing: RegionDetection[] = [
      {
        id: "region",
        documentId: "document",
        pageId: PAGE.pageId,
        regionIndex: 0,
        boundsPt: { x: 10, y: 10, width: 100, height: 200 },
        confidence: 0.8,
        evidence: [],
        requiresReview: false,
      },
    ];

    expect(retainPageForReview("document", PAGE, existing)).toBe(existing);
  });
});

describe("bulk manual review", () => {
  beforeEach(() => useBatchStore.getState().reset());

  it("approves every review item atomically and preserves other statuses", async () => {
    const store = useBatchStore.getState();
    const batchId = store.beginBatch([
      new File(["%PDF-1.7"], "review.pdf", {
        type: "application/pdf",
      }),
    ]);
    store.setLabels(batchId, [
      createLabel("review-1", "review_required", 0),
      createLabel("review-2", "review_required", 1),
      createLabel("ready", "success", 2),
      createLabel("skipped", "skipped", 3),
    ]);

    const approvedCount = await approveAllReviewLabels();
    const batch = useBatchStore.getState().batch;

    expect(approvedCount).toBe(2);
    expect(batch?.counts.reviewRequired).toBe(0);
    expect(batch?.counts.labelsReady).toBe(3);
    expect(batch?.labels.map((label) => label.status)).toEqual([
      "success",
      "success",
      "success",
      "skipped",
    ]);
    expect(batch?.labels[0]?.region.evidence.at(-1)?.code).toBe(
      "manual.approved",
    );
    expect(batch?.events.at(-1)?.metadata).toMatchObject({
      approvedCount: 2,
      action: "approve_all",
    });
  });

  it("reassembles reviewed labels in the currently selected A4 layout", async () => {
    const store = useBatchStore.getState();
    const batchId = store.beginBatch([
      new File(["%PDF-1.7"], "review.pdf", { type: "application/pdf" }),
    ]);
    const label = createLabel("review-a4", "review_required", 0);
    store.setLabels(batchId, [
      { ...label, normalized: await createNormalizedLabel(label, batchId) },
    ]);
    useBatchStore.setState({ outputLayout: "a4_4up" });

    await approveAllReviewLabels();

    const artifact = useBatchStore.getState().batch?.combinedPdf;
    expect(artifact?.layout).toBe("a4_4up");
    expect(artifact?.labelCount).toBe(1);
    expect(artifact?.pageCount).toBe(1);
  });
});

async function createNormalizedLabel(
  label: BatchLabel,
  batchId: string,
): Promise<NormalizedLabel> {
  const document = await PDFDocument.create();
  const page = document.addPage([
    TARGET_LABEL_SIZE_PT.width,
    TARGET_LABEL_SIZE_PT.height,
  ]);
  page.drawRectangle({ x: 10, y: 10, width: 20, height: 20 });
  return {
    id: `${label.id}:normalized`,
    batchId,
    documentId: label.documentId,
    pageId: label.pageId,
    regionId: label.regionId,
    sourcePageNumber: label.sourcePageNumber,
    outputOrder: label.outputOrder,
    marketplace: label.marketplace,
    widthPt: TARGET_LABEL_SIZE_PT.width,
    heightPt: TARGET_LABEL_SIZE_PT.height,
    sourceBoundsPt: label.region.boundsPt,
    pdfBytes: await document.save(),
    adapterId: "test",
    adapterVersion: "1",
  };
}

function createLabel(
  id: string,
  status: BatchLabel["status"],
  outputOrder: number,
): BatchLabel {
  return {
    id,
    documentId: "document",
    pageId: `page-${outputOrder}`,
    regionId: `region-${outputOrder}`,
    sourcePageNumber: outputOrder + 1,
    outputOrder,
    marketplace: "meesho",
    status,
    region: {
      id: `region-${outputOrder}`,
      documentId: "document",
      pageId: `page-${outputOrder}`,
      regionIndex: 0,
      boundsPt: PAGE.geometry.mediaBox,
      confidence: 0.6,
      evidence: [],
      requiresReview: status === "review_required",
    },
  };
}
