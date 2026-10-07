import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { PDFDocument } from "pdf-lib";

const fixtures = [
  "docs/fixtures/flipkart/invoice_labels_1786940253611.pdf",
  "docs/fixtures/amazon/document (6).pdf",
  "docs/fixtures/meesho/Sub_Order_Labels_0c77f231-376f-4b40-b41d-cdc02a9a998d.pdf",
].map((fixture) => path.resolve(process.cwd(), fixture));

test("previews, downloads, and invokes print for the final mixed PDF", async ({
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
    { timeout: 90_000 },
  );

  const output = page.getByRole("region", { name: "PRINT_READY_LABELS.pdf" });
  await expect(output).toContainText(
    "3 PDFs / 8 SOURCE PAGES / 7 LABELS / 7 READY / 0 REVIEW / 0 FAILED",
  );
  await expect(output.locator(".label-result")).toHaveCount(7);
  await output.getByRole("button", { name: "LIST", exact: true }).click();
  await expect(output.locator(".label-results")).toHaveClass(
    /label-results--list/,
  );

  await output.getByRole("button", { name: "PREVIEW", exact: true }).click();
  await expect(
    output.getByTitle("Combined PDF preview, 7 pages"),
  ).toBeVisible();

  const downloadPromise = page.waitForEvent("download");
  await output.getByRole("button", { name: "DOWNLOAD PDF" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("PRINT_READY_LABELS.pdf");
  const downloadedPath = await download.path();
  expect(downloadedPath).not.toBeNull();
  if (downloadedPath) {
    const document = await PDFDocument.load(await readFile(downloadedPath));
    expect(document.getPageCount()).toBe(7);
    for (const pdfPage of document.getPages()) {
      expect(pdfPage.getWidth()).toBeCloseTo(283.464566929, 6);
      expect(pdfPage.getHeight()).toBeCloseTo(425.196850394, 6);
    }
  }

  await page.evaluate(() => {
    const browserWindow = window as typeof window & {
      __printAllInvoked?: boolean;
    };
    window.open = (() =>
      ({
        addEventListener: (_name: string, callback: () => void) => callback(),
        focus: () => undefined,
        print: () => {
          browserWindow.__printAllInvoked = true;
        },
      }) as unknown as Window) as typeof window.open;
  });
  await output.getByRole("button", { name: "PRINT ALL" }).click();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as typeof window & { __printAllInvoked?: boolean })
            .__printAllInvoked,
      ),
    )
    .toBe(true);
  await expect(output.getByRole("status")).toContainText("Print window opened");
});
