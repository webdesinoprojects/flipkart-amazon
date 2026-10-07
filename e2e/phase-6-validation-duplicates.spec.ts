import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import path from "node:path";

const first = path.resolve(
  process.cwd(),
  "docs/fixtures/amazon/document (6).pdf",
);
const duplicate = path.resolve(
  process.cwd(),
  "docs/fixtures/amazon/document (6) (1).pdf",
);

test("validates at 203 DPI and warns without deleting a duplicate", async ({
  page,
}) => {
  await page.goto("/app");
  await page.locator('input[type="file"]').setInputFiles([
    {
      name: path.basename(first),
      mimeType: "application/pdf",
      buffer: await readFile(first),
    },
    {
      name: path.basename(duplicate),
      mimeType: "application/pdf",
      buffer: await readFile(duplicate),
    },
  ]);

  await expect(page.locator(".batch-actions .status-badge")).toContainText(
    "ready",
    { timeout: 90_000 },
  );
  await expect(summaryValue(page, "LABELS FOUND")).toHaveText("02");
  await expect(summaryValue(page, "READY LABELS")).toHaveText("02");
  await expect(summaryValue(page, "REVIEW")).toHaveText("00");
  await expect(page.getByTestId("combined-artifact")).toContainText("2 PAGES");

  await page.getByText("VALIDATE", { exact: true }).click();
  await expect(
    page.getByText(/Barcode\/QR validation passed at 203 DPI/).first(),
  ).toBeVisible();
  await expect(
    page.getByText(/Potential duplicate label detected and retained/),
  ).toBeVisible();
});

function summaryValue(page: import("@playwright/test").Page, label: string) {
  return page
    .locator(".batch-summary dl div")
    .filter({ hasText: label })
    .locator("dd");
}
