import {
  assembleLabelsForLayout,
  type Batch,
  type CombinedPdfArtifact,
  type OutputLayout,
} from "@label-normalizer/core";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useBatchStore } from "@/features/batch/batch-store";
import { resetOutputLayoutRequests } from "@/features/batch/output-layout-controller";
import { saveBatchToHistory } from "@/features/dashboard/browser-api";
import { OutputPanel } from "./output-panel";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

vi.mock("@/features/dashboard/browser-api", () => ({
  saveBatchToHistory: vi.fn().mockResolvedValue({ id: "saved-batch" }),
}));

vi.mock("@label-normalizer/core", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@label-normalizer/core")>();
  return { ...actual, assembleLabelsForLayout: vi.fn() };
});

const assembleMock = vi.mocked(assembleLabelsForLayout);
const LABEL_COUNT = 8;

/**
 * Store-connected harness mirroring how `Workspace` renders the panel.
 *
 * The panel takes its batch as a prop, and the real caller feeds that prop from
 * the store, so a test that passed a frozen object would never observe the
 * selected artifact changing.
 */
function ConnectedPanel() {
  const batch = useBatchStore((state) => state.batch);
  return batch ? <OutputPanel batch={batch} /> : null;
}

/** Renders the panel with the store primed as a finished 8-label batch. */
function renderPanel(): Batch {
  const batch = readyBatch();
  useBatchStore.setState({
    batch,
    outputLayout: "label_100x150",
    outputVariants: new Map([["label_100x150", batch.combinedPdf!]]),
    outputStatus: "ready",
    outputError: null,
  });
  render(<ConnectedPanel />);
  return batch;
}

