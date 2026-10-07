import { expect, test } from "@playwright/test";

for (const viewport of [
  { width: 1440, height: 900 },
  { width: 390, height: 844 },
]) {
  test(`landing page works at ${viewport.width} × ${viewport.height}`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto("/");

    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await page.locator('main a[href="/app"]').first().click();
    await expect(page).toHaveURL(/\/app$/, { timeout: 30_000 });
    await expect(
      page.getByLabel("Select or drop marketplace PDF files"),
    ).toBeVisible();
    await page.goto("/");
    for (const id of [
      "workflow",
      "marketplaces",
      "features",
      "pricing",
      "privacy",
    ]) {
      await expect(page.locator(`#${id}`)).toBeAttached();
      if (viewport.width <= 720) {
        await page.getByRole("button", { name: "Open menu" }).click();
        await page
          .locator(`nav[aria-label="Mobile navigation"] a[href="#${id}"]`)
          .click();
      } else {
        await page
          .locator(`nav[aria-label="Main navigation"] a[href="#${id}"]`)
          .click();
      }
      await expect(page).toHaveURL(new RegExp(`#${id}$`));
    }
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    expect(
      await page
        .locator("h1")
        .evaluate((heading) => heading.scrollWidth <= heading.clientWidth),
    ).toBe(true);
    await expect(
      page.getByRole("button", { name: "Switch to light mode" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Switch to light mode" }).click();
    await expect(page.locator("#marketing-page")).toHaveAttribute(
      "data-theme",
      "light",
    );
    await expect(
      page.getByRole("button", { name: "Switch to dark mode" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Switch to dark mode" }).click();
    await expect(page.locator("#marketing-page")).toHaveAttribute(
      "data-theme",
      "dark",
    );
    expect(errors).toEqual([]);
  });
}

test("reduced motion hides and pauses the background video", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  const animation = await page
    .locator("h1 span")
    .first()
    .evaluate((element) => getComputedStyle(element).animationDuration);
  expect(Number.parseFloat(animation)).toBeLessThanOrEqual(0.001);
  await expect(page.locator("video")).toBeHidden();
  expect(
    await page
      .locator("video")
      .evaluate((video) => (video as HTMLVideoElement).paused),
  ).toBe(true);
});

test("keyboard users can skip to content", async ({ page }) => {
  await page.goto("/");
  await page.keyboard.press("Tab");
  const skipLink = page.getByRole("link", { name: "Skip to content" });
  await expect(skipLink).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/#main$/);
});

test("unknown routes show a safe recovery screen", async ({ page }) => {
  const response = await page.goto("/this-page-does-not-exist");
  expect(response?.status()).toBe(404);
  await expect(
    page.getByRole("heading", { name: "NOTHING AT THIS ADDRESS." }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: /BACK TO HOME/ }),
  ).toHaveAttribute("href", "/");
  await expect(page.locator("main")).not.toContainText("Error:");
});
