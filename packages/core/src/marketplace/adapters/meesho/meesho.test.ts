// @vitest-environment node

import { readFile } from "node:fs/promises";
import path from "node:path";
import { createCanvas } from "@napi-rs/canvas";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import type { DocumentContext, PageContext } from "../../../adapter";
import { detectRasterBounds } from "../../../raster-bounds";
import type {
  PdfDocumentAnalysis,
  PdfPageAnalysis,
  PdfTextItem,
} from "../../../types";
import { selectMarketplaceAdapter } from "../../registry";
import { MeeshoAdapter, MEESHO_EXCHANGE_LAYOUT_V1, MEESHO_LAYOUT_V1 } from ".";

const FIXTURES = [
  "Sub_Order_Labels_0c77f231-376f-4b40-b41d-cdc02a9a998d.pdf",
  "Sub_Order_Labels_0f336246-9e3a-430a-adb2-7928fb25be90.pdf",
  "Sub_Order_Labels_5dc607bf-c639-4e34-85d4-ba221312a317.pdf",
] as const;

describe("MeeshoAdapter golden fixtures", () => {
  const adapter = new MeeshoAdapter();

  for (const fixture of FIXTURES) {
    it(`retains all package content and trims outer whitespace in ${fixture}`, async () => {
      const analysis = await readFixture(fixture);
      const documentContext = createDocumentContext(analysis, fixture);
      const detection = await adapter.detectDocument(documentContext);
      const selected = await selectMarketplaceAdapter(documentContext);
      const page = analysis.pages[0];
      expect(page).toBeDefined();
      if (!page) return;
      const pageContext = createPageContext(documentContext, page);
      const classification = await adapter.classifyPage(pageContext);
      const regions = await adapter.findPrintableRegions(pageContext);

      expect(analysis.pages).toHaveLength(1);
      expect(detection.marketplace).toBe("meesho");
      expect(detection.layoutFingerprint).toBe(MEESHO_LAYOUT_V1);
      expect(selected.adapter.id).toBe("meesho");
      expect(classification.pageKind).toBe("shipping_plus_invoice");
      expect(regions).toHaveLength(1);
      expect(regions[0]?.requiresReview).toBe(false);
      expect(regions[0]?.layoutFingerprint).toBe(MEESHO_LAYOUT_V1);
      expect(regions[0]?.boundsPt.x).toBeLessThan(20);
      expect(regions[0]?.boundsPt.y).toBeGreaterThan(220);
      expect(regions[0]?.boundsPt.y).toBeLessThan(270);
      expect(regions[0]?.boundsPt.width).toBeGreaterThan(560);
      expect(regions[0]?.boundsPt.height).toBeGreaterThan(560);
      expect(regions[0]?.boundsPt.height).toBeLessThan(630);
    });
  }

  it("requires review when stable section geometry drifts", async () => {
    const source = await readFixture(FIXTURES[0]);
    const page = source.pages[0];
    expect(page).toBeDefined();
    if (!page) return;
    const drifted: PdfPageAnalysis = {
      ...page,
      geometry: {
        ...page.geometry,
        widthPt: 612,
        heightPt: 792,
        mediaBox: { x: 0, y: 0, width: 612, height: 792 },
      },
    };
    const analysis = { ...source, pages: [drifted] };
    const documentContext = createDocumentContext(analysis, "drifted.pdf");
    const [region] = await adapter.findPrintableRegions(
      createPageContext(documentContext, drifted),
    );

    expect(region?.layoutFingerprint).toBeUndefined();
    expect(region?.requiresReview).toBe(true);
  });

  it("retains a Meesho exchange-only label for manual review", async () => {
    const page = createExchangePage();
    const analysis: PdfDocumentAnalysis = {
      documentId: "exchange-document",
      pages: [page],
    };
    const documentContext = createDocumentContext(
      analysis,
      "Sub_Order_Labels_exchange.pdf",
    );
    const detection = await adapter.detectDocument(documentContext);
    const selected = await selectMarketplaceAdapter(documentContext);
    const pageContext = createPageContext(documentContext, page);
    const classification = await adapter.classifyPage(pageContext);
    const regions = await adapter.findPrintableRegions(pageContext);

    expect(detection.marketplace).toBe("meesho");
    expect(detection.layoutFingerprint).toBe(MEESHO_EXCHANGE_LAYOUT_V1);
    expect(selected.adapter.id).toBe("meesho");
    expect(classification.pageKind).toBe("shipping_label");
    expect(classification.layoutFingerprint).toBe(MEESHO_EXCHANGE_LAYOUT_V1);
    expect(regions).toHaveLength(1);
    expect(regions[0]?.requiresReview).toBe(true);
    expect(regions[0]?.boundsPt.height).toBeLessThan(400);
  });
});