beforeEach(() => {
  resetOutputLayoutRequests();
  vi.mocked(saveBatchToHistory).mockClear();
  useBatchStore.setState({
    batch: null,
    outputLayout: "label_100x150",
    outputVariants: new Map(),
    outputStatus: "idle",
    outputError: null,
  });
  assembleMock.mockReset();
  assembleMock.mockImplementation(async (_labels, layout) =>
    artifactFor(layout as OutputLayout),
  );
  vi.stubGlobal("URL", {
    createObjectURL: vi.fn(() => `blob:${Math.random().toString(36).slice(2)}`),
    revokeObjectURL: vi.fn(),
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("OutputPanel output layout selection", () => {
  it("defaults to 100 x 150 mm, one page per label", () => {
    renderPanel();

    const standard = screen.getByRole("radio", { name: /100 × 150 MM/i });
    expect(standard).toBeChecked();
    expect(
      screen.getByRole("radio", { name: /A4 \/ 4 PER SHEET/i }),
    ).not.toBeChecked();
    expect(screen.getByText("8 LABELS / 8 LABEL PAGES")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "PRINT_READY_LABELS.pdf" }),
    ).toBeInTheDocument();
  });

  it("does not use a browser select element", () => {
    renderPanel();
    expect(document.querySelector("select")).toBeNull();
  });

  it("generates the four-up artifact and reports A4 sheets, not labels", async () => {
    renderPanel();

    await userEvent.click(screen.getByRole("radio", { name: /A4/i }));

    await waitFor(() =>
      expect(screen.getByText("8 LABELS / 2 A4 SHEETS")).toBeInTheDocument(),
    );
    expect(assembleMock).toHaveBeenCalledWith(expect.anything(), "a4_4up");
    expect(useBatchStore.getState().batch?.combinedPdf?.layout).toBe("a4_4up");
    expect(screen.queryByText(/A4 LABELS/i)).toBeNull();
  });

  it("points preview, download, and print at the selected artifact", async () => {
    renderPanel();
    await userEvent.click(screen.getByRole("radio", { name: /A4/i }));
    await waitFor(() =>
      expect(useBatchStore.getState().outputStatus).toBe("ready"),
    );
    const selected = useBatchStore.getState().batch!.combinedPdf!;

    await userEvent.click(screen.getByRole("button", { name: "PREVIEW" }));
    const frame = screen.getByTitle(/8 labels \/ 2 a4 sheets/i);
    expect(frame).toHaveAttribute("src", selected.objectUrl!);
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "DOWNLOAD PDF" }),
      ).toBeEnabled(),
    );

    const anchorClick = vi.fn();
    const createElement = document.createElement.bind(document);
    vi.spyOn(document, "createElement").mockImplementation((tag: string) => {
      const element = createElement(tag) as HTMLAnchorElement;
      if (tag === "a") element.click = anchorClick;
      return element;
    });
    await userEvent.click(screen.getByRole("button", { name: "DOWNLOAD PDF" }));
    expect(anchorClick).toHaveBeenCalledTimes(1);
    vi.mocked(document.createElement).mockRestore();

    const printWindow = {
      focus: vi.fn(),
      print: vi.fn(),
      addEventListener: vi.fn(),
    };
    vi.stubGlobal(
      "open",
      vi.fn(() => printWindow),
    );
    await userEvent.click(screen.getByRole("button", { name: "PRINT ALL" }));
    expect(window.open).toHaveBeenCalledWith(selected.objectUrl, "_blank");
    expect(
      screen.getByText(/print window opened for 8 labels \/ 2 a4 sheets/i),
    ).toBeInTheDocument();
  });

  it("downloads the four-up artifact under its own filename", async () => {
    renderPanel();
    await userEvent.click(screen.getByRole("radio", { name: /A4/i }));
    await waitFor(() =>
      expect(
        screen.getByRole("heading", { name: "PRINT_READY_LABELS_A4.pdf" }),
      ).toBeInTheDocument(),
    );
    expect(useBatchStore.getState().batch?.combinedPdf?.filename).toBe(
      "PRINT_READY_LABELS_A4.pdf",
    );
  });

  it("restores the cached standard artifact when switching back", async () => {
    renderPanel();
    await userEvent.click(screen.getByRole("radio", { name: /A4/i }));
    await waitFor(() => expect(assembleMock).toHaveBeenCalledTimes(1));

    await userEvent.click(screen.getByRole("radio", { name: /100 × 150 MM/i }));

    await waitFor(() =>
      expect(screen.getByText("8 LABELS / 8 LABEL PAGES")).toBeInTheDocument(),
    );
    expect(useBatchStore.getState().batch?.combinedPdf?.layout).toBe(
      "label_100x150",
    );
    // The standard variant was already cached, so nothing was re-imposed.
    expect(assembleMock).toHaveBeenCalledTimes(1);
  });

  it("disables the output actions while a variant is generating", async () => {
    let release: ((artifact: CombinedPdfArtifact) => void) | undefined;
    assembleMock.mockImplementation(
      () => new Promise<CombinedPdfArtifact>((resolve) => (release = resolve)),
    );
    renderPanel();

    await userEvent.click(screen.getByRole("radio", { name: /A4/i }));

    for (const name of ["PREVIEW", "DOWNLOAD PDF", "PRINT ALL"]) {
      expect(screen.getByRole("button", { name })).toBeDisabled();
    }
    expect(
      screen.getByText(/GENERATING A4 \/ 4 PER SHEET OUTPUT/i),
    ).toBeInTheDocument();
    // The selector itself stays usable so a slow run can be abandoned.
    expect(screen.getByRole("radio", { name: /100 × 150 MM/i })).toBeEnabled();

    release?.(artifactFor("a4_4up"));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "PREVIEW" })).toBeEnabled(),
    );
  });

  it("shows a recoverable error and never falls back to another format", async () => {
    assembleMock.mockRejectedValueOnce(new Error("imposition failed"));
    renderPanel();

    await userEvent.click(screen.getByRole("radio", { name: /A4/i }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/could not be generated/i);
    expect(useBatchStore.getState().batch?.combinedPdf?.layout).toBe(
      "label_100x150",
    );
    expect(screen.getByRole("button", { name: "PREVIEW" })).toBeDisabled();

    assembleMock.mockImplementation(async () => artifactFor("a4_4up"));
    await userEvent.click(screen.getByRole("button", { name: "RETRY" }));
    await waitFor(() =>
      expect(screen.getByText("8 LABELS / 2 A4 SHEETS")).toBeInTheDocument(),
    );
  });

  it("discards a slow generation that a newer choice superseded", async () => {
    let release: ((artifact: CombinedPdfArtifact) => void) | undefined;
    assembleMock.mockImplementationOnce(
      () => new Promise<CombinedPdfArtifact>((resolve) => (release = resolve)),
    );
    renderPanel();

    await userEvent.click(screen.getByRole("radio", { name: /A4/i }));
    await userEvent.click(screen.getByRole("radio", { name: /100 × 150 MM/i }));
    release?.(artifactFor("a4_4up"));

    await waitFor(() =>
      expect(screen.getByText("8 LABELS / 8 LABEL PAGES")).toBeInTheDocument(),
    );
    expect(useBatchStore.getState().batch?.combinedPdf?.layout).toBe(
      "label_100x150",
    );
  });

  it("revokes the replaced object URL when the store resets", async () => {
    renderPanel();
    await userEvent.click(screen.getByRole("radio", { name: /A4/i }));
    await waitFor(() =>
      expect(useBatchStore.getState().outputVariants.size).toBe(2),
    );

    const urls = [...useBatchStore.getState().outputVariants.values()].map(
      (artifact) => artifact.objectUrl,
    );
    useBatchStore.getState().reset();

    for (const url of urls) {
      expect(URL.revokeObjectURL).toHaveBeenCalledWith(url);
    }
  });
});

