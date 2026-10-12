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
import { AmazonAdapter, AMAZON_LAYOUT_V1 } from ".";

const FIXTURES = ["document (6).pdf", "document (6) (1).pdf"] as const;

describe("AmazonAdapter golden fixtures", () => {
  const adapter = new AmazonAdapter();

  for (const fixture of FIXTURES) {
    it(`retains the label and excludes the supplier invoice in ${fixture}`, async () => {
      const analysis = await readFixture(fixture);
      const documentContext = createDocumentContext(analysis, fixture);
      const detection = await adapter.detectDocument(documentContext);
      const labels = [];
      let supplierInvoices = 0;

      expect(analysis.pages).toHaveLength(2);
      expect(detection.marketplace).toBe("amazon");
      expect(detection.confidence).toBeGreaterThanOrEqual(0.95);
      expect(detection.layoutFingerprint).toBe(AMAZON_LAYOUT_V1);

      for (const page of analysis.pages) {
        const pageContext = createPageContext(documentContext, page);
        const classification = await adapter.classifyPage(pageContext);
        if (classification.pageKind === "seller_invoice") {
          supplierInvoices += 1;
          expect(await adapter.findPrintableRegions(pageContext)).toHaveLength(
            0,
          );
          continue;
        }

        expect(classification.pageKind).toBe("shipping_label");
        expect(classification.confidence).toBeGreaterThanOrEqual(0.95);
        const regions = await adapter.findPrintableRegions(pageContext);
        expect(regions).toHaveLength(1);
        expect(regions[0]?.requiresReview).toBe(false);
        expect(regions[0]?.layoutFingerprint).toBe(AMAZON_LAYOUT_V1);
        expect(regions[0]?.boundsPt.width).toBeGreaterThan(520);
        expect(regions[0]?.boundsPt.height).toBeGreaterThan(780);
        labels.push(...regions);
      }

      expect(labels).toHaveLength(1);
      expect(supplierInvoices).toBe(1);
    });
  }

  it("classifies by evidence when fixture pages are reordered", async () => {
    const source = await readFixture(FIXTURES[0]);
    const analysis = { ...source, pages: [...source.pages].reverse() };
    const documentContext = createDocumentContext(analysis, "reordered.pdf");
    const kinds = await Promise.all(
      analysis.pages.map((page) =>
        adapter
          .classifyPage(createPageContext(documentContext, page))
          .then((result) => result.pageKind),
      ),
    );

    expect(kinds).toEqual(["seller_invoice", "shipping_label"]);
  });

  it("recognizes the known layout when Amazon branding is image-only", async () => {
    const source = await readFixture(FIXTURES[0]);
    const analysis: PdfDocumentAnalysis = {
      ...source,
      pages: source.pages.map((page) => ({
        ...page,
        textItems: page.textItems.filter(
          (item) => !item.text.toLowerCase().includes("amazon.in"),
        ),
      })),
    };
    const documentContext = createDocumentContext(
      analysis,
      "image-only-amazon-branding.pdf",
    );

    const detection = await adapter.detectDocument(documentContext);

    expect(detection.marketplace).toBe("amazon");
    expect(detection.confidence).toBe(1);
    expect(detection.layoutFingerprint).toBe(AMAZON_LAYOUT_V1);
    expect(
      detection.evidence.some(
        (item) => item.code === "amazon.anchor.amazon_in",
      ),
    ).toBe(false);

    const classifications = await Promise.all(
      analysis.pages.map((page) =>
        adapter.classifyPage(createPageContext(documentContext, page)),
      ),
    );
    expect(classifications.map((item) => item.pageKind)).toEqual([
      "shipping_label",
      "seller_invoice",
    ]);
  });
});

async function readFixture(name: string): Promise<PdfDocumentAnalysis> {
  const bytes = new Uint8Array(
    await readFile(
      path.resolve(process.cwd(), "docs", "fixtures", "amazon", name),
    ),
  );
  const loadingTask = getDocument({
    data: bytes,
    useSystemFonts: true,
    wasmUrl: `${path
      .resolve("node_modules", "pdfjs-dist", "wasm")
      .replaceAll("\\", "/")}/`,
  });
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
    const [x1 = 0, y1 = 0, x2 = 0, y2 = 0] = page.view;
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
