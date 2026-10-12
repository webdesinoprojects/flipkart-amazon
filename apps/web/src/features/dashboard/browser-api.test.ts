import type { Batch } from "@label-normalizer/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { saveBatchToHistory } from "./browser-api";

describe("saveBatchToHistory", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("uploads only generated output and aggregate metadata", async () => {
    document.cookie = "ln_csrf=test-csrf; path=/";
    const responseBody = { id: "saved-1", status: "saved" };
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(responseBody), {
        status: 201,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await saveBatchToHistory(batchFixture());

    const [path, request] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(path).toBe("/api/v1/history/batches");
    expect(new Headers(request.headers).get("X-CSRF-Token")).toBe("test-csrf");
    const form = request.body as FormData;
    const metadata = JSON.parse(String(form.get("metadata")));
    expect(metadata).toMatchObject({
      clientBatchId: "batch-browser-test",
      sourceDocumentCount: 2,
      sourcePageCount: 3,
      labelsDiscovered: 2,
      labelsReady: 2,
      outputPageCount: 2,
      outputLayout: "label_100x150",
      marketplaceCounts: { amazon: 1, meesho: 1 },
    });
    expect(JSON.stringify(metadata)).not.toContain("customer-source.pdf");
    const output = form.get("output") as File;
    expect(output.name).toBe("PRINT_READY_LABELS.pdf");
    expect(output.type).toBe("application/pdf");
  });

  it("reports A4 sheets rather than labels for four-up output", async () => {
    document.cookie = "ln_csrf=test-csrf; path=/";
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ id: "saved-2", status: "saved" }), {
        status: 201,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const batch = batchFixture();
    await saveBatchToHistory({
      ...batch,
      combinedPdf: {
        ...batch.combinedPdf!,
        filename: "PRINT_READY_LABELS_A4.pdf",
        pageCount: 1,
        labelCount: 2,
        layout: "a4_4up",
      },
    } as Batch);

    const [, request] = fetchMock.mock.calls[0] as [string, RequestInit];
    const form = request.body as FormData;
    const metadata = JSON.parse(String(form.get("metadata")));
    expect(metadata.outputLayout).toBe("a4_4up");
    expect(metadata.outputPageCount).toBe(1);
    expect(metadata.labelsReady).toBe(2);
  });
});

function batchFixture(): Batch {
  return {
    id: "batch-browser-test",
    status: "ready",
    createdAt: "2026-10-07T00:00:00Z",
    updatedAt: "2026-10-07T00:00:00Z",
    documents: [],
    labels: [
      { id: "one", marketplace: "amazon" },
      { id: "two", marketplace: "meesho", duplicateOf: "one" },
    ],
    combinedPdf: {
      filename: "PRINT_READY_LABELS.pdf",
      pdfBytes: new Uint8Array([37, 80, 68, 70, 45]),
      pageCount: 2,
      labelCount: 2,
      layout: "label_100x150",
      widthPt: 283.464,
      heightPt: 425.197,
    },
    events: [],
    counts: {
      documentsTotal: 2,
      documentsReady: 2,
      documentsFailed: 0,
      sourcePages: 3,
      labelsDiscovered: 2,
      labelsReady: 2,
      reviewRequired: 0,
      labelsFailed: 0,
    },
  } as unknown as Batch;
}
