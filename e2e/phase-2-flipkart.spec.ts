import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import path from "node:path";

const flipkartFixture = path.resolve(
  process.cwd(),
  "docs",
  "fixtures",
  "flipkart",
  "invoice_labels_1786940253611.pdf",
);

test("processes every Flipkart page while isolating an invalid PDF", async ({
  page,
}) => {
  await page.goto("/app");
  const flipkartBytes = await readFile(flipkartFixture);
  await page.locator('input[type="file"]').setInputFiles([
    {
      name: path.basename(flipkartFixture),
      mimeType: "application/pdf",
      buffer: flipkartBytes,
    },
    {
      name: "broken.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from("not a pdf"),
    },
  ]);

  await expect(page.locator(".batch-actions .status-badge")).toContainText(
    "ready",
    { timeout: 45_000 },
  );
  await expect(summaryValue(page, "PDFS")).toHaveText("02");
  await expect(summaryValue(page, "SOURCE PAGES")).toHaveText("05");
  await expect(summaryValue(page, "LABELS FOUND")).toHaveText("05");
  await expect(summaryValue(page, "REVIEW")).toHaveText("00");
  await expect(summaryValue(page, "FAILED")).toHaveText("01");

  await page.getByText("CLASSIFY", { exact: true }).click();
  await expect(
    page.getByText(/Detected Flipkart with 100% evidence confidence/),
  ).toBeVisible();

  await page.getByText("EXTRACT", { exact: true }).click();
  await expect(
    page
      .getByText(/Found E-Kart label boundary; lower Tax Invoice excluded/)
      .first(),
  ).toBeVisible();
  await expect(
    page.locator(".document-row").filter({ hasText: "broken.pdf" }),
  ).toContainText("failed");
});

function summaryValue(page: import("@playwright/test").Page, label: string) {
  return page
    .locator(".batch-summary dl div")
    .filter({ hasText: label })
    .locator("dd");
}
