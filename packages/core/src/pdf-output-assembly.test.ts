// @vitest-environment node

import { PDFDocument, StandardFonts } from "pdf-lib";
import { getDocument, OPS } from "pdfjs-dist/legacy/build/pdf.mjs";
import { TARGET_LABEL_SIZE_PT } from "./constants";
import {
  A4_ROW_GUTTER_PT,
  A4_SIZE_PT,
  placeLabelInSlot,
  sheetSlotFor,
} from "./output-layout";
import {
  assembleFourUpSheets,
  assembleLabelsForLayout,
} from "./pdf-output-assembly";
import type { Marketplace, NormalizedLabel } from "./types";

describe("final output assembly by layout", () => {
  it("keeps the standard layout at exactly 100 x 150 mm, one page per label", async () => {
    const labels = await buildLabels(3);
    const artifact = await assembleLabelsForLayout(labels, "label_100x150");

    expect(artifact.layout).toBe("label_100x150");
    expect(artifact.pageCount).toBe(3);
    expect(artifact.labelCount).toBe(3);
    expect(artifact.filename).toBe("PRINT_READY_LABELS.pdf");

    const document = await PDFDocument.load(artifact.pdfBytes);
    expect(document.getPageCount()).toBe(3);
    for (const page of document.getPages()) {
      expect(page.getWidth()).toBeCloseTo(TARGET_LABEL_SIZE_PT.width, 6);
      expect(page.getHeight()).toBeCloseTo(TARGET_LABEL_SIZE_PT.height, 6);
    }
  });

  it("produces exact ISO A4 portrait sheets", async () => {
    const artifact = await assembleLabelsForLayout(
      await buildLabels(4),
      "a4_4up",
    );

    expect(artifact.layout).toBe("a4_4up");
    expect(artifact.filename).toBe("PRINT_READY_LABELS_A4.pdf");
    expect(artifact.widthPt).toBeCloseTo(A4_SIZE_PT.width, 9);
    expect(artifact.heightPt).toBeCloseTo(A4_SIZE_PT.height, 9);

    const document = await PDFDocument.load(artifact.pdfBytes);
    for (const page of document.getPages()) {
      expect(page.getWidth()).toBeCloseTo(A4_SIZE_PT.width, 6);
      expect(page.getHeight()).toBeCloseTo(A4_SIZE_PT.height, 6);
      expect(page.getHeight()).toBeGreaterThan(page.getWidth());
    }
  });

  it.each([
    [1, 1],
    [4, 1],
    [5, 2],
    [8, 2],
    [100, 25],
  ])(
    "imposes %i labels onto %i A4 sheets",
    async (labelCount, sheets) => {
      const artifact = await assembleFourUpSheets(
        await buildLabels(labelCount),
      );

      expect(artifact.pageCount).toBe(sheets);
      expect(artifact.labelCount).toBe(labelCount);
      const document = await PDFDocument.load(artifact.pdfBytes);
      expect(document.getPageCount()).toBe(sheets);
    },
    120_000,
  );

  it("places labels row-major: top-left, top-right, bottom-left, bottom-right", async () => {
    const artifact = await assembleFourUpSheets(await buildLabels(4));
    const placements = await readLabelPlacements(artifact.pdfBytes, 1);

    expect(placements).toHaveLength(4);
    const expected = [0, 1, 2, 3].map((index) =>
      placeLabelInSlot(sheetSlotFor(index)),
    );
    // Draw order is label order, so the nth drawn form is the nth slot.
    for (const [index, placement] of placements.entries()) {
      expect(placement.x).toBeCloseTo(expected[index]!.x, 3);
      expect(placement.y).toBeCloseTo(expected[index]!.y, 3);
    }

    const [topLeft, topRight, bottomLeft, bottomRight] = placements;
    expect(topLeft!.y).toBeGreaterThan(bottomLeft!.y);
    expect(topRight!.y).toBeGreaterThan(bottomRight!.y);
    expect(topRight!.x).toBeGreaterThan(topLeft!.x);
    expect(bottomRight!.x).toBeGreaterThan(bottomLeft!.x);
    expect(
      topLeft!.y - (bottomLeft!.y + bottomLeft!.height),
    ).toBeGreaterThanOrEqual(A4_ROW_GUTTER_PT - 0.01);
  });

  it("leaves the unused slots of a partial last sheet blank", async () => {
    const artifact = await assembleFourUpSheets(await buildLabels(5));

    expect(artifact.pageCount).toBe(2);
    expect(await readLabelPlacements(artifact.pdfBytes, 1)).toHaveLength(4);

    const lastSheet = await readLabelPlacements(artifact.pdfBytes, 2);
    expect(lastSheet).toHaveLength(1);
    const topLeft = placeLabelInSlot(sheetSlotFor(0));
    expect(lastSheet[0]!.x).toBeCloseTo(topLeft.x, 3);
    expect(lastSheet[0]!.y).toBeCloseTo(topLeft.y, 3);
  });

  it("scales proportionally and keeps every label inside its quadrant", async () => {
    const artifact = await assembleFourUpSheets(await buildLabels(4));
    const placements = await readLabelPlacements(artifact.pdfBytes, 1);

    for (const [index, placement] of placements.entries()) {
      const slot = sheetSlotFor(index);
      const widthScale = placement.width / TARGET_LABEL_SIZE_PT.width;
      const heightScale = placement.height / TARGET_LABEL_SIZE_PT.height;
      expect(widthScale).toBeCloseTo(heightScale, 6);

      expect(placement.x).toBeGreaterThanOrEqual(slot.x - 0.01);
      expect(placement.y).toBeGreaterThanOrEqual(slot.y - 0.01);
      expect(placement.x + placement.width).toBeLessThanOrEqual(
        slot.x + slot.width + 0.01,
      );
      expect(placement.y + placement.height).toBeLessThanOrEqual(
        slot.y + slot.height + 0.01,
      );
    }
  });

  it("keeps four-up output PDF-native with no rasterization", async () => {
    const artifact = await assembleFourUpSheets(await buildLabels(4));
    const pdf = await getDocument({ data: artifact.pdfBytes }).promise;
    const page = await pdf.getPage(1);
    const operators = await page.getOperatorList();
    const text = await page.getTextContent();

    expect(
      operators.fnArray.filter(
        (operator) => operator === OPS.paintImageXObject,
      ),
    ).toHaveLength(0);
    const rendered = text.items
      .map((item) => ("str" in item ? item.str : ""))
      .join(" ");
    for (const marker of ["LABEL-0", "LABEL-1", "LABEL-2", "LABEL-3"]) {
      expect(rendered).toContain(marker);
    }
  });

  it("ignores marketplace identity when choosing slots", async () => {
    const marketplaces: Marketplace[] = [
      "meesho",
      "flipkart",
      "amazon",
      "unknown",
    ];
    const mixed = await buildLabels(4, marketplaces);
    const single = await buildLabels(4);

    const mixedPlacements = await readLabelPlacements(
      (await assembleFourUpSheets(mixed)).pdfBytes,
      1,
    );
    const singlePlacements = await readLabelPlacements(
      (await assembleFourUpSheets(single)).pdfBytes,
      1,
    );

    expect(mixedPlacements).toHaveLength(4);
    for (const [index, placement] of mixedPlacements.entries()) {
      expect(placement.x).toBeCloseTo(singlePlacements[index]!.x, 6);
      expect(placement.y).toBeCloseTo(singlePlacements[index]!.y, 6);
      expect(placement.width).toBeCloseTo(singlePlacements[index]!.width, 6);
    }
  });

  it("imposes in source order regardless of the input array order", async () => {
    const labels = await buildLabels(4);
    const shuffled = [labels[2]!, labels[0]!, labels[3]!, labels[1]!];
    const artifact = await assembleFourUpSheets(shuffled);

    const pdf = await getDocument({ data: artifact.pdfBytes }).promise;
    const text = await (await pdf.getPage(1)).getTextContent();
    const rendered = text.items
      .map((item) => ("str" in item ? item.str : ""))
      .join(" ");
    expect(rendered.indexOf("LABEL-0")).toBeLessThan(
      rendered.indexOf("LABEL-1"),
    );
    expect(rendered.indexOf("LABEL-2")).toBeLessThan(
      rendered.indexOf("LABEL-3"),
    );
  });

  it("refuses an empty batch and a wrongly sized label", async () => {
    await expect(assembleFourUpSheets([])).rejects.toThrow(/at least one/i);

    const [label] = await buildLabels(1);
    const wrongSize = await PDFDocument.create();
    wrongSize.addPage([200, 200]);
    await expect(
      assembleFourUpSheets([{ ...label!, pdfBytes: await wrongSize.save() }]),
    ).rejects.toThrow(/exact target dimensions/i);
  });
});

