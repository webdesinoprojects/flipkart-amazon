const DEFAULT_SITE_URL = "https://sellerlabel.in";

export const SITE_NAME = "SellerLabel";
export const SITE_TITLE =
  "SellerLabel | Crop Shipping Labels for Easy Printing";
export const SITE_DESCRIPTION =
  "Crop Flipkart, Amazon and Meesho shipping labels, remove invoice pages, and create sharp 100 x 150 mm or A4 print-ready PDFs.";

export const SITE_URL = (() => {
  const configuredUrl = process.env.NEXT_PUBLIC_SITE_URL?.trim();

  try {
    return new URL(configuredUrl || DEFAULT_SITE_URL);
  } catch {
    return new URL(DEFAULT_SITE_URL);
  }
})();

export function absoluteUrl(path = "/"): string {
  return new URL(path, SITE_URL).toString();
}
