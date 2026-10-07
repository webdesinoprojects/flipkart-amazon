import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import path from "node:path";

const fixtures = [
  path.resolve(
    process.cwd(),
    "docs/fixtures/flipkart/invoice_labels_1786940253611.pdf",
  ),
  path.resolve(process.cwd(), "docs/fixtures/amazon/document (6).pdf"),
  path.resolve(
    process.cwd(),
    "docs/fixtures/meesho/Sub_Order_Labels_0f336246-9e3a-430a-adb2-7928fb25be90.pdf",
  ),
];

test("processes a real mixed marketplace batch in one operation", async ({
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
  await expect(summaryValue(page, "PDFS")).toHaveText("03");
  await expect(summaryValue(page, "SOURCE PAGES")).toHaveText("08");
  await expect(summaryValue(page, "LABELS FOUND")).toHaveText("07");
  // This real Meesho fixture has no decodable machine-readable code after
  // normalization. Keeping it in review is the required safe outcome.
  await expect(summaryValue(page, "REVIEW")).toHaveText("01");
  await expect(summaryValue(page, "FAILED")).toHaveText("00");
  await expect(page.getByText("07 / meesho")).toBeVisible();

  await page.getByText("CLASSIFY", { exact: true }).click();
  for (const marketplace of ["Flipkart", "Amazon", "Meesho"]) {
    await expect(
      page.getByText(new RegExp(`Detected ${marketplace}`)),
    ).toBeVisible();
  }

  await page.getByText("EXTRACT", { exact: true }).click();
  await expect(
    page.getByText(/Found E-Kart label boundary/).first(),
  ).toBeVisible();
  await expect(
    page.getByText(/Amazon supplier-only invoice excluded/),
  ).toBeVisible();
  await expect(page.getByText(/Found Meesho package label/)).toBeVisible();
});

function summaryValue(page: import("@playwright/test").Page, label: string) {
  return page
    .locator(".batch-summary dl div")
    .filter({ hasText: label })
    .locator("dd");
}
