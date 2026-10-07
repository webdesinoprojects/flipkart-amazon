import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import path from "node:path";

const fixtures = [
  "docs/fixtures/flipkart/invoice_labels_1786940253611.pdf",
  "docs/fixtures/amazon/document (6).pdf",
  "docs/fixtures/meesho/Sub_Order_Labels_5dc607bf-c639-4e34-85d4-ba221312a317.pdf",
].map((fixture) => path.resolve(process.cwd(), fixture));

test("normalizes and assembles every discovered label natively", async ({
  page,
}) => {
  await page.goto("/app");
  await page.locator('input[type="file"]').setInputFiles(
    await Promise.all(
      fixtures.map(async (fixture) => ({
        name: path.basename(fixture),
        mimeType: "application/pdf",
        buffer: await readFile(fixture),
      })),
    ),
  );

  await expect(page.locator(".batch-actions .status-badge")).toContainText(
    "ready",
    { timeout: 60_000 },
  );
  await expect(summaryValue(page, "LABELS FOUND")).toHaveText("07");
  await expect(summaryValue(page, "READY LABELS")).toHaveText("07");
  await expect(summaryValue(page, "REVIEW")).toHaveText("00");
  await expect(summaryValue(page, "FAILED")).toHaveText("00");
  await expect(page.getByTestId("combined-artifact")).toContainText(
    "PRINT_READY_LABELS.pdf / 7 PAGES / 100 × 150 MM",
  );

  await page.getByText("NORMALIZE", { exact: true }).click();
  await expect(
    page
      .getByText(/Normalized to 100 × 150 mm using native PDF content/)
      .first(),
  ).toBeVisible();

  await page.getByText("ASSEMBLE", { exact: true }).click();
  await expect(page.getByText(/assembled with 7 pages/).first()).toBeVisible();
  await expect(page.getByText("COMPLETE", { exact: true })).toBeVisible();
});

function summaryValue(page: import("@playwright/test").Page, label: string) {
  return page
    .locator(".batch-summary dl div")
    .filter({ hasText: label })
    .locator("dd");
}
