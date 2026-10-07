import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import path from "node:path";

const amazonFixture = path.resolve(
  process.cwd(),
  "docs",
  "fixtures",
  "amazon",
  "document (6).pdf",
);

test("keeps the Amazon label and excludes its supplier invoice", async ({
  page,
}) => {
  await page.goto("/app");
  await page.locator('input[type="file"]').setInputFiles({
    name: path.basename(amazonFixture),
    mimeType: "application/pdf",
    buffer: await readFile(amazonFixture),
  });

  await expect(page.locator(".batch-actions .status-badge")).toContainText(
    "ready",
    { timeout: 45_000 },
  );
  await expect(summaryValue(page, "PDFS")).toHaveText("01");
  await expect(summaryValue(page, "SOURCE PAGES")).toHaveText("02");
  await expect(summaryValue(page, "LABELS FOUND")).toHaveText("01");
  await expect(summaryValue(page, "REVIEW")).toHaveText("00");
  await expect(summaryValue(page, "FAILED")).toHaveText("00");

  await page.getByText("CLASSIFY", { exact: true }).click();
  await expect(
    page.getByText(/Detected Amazon with 100% evidence confidence/),
  ).toBeVisible();

  await page.getByText("EXTRACT", { exact: true }).click();
  await expect(
    page.getByText(/Amazon supplier-only invoice excluded/),
  ).toBeVisible();
  await expect(
    page.getByText(/trimmed measured outer whitespace/),
  ).toBeVisible();
});

function summaryValue(page: import("@playwright/test").Page, label: string) {
  return page
    .locator(".batch-summary dl div")
    .filter({ hasText: label })
    .locator("dd");
}
