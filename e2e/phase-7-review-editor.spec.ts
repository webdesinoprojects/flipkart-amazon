import { expect, test } from "@playwright/test";
import { PDFDocument, StandardFonts } from "pdf-lib";

test("edits, rotates, re-detects, downloads, and approves a review label", async ({
  page,
}) => {
  await page.goto("/app");
  await page.locator('input[type="file"]').setInputFiles({
    name: "unknown-layout.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from(await createUnknownPdf()),
  });

  await expect(page.locator(".batch-actions .status-badge")).toContainText(
    "ready",
    { timeout: 60_000 },
  );
  await expect(summaryValue(page, "LABELS FOUND")).toHaveText("01");
  await expect(summaryValue(page, "READY LABELS")).toHaveText("00");
  await expect(summaryValue(page, "REVIEW")).toHaveText("01");
  await expect(page.getByText("MANUAL REVIEW", { exact: true })).toBeVisible();

  const overlay = page.getByTestId("crop-overlay");
  const before = await overlay.getAttribute("style");
  const handle = overlay.getByRole("button", { name: "Resize crop" });
  await handle.scrollIntoViewIfNeeded();
  const handleBox = await handle.boundingBox();
  expect(handleBox).not.toBeNull();
  if (handleBox) {
    await page.mouse.move(
      handleBox.x + handleBox.width / 2,
      handleBox.y + handleBox.height / 2,
    );
    await page.mouse.down();
    await page.waitForTimeout(100);
    await page.mouse.move(handleBox.x - 35, handleBox.y - 45, { steps: 4 });
    await page.mouse.up();
  }
  await expect.poll(() => overlay.getAttribute("style")).not.toBe(before);

  await page.getByRole("button", { name: "90°" }).click();
  await expect(page.getByRole("button", { name: "90°" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "DOWNLOAD LABEL" }).click();
  await expect((await downloadPromise).suggestedFilename()).toBe(
    "LABEL_01.pdf",
  );

  await page.getByRole("button", { name: "RE-DETECT" }).click();
  await expect(page.getByText(/Re-detection complete/)).toBeVisible({
    timeout: 30_000,
  });
  await page.getByRole("button", { name: "APPROVE" }).click();

  await expect(page.getByText("MANUAL REVIEW", { exact: true })).toHaveCount(0);
  await expect(summaryValue(page, "READY LABELS")).toHaveText("01");
  await expect(summaryValue(page, "REVIEW")).toHaveText("00");
  await expect(page.getByTestId("combined-artifact")).toContainText("1 PAGES");
});

test("skips an uncertain label without failing the batch", async ({ page }) => {
  await page.goto("/app");
  await page.locator('input[type="file"]').setInputFiles({
    name: "skip-layout.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from(await createUnknownPdf()),
  });
  await expect(page.locator(".batch-actions .status-badge")).toContainText(
    "ready",
    { timeout: 60_000 },
  );
  await page.getByRole("button", { name: "SKIP", exact: true }).click();
  await expect(page.getByText("MANUAL REVIEW", { exact: true })).toHaveCount(0);
  await expect(summaryValue(page, "READY LABELS")).toHaveText("00");
  await expect(summaryValue(page, "REVIEW")).toHaveText("00");
  await expect(summaryValue(page, "FAILED")).toHaveText("00");
  await expect(page.getByTestId("combined-artifact")).toHaveCount(0);
});

async function createUnknownPdf(): Promise<Uint8Array> {
  const document = await PDFDocument.create();
  const font = await document.embedFont(StandardFonts.Courier);
  const page = document.addPage([595, 842]);
  page.drawRectangle({
    x: 40,
    y: 120,
    width: 515,
    height: 620,
    borderWidth: 2,
  });
  page.drawText("UNRECOGNIZED PACKAGE LABEL", {
    x: 70,
    y: 680,
    size: 20,
    font,
  });
  page.drawText("MANUAL REVIEW REQUIRED", {
    x: 70,
    y: 640,
    size: 14,
    font,
  });
  return document.save();
}

function summaryValue(page: import("@playwright/test").Page, label: string) {
  return page
    .locator(".batch-summary dl div")
    .filter({ hasText: label })
    .locator("dd");
}
