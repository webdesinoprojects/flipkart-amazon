import { expect, test } from "@playwright/test";

test("publishes complete search, social, app, and LLM discovery metadata", async ({
  page,
  request,
}) => {
  await page.goto("/");

  await expect(page).toHaveTitle(
    "SellerLabel | Crop Shipping Labels for Easy Printing",
  );
  await expect(page.locator('meta[name="description"]')).toHaveAttribute(
    "content",
    /Flipkart, Amazon and Meesho shipping labels/,
  );
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
    "href",
    "https://sellerlabel.in",
  );
  await expect(page.locator('meta[property="og:title"]')).toHaveAttribute(
    "content",
    /SellerLabel/,
  );
  await expect(page.locator('meta[name="twitter:card"]')).toHaveAttribute(
    "content",
    "summary_large_image",
  );
  await expect(page.locator('link[rel="icon"]')).toHaveAttribute(
    "href",
    "/favicon.svg",
  );
  await expect(page.locator('link[rel="manifest"]')).toHaveAttribute(
    "href",
    "/manifest.webmanifest",
  );

  const structuredData = JSON.parse(
    (await page
      .locator('script[type="application/ld+json"]')
      .first()
      .textContent()) ?? "{}",
  ) as { "@graph"?: Array<{ "@type"?: string }> };
  expect(structuredData["@graph"]?.map((entry) => entry["@type"])).toEqual([
    "WebSite",
    "WebApplication",
  ]);

  const expectedRoutes = [
    ["/robots.txt", /Sitemap: .*\/sitemap\.xml/],
    ["/sitemap.xml", /sellerlabel\.in/],
    ["/manifest.webmanifest", /SellerLabel/],
    ["/llms.txt", /helps ecommerce sellers/],
    ["/llms-full.txt", /four labels per A4 sheet/],
  ] as const;

  for (const [path, expectedContent] of expectedRoutes) {
    const response = await request.get(path);
    expect(response.ok(), `${path} should be reachable`).toBe(true);
    expect(await response.text()).toMatch(expectedContent);
  }
});
