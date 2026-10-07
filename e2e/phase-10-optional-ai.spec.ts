import { expect, test } from "@playwright/test";

const serverBaseUrl = process.env.SERVER_FALLBACK_BASE_URL;

test.describe("Phase 10 optional vision fallback", () => {
  test.skip(
    !serverBaseUrl,
    "Set SERVER_FALLBACK_BASE_URL to the Caddy origin.",
  );

  test("boots without cloud keys and keeps the local workflow available", async ({
    page,
    request,
  }) => {
    const health = await request.get(`${serverBaseUrl}/health/ready`);
    expect(health.ok()).toBe(true);
    await expect(health.json()).resolves.toMatchObject({
      ai_enabled: false,
      vision_providers: [],
      storage: "local",
      queue: "celery-valkey",
    });

    await page.goto(`${serverBaseUrl}/app`);
    await expect(page.getByText("PHASE 10")).toBeVisible();
    await expect(page.getByText("01 / LOCAL PROCESSING")).toBeVisible();
    await expect(page.getByText("02 / PDF-NATIVE OUTPUT")).toBeVisible();
    await expect(page.getByText("03 / NO SCREENSHOTS FOR PRINT")).toBeVisible();
    await expect(page.getByText("DROP MARKETPLACE PDFS HERE")).toBeVisible();
  });
});