describe("OutputPanel automatic history retention", () => {
  it("automatically saves a completed generated PDF", async () => {
    renderPanel();

    await waitFor(() => expect(saveBatchToHistory).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(screen.getByText(/saved to history/i)).toBeInTheDocument(),
    );
    expect(
      screen.queryByRole("button", { name: /save to history/i }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "DOWNLOAD PDF" })).toBeEnabled();
  });

  it("keeps export actions locked when the credit-authorized save fails", async () => {
    vi.mocked(saveBatchToHistory).mockRejectedValueOnce(
      new Error("Your daily label credit limit has been reached."),
    );
    renderPanel();

    await waitFor(() =>
      expect(screen.getByText(/daily label credit limit/i)).toBeInTheDocument(),
    );
    expect(screen.getByRole("button", { name: "PREVIEW" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "DOWNLOAD PDF" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "PRINT ALL" })).toBeDisabled();
  });

  it("saves the newly selected layout once, without duplicating the batch", async () => {
    renderPanel();
    await waitFor(() => expect(saveBatchToHistory).toHaveBeenCalledTimes(1));

    await userEvent.click(screen.getByRole("radio", { name: /A4/i }));

    await waitFor(() => expect(saveBatchToHistory).toHaveBeenCalledTimes(2));
    const saved = vi.mocked(saveBatchToHistory).mock.calls[1]![0];
    expect(saved.combinedPdf?.layout).toBe("a4_4up");
    expect(saved.combinedPdf?.pageCount).toBe(2);
    expect(saved.combinedPdf?.labelCount).toBe(LABEL_COUNT);

    // Re-selecting a cached layout must not trigger a third save.
    await userEvent.click(screen.getByRole("radio", { name: /A4/i }));
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(saveBatchToHistory).toHaveBeenCalledTimes(2);
  });

  it("serializes history replacements so the newest layout is saved last", async () => {
    let releaseFirst: (() => void) | undefined;
    vi.mocked(saveBatchToHistory).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          releaseFirst = () =>
            resolve({
              id: "saved-standard",
            } as Awaited<ReturnType<typeof saveBatchToHistory>>);
        }),
    );
    renderPanel();
    await waitFor(() => expect(saveBatchToHistory).toHaveBeenCalledTimes(1));

    await userEvent.click(screen.getByRole("radio", { name: /A4/i }));
    await waitFor(() =>
      expect(useBatchStore.getState().batch?.combinedPdf?.layout).toBe(
        "a4_4up",
      ),
    );

    // The A4 replacement waits for the older request instead of racing it.
    expect(saveBatchToHistory).toHaveBeenCalledTimes(1);
    releaseFirst?.();
    await waitFor(() => expect(saveBatchToHistory).toHaveBeenCalledTimes(2));
    expect(
      vi.mocked(saveBatchToHistory).mock.calls[1]![0].combinedPdf?.layout,
    ).toBe("a4_4up");
  });
});

function artifactFor(layout: OutputLayout): CombinedPdfArtifact {
  const standard = layout === "label_100x150";
  return {
    filename: standard ? "PRINT_READY_LABELS.pdf" : "PRINT_READY_LABELS_A4.pdf",
    pdfBytes: new Uint8Array([37, 80, 68, 70, 45]),
    pageCount: standard ? LABEL_COUNT : Math.ceil(LABEL_COUNT / 4),
    labelCount: LABEL_COUNT,
    layout,
    widthPt: standard ? 283.464 : 595.2755905511812,
    heightPt: standard ? 425.197 : 841.8897637795277,
  };
}

function readyBatch(): Batch {
  return {
    id: "auto-save-batch",
    status: "ready",
    createdAt: "2026-10-07T00:00:00Z",
    updatedAt: "2026-10-07T00:00:00Z",
    documents: [],
    labels: Array.from({ length: LABEL_COUNT }, (_item, index) => ({
      id: `label-${index}`,
      documentId: "document-1",
      pageId: `page-${index}`,
      marketplace: "flipkart",
      status: "success",
      outputOrder: index,
      sourcePageNumber: index + 1,
      region: { boundsPt: { x: 0, y: 0, width: 100, height: 100 } },
      normalized: {
        id: `normalized-${index}`,
        outputOrder: index,
        pdfBytes: new Uint8Array([37, 80, 68, 70, 45]),
      },
    })),
    combinedPdf: {
      ...artifactFor("label_100x150"),
      objectUrl: "blob:standard",
    },
    events: [],
    counts: {
      documentsTotal: 1,
      documentsReady: 1,
      documentsFailed: 0,
      sourcePages: LABEL_COUNT,
      labelsDiscovered: LABEL_COUNT,
      labelsReady: LABEL_COUNT,
      reviewRequired: 0,
      labelsFailed: 0,
    },
  } as unknown as Batch;
}