/** Builds normalized 100 x 150 mm label pages carrying identifiable text. */
async function buildLabels(
  count: number,
  marketplaces: readonly Marketplace[] = [],
): Promise<NormalizedLabel[]> {
  const labels: NormalizedLabel[] = [];
  for (let index = 0; index < count; index += 1) {
    const document = await PDFDocument.create();
    const page = document.addPage([
      TARGET_LABEL_SIZE_PT.width,
      TARGET_LABEL_SIZE_PT.height,
    ]);
    const font = await document.embedFont(StandardFonts.Helvetica);
    page.drawText(`LABEL-${index}`, { x: 12, y: 24, size: 11, font });
    labels.push({
      id: `label-${index}`,
      batchId: "batch",
      documentId: `document-${index}`,
      pageId: `page-${index}`,
      regionId: `region-${index}`,
      sourcePageNumber: index + 1,
      outputOrder: index,
      marketplace: marketplaces[index] ?? "unknown",
      widthPt: TARGET_LABEL_SIZE_PT.width,
      heightPt: TARGET_LABEL_SIZE_PT.height,
      sourceBoundsPt: { x: 0, y: 0, width: 200, height: 300 },
      pdfBytes: await document.save(),
      adapterId: "test",
      adapterVersion: "1",
      rotationApplied: 0,
    } as NormalizedLabel);
  }
  return labels;
}

