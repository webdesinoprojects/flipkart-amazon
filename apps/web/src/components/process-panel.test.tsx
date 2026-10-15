import type { Batch } from "@label-normalizer/core";
import { fireEvent, render, screen } from "@testing-library/react";
import { ProcessPanel } from "./process-panel";

vi.mock("@label-normalizer/core", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@label-normalizer/core")>();
  return {
    ...actual,
    calculateProcessingProgress: () => 50,
    projectStage: () => ({
      status: "running",
      latestMessage: "Preparing labels",
      events: [],
    }),
  };
});

it("keeps even the running stage collapsed until a seller opens it", () => {
  const batch = { status: "processing", events: [] } as unknown as Batch;
  const { container } = render(<ProcessPanel batch={batch} />);
  const firstStage = container.querySelector("details.stage-row");

  expect(firstStage).not.toHaveAttribute("open");
  fireEvent.click(screen.getByText("INGEST"));
  expect(firstStage).toHaveAttribute("open");
});