function createExchangePage(): PdfPageAnalysis {
  const textItems: PdfTextItem[] = [
    textItem("Customer Address", 19, 812.44),
    textItem("If undelivered, return to:", 19, 718.02),
    textItem("Product Details", 20, 548.16),
    textItem("Exchange", 261.24, 811.22),
    textItem("Shadowfax", 265.24, 779.73),
    textItem("Destination Code", 265.24, 732.76),
    textItem("Return Code", 265.24, 659.83),
  ];
  return {
    pageId: "exchange-document:page:1",
    pageNumber: 1,
    geometry: {
      widthPt: 595,
      heightPt: 842,
      rotation: 0,
      mediaBox: { x: 0, y: 0, width: 595, height: 842 },
    },
    textItems,
    rasterContentBoundsPt: { x: 16, y: 500, width: 563, height: 326 },
    rasterInkRatio: 0.12,
  };
}

function textItem(text: string, x: number, y: number): PdfTextItem {
  return {
    text,
    transform: [1, 0, 0, 1, x, y],
    boundsPt: { x, y, width: Math.max(20, text.length * 4), height: 10 },
  };
}

async function readFixture(name: string): Promise<PdfDocumentAnalysis> {
  const bytes = new Uint8Array(
    await readFile(
      path.resolve(process.cwd(), "docs", "fixtures", "meesho", name),
    ),
  );
  const loadingTask = getDocument({ data: bytes, useSystemFonts: true });
  const document = await loadingTask.promise;
  const pages: PdfPageAnalysis[] = [];

  for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
    const page = await document.getPage(pageNumber);
    const textContent = await page.getTextContent();
    const viewport = page.getViewport({ scale: 0.6 });
    const canvas = createCanvas(
      Math.ceil(viewport.width),
      Math.ceil(viewport.height),
    );
    const context = canvas.getContext("2d");
    await page.render({
      canvas: canvas as never,
      canvasContext: context as never,
      viewport,
    }).promise;
    const raster = detectRasterBounds(
      context.getImageData(0, 0, canvas.width, canvas.height).data,
      canvas.width,
      canvas.height,
    );
    const bounds = raster.boundsPx;
    const topLeft = bounds
      ? viewport.convertToPdfPoint(bounds.x, bounds.y)
      : undefined;
    const bottomRight = bounds
      ? viewport.convertToPdfPoint(
          bounds.x + bounds.width,
          bounds.y + bounds.height,
        )
      : undefined;
    const [x1 = 0, y1 = 0, x2 = 0, y2 = 0] = page.view;
    pages.push({
      pageId: `fixture:page:${pageNumber}`,
      pageNumber,
      geometry: {
        widthPt: Math.abs(x2 - x1),
        heightPt: Math.abs(y2 - y1),
        rotation: 0,
        mediaBox: {
          x: Math.min(x1, x2),
          y: Math.min(y1, y2),
          width: Math.abs(x2 - x1),
          height: Math.abs(y2 - y1),
        },
      },
      textItems: textContent.items.flatMap<PdfTextItem>((item) => {
        if (!("str" in item)) return [];
        const [a = 1, b = 0, c = 0, d = 1, x = 0, y = 0] = item.transform;
        return [
          {
            text: item.str,
            transform: [a, b, c, d, x, y],
            boundsPt: { x, y, width: item.width, height: item.height },
          },
        ];
      }),
      ...(topLeft && bottomRight
        ? {
            rasterContentBoundsPt: {
              x: Math.min(topLeft[0], bottomRight[0]),
              y: Math.min(topLeft[1], bottomRight[1]),
              width: Math.abs(bottomRight[0] - topLeft[0]),
              height: Math.abs(bottomRight[1] - topLeft[1]),
            },
          }
        : {}),
      rasterInkRatio: raster.inkRatio,
    });
    page.cleanup();
  }

  await loadingTask.destroy();
  return { documentId: `fixture:${name}`, pages };
}

function createDocumentContext(
  analysis: PdfDocumentAnalysis,
  name: string,
): DocumentContext<PdfDocumentAnalysis> {
  return {
    batchId: "fixture-batch",
    documentId: analysis.documentId,
    source: {
      id: analysis.documentId,
      name,
      sizeBytes: 1,
      mimeType: "application/pdf",
      uploadIndex: 0,
      lastModified: 0,
    },
    document: analysis,
    emit: () => undefined,
  };
}

function createPageContext(
  documentContext: DocumentContext<PdfDocumentAnalysis>,
  page: PdfPageAnalysis,
): PageContext<PdfDocumentAnalysis, PdfPageAnalysis> {
  return {
    documentContext,
    pageId: page.pageId,
    pageNumber: page.pageNumber,
    page,
    geometry: page.geometry,
    textItems: page.textItems,
  };
}