interface Placement {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/**
 * Recover where each embedded label form was drawn on `pageNumber`.
 *
 * `drawPage` emits `cm` (scale + translate) followed by `Do`. The matrix scales
 * the form's own bounding box — which is the 100 x 150 mm label page — so the
 * `a`/`d` components are scale factors and are multiplied back out to points.
 */
async function readLabelPlacements(
  pdfBytes: Uint8Array,
  pageNumber: number,
): Promise<Placement[]> {
  const pdf = await getDocument({ data: pdfBytes.slice() }).promise;
  const page = await pdf.getPage(pageNumber);
  const operators = await page.getOperatorList();
  const placements: Placement[] = [];
  const stack: number[][] = [];
  let current = [1, 0, 0, 1, 0, 0];

  for (const [index, operator] of operators.fnArray.entries()) {
    const argument = operators.argsArray[index];
    if (operator === OPS.save) {
      stack.push([...current]);
    } else if (operator === OPS.restore) {
      current = stack.pop() ?? [1, 0, 0, 1, 0, 0];
    } else if (operator === OPS.transform) {
      current = multiply(current, argument as number[]);
    } else if (operator === OPS.paintFormXObjectBegin) {
      placements.push({
        x: current[4] as number,
        y: current[5] as number,
        width: (current[0] as number) * TARGET_LABEL_SIZE_PT.width,
        height: (current[3] as number) * TARGET_LABEL_SIZE_PT.height,
      });
    }
  }
  return placements;
}

function multiply(left: number[], right: number[]): number[] {
  const [a1, b1, c1, d1, e1, f1] = left as [
    number,
    number,
    number,
    number,
    number,
    number,
  ];
  const [a2, b2, c2, d2, e2, f2] = right as [
    number,
    number,
    number,
    number,
    number,
    number,
  ];
  return [
    a2 * a1 + b2 * c1,
    a2 * b1 + b2 * d1,
    c2 * a1 + d2 * c1,
    c2 * b1 + d2 * d1,
    e2 * a1 + f2 * c1 + e1,
    e2 * b1 + f2 * d1 + f1,
  ];
}
