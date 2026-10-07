import type { Metadata } from "next";
import type { ReactNode } from "react";
import {
  absoluteUrl,
  SITE_DESCRIPTION,
  SITE_KEYWORDS,
  SITE_NAME,
  SITE_TITLE,
  SITE_URL,
} from "@/lib/site";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: SITE_URL,
  applicationName: SITE_NAME,
  title: {
    default: SITE_TITLE,
    template: `%s | ${SITE_NAME}`,
  },
  description: SITE_DESCRIPTION,
  keywords: [...SITE_KEYWORDS],
  authors: [
    {
      name: "Label Normalizer contributors",
      url: "https://github.com/webdesinoprojects/flipkart-amazon",
    },
  ],
  creator: "Label Normalizer contributors",
  publisher: SITE_NAME,
  category: "Business software",
  classification: "Shipping and ecommerce productivity tool",
  referrer: "strict-origin-when-cross-origin",
  formatDetection: {
    address: false,
    email: false,
    telephone: false,
  },
  alternates: {
    canonical: "/",
    types: {
      "text/plain": [
        { url: "/llms.txt", title: `${SITE_NAME} information for LLMs` },
      ],
    },
  },
  manifest: "/manifest.webmanifest",
  icons: {
    icon: [{ url: "/favicon.svg", type: "image/svg+xml", sizes: "any" }],
    shortcut: ["/favicon.svg"],
    apple: [{ url: "/apple-icon", type: "image/png", sizes: "180x180" }],
  },
  openGraph: {
    type: "website",
    url: "/",
    siteName: SITE_NAME,
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
    locale: "en_IN",
    images: [
      {
        url: "/opengraph-image",
        width: 1200,
        height: 630,
        alt: `${SITE_NAME} converts marketplace shipping PDFs into print-ready labels.`,
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
    images: ["/opengraph-image"],
  },
  robots: {
    index: true,
    follow: true,
    nocache: false,
    googleBot: {
      index: true,
      follow: true,
      noimageindex: false,
      "max-image-preview": "large",
      "max-snippet": -1,
      "max-video-preview": -1,
    },
  },
  verification: {
    ...(process.env.GOOGLE_SITE_VERIFICATION
      ? { google: process.env.GOOGLE_SITE_VERIFICATION }
      : {}),
    ...(process.env.BING_SITE_VERIFICATION
      ? {
          other: {
            "msvalidate.01": process.env.BING_SITE_VERIFICATION,
          },
        }
      : {}),
  },
  other: {
    "mobile-web-app-capable": "yes",
    "apple-mobile-web-app-title": SITE_NAME,
  },
};

const structuredData = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "WebSite",
      "@id": `${absoluteUrl("/")}#website`,
      url: absoluteUrl("/"),
      name: SITE_NAME,
      alternateName: "Marketplace Shipping Label Normalizer",
      description: SITE_DESCRIPTION,
      inLanguage: "en-IN",
    },
    {
      "@type": "WebApplication",
      "@id": `${absoluteUrl("/app")}#application`,
      url: absoluteUrl("/app"),
      name: SITE_NAME,
      alternateName: "Marketplace Shipping Label Normalizer",
      description: SITE_DESCRIPTION,
      applicationCategory: "BusinessApplication",
      applicationSubCategory: "Shipping label preparation",
      operatingSystem: "Any operating system with a modern web browser",
      browserRequirements:
        "Requires JavaScript and a modern browser with WebAssembly support.",
      softwareVersion: "0.1.0",
      isAccessibleForFree: true,
      image: absoluteUrl("/opengraph-image"),
      featureList: [
        "Flipkart E-Kart label extraction",
        "Amazon shipping-label page classification",
        "Meesho content-bound whitespace trimming",
        "Mixed marketplace PDF batches",
        "PDF-native 100 x 150 mm portrait output",
        "Barcode and QR validation",
        "Manual crop and rotation review",
        "Combined print-ready PDF download and printing",
      ],
      offers: {
        "@type": "Offer",
        price: "0",
        priceCurrency: "INR",
      },
      publisher: {
        "@type": "Organization",
        name: "Label Normalizer contributors",
        url: "https://github.com/webdesinoprojects/flipkart-amazon",
      },
    },
  ],
};

export default function RootLayout({
  children,
}: {
  readonly children: ReactNode;
}) {
  return (
    <html lang="en" data-scroll-behavior="smooth">
      <body>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify(structuredData).replaceAll("<", "\\u003c"),
          }}
        />
        {children}
      </body>
    </html>
  );
}
