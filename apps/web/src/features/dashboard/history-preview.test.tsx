import { fireEvent, render, screen } from "@testing-library/react";
import { HistoryActions } from "./history-preview";

describe("HistoryActions", () => {
  it("opens an in-page PDF preview drawer and retains a download action", () => {
    render(
      <HistoryActions
        batchLabel="BATCH-123"
        downloadUrl="/api/v1/history/batches/123/output"
        filename="PRINT_READY_LABELS_A4.pdf"
        previewUrl="/api/v1/history/batches/123/preview"
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /preview/i }));
    expect(
      screen.getByRole("dialog", { name: "PRINT_READY_LABELS_A4.pdf" }),
    ).toBeInTheDocument();
    expect(screen.getByTitle(/PDF preview for BATCH-123/i)).toHaveAttribute(
      "src",
      "/api/v1/history/batches/123/preview",
    );
    expect(
      screen.getAllByRole("link", { name: /download/i })[0],
    ).toHaveAttribute("href", "/api/v1/history/batches/123/output");
  });
});
