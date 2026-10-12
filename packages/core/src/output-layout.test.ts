import { TARGET_LABEL_SIZE_PT } from "./constants";
import {
  A4_ROW_GUTTER_PT,
  A4_SIZE_PT,
  A4_SLOTS_PER_SHEET,
  DEFAULT_OUTPUT_LAYOUT,
  describeOutputLayout,
  describeOutputVolume,
  isOutputLayout,
  outputPageCount,
  placeLabelInSlot,
  sheetSlotFor,
} from "./output-layout";

describe("output layout geometry", () => {
  it("defaults to one label per 100 x 150 mm page", () => {
    expect(DEFAULT_OUTPUT_LAYOUT).toBe("label_100x150");
    expect(describeOutputLayout("label_100x150").labelsPerPage).toBe(1);
  });

  it("uses exact ISO A4 portrait points derived from millimetres", () => {
    // 210 mm and 297 mm at 72 points per 25.4 mm.
    expect(A4_SIZE_PT.width).toBeCloseTo(595.2755905511812, 9);
    expect(A4_SIZE_PT.height).toBeCloseTo(841.8897637795277, 9);
    expect(A4_SIZE_PT.height).toBeGreaterThan(A4_SIZE_PT.width);
    expect(A4_SLOTS_PER_SHEET).toBe(4);
  });

  it.each([
    [1, 1],
    [2, 1],
    [3, 1],
    [4, 1],
    [5, 2],
    [8, 2],
    [9, 3],
    [100, 25],
    [101, 26],
  ])("imposes %i labels onto %i A4 sheets", (labels, sheets) => {
    expect(outputPageCount(labels, "a4_4up")).toBe(sheets);
  });

  it("keeps one page per label for the standard layout", () => {
    for (const count of [1, 5, 100, 101]) {
      expect(outputPageCount(count, "label_100x150")).toBe(count);
    }
  });

  it("rejects a non-integer or negative label count", () => {
    expect(() => outputPageCount(-1, "a4_4up")).toThrow();
    expect(() => outputPageCount(1.5, "a4_4up")).toThrow();
  });

  it("orders slots top-left, top-right, bottom-left, bottom-right", () => {
    const [topLeft, topRight, bottomLeft, bottomRight] = [0, 1, 2, 3].map(
      sheetSlotFor,
    );
    const halfWidth = A4_SIZE_PT.width / 2;
    const rowHeight = (A4_SIZE_PT.height - A4_ROW_GUTTER_PT) / 2;

    expect(topLeft).toMatchObject({ pageIndex: 0, row: 0, column: 0, x: 0 });
    expect(topLeft?.y).toBeCloseTo(rowHeight + A4_ROW_GUTTER_PT, 9);
    expect(topRight).toMatchObject({ pageIndex: 0, row: 0, column: 1 });
    expect(topRight?.x).toBeCloseTo(halfWidth, 9);
    expect(topRight?.y).toBeCloseTo(rowHeight + A4_ROW_GUTTER_PT, 9);
    expect(bottomLeft).toMatchObject({ pageIndex: 0, row: 1, column: 0, x: 0 });
    expect(bottomLeft?.y).toBeCloseTo(0, 9);
    expect(bottomRight).toMatchObject({ pageIndex: 0, row: 1, column: 1 });
    expect(bottomRight?.x).toBeCloseTo(halfWidth, 9);
    expect(bottomRight?.y).toBeCloseTo(0, 9);
  });

  it("wraps onto the next sheet after four slots", () => {
    expect(sheetSlotFor(4)).toMatchObject({
      pageIndex: 1,
      slotIndex: 0,
      row: 0,
      column: 0,
    });
    expect(sheetSlotFor(99)).toMatchObject({ pageIndex: 24, slotIndex: 3 });
  });

  it("leaves a horizontal cutting gutter without overlapping slots", () => {
    const slots = [0, 1, 2, 3].map(sheetSlotFor);
    const area = slots.reduce(
      (total, slot) => total + slot.width * slot.height,
      0,
    );
    expect(area).toBeCloseTo(
      A4_SIZE_PT.width * (A4_SIZE_PT.height - A4_ROW_GUTTER_PT),
      6,
    );
    const [topLeft, , bottomLeft] = slots;
    expect(topLeft!.y - (bottomLeft!.y + bottomLeft!.height)).toBeCloseTo(
      A4_ROW_GUTTER_PT,
      9,
    );
    for (const slot of slots) {
      expect(slot.x).toBeGreaterThanOrEqual(0);
      expect(slot.y).toBeGreaterThanOrEqual(0);
      expect(slot.x + slot.width).toBeLessThanOrEqual(A4_SIZE_PT.width + 1e-9);
      expect(slot.y + slot.height).toBeLessThanOrEqual(
        A4_SIZE_PT.height + 1e-9,
      );
    }
  });

  it("scales a label uniformly and centres it inside its quadrant", () => {
    const slot = sheetSlotFor(0);
    const placement = placeLabelInSlot(slot);

    const widthScale = placement.width / TARGET_LABEL_SIZE_PT.width;
    const heightScale = placement.height / TARGET_LABEL_SIZE_PT.height;
    expect(widthScale).toBeCloseTo(heightScale, 9);
    expect(placement.scale).toBeCloseTo(heightScale, 9);

    // Height is the binding constraint for a 100 x 150 label in a 105 x 148.5
    // quadrant, so the label is just under physical size.
    expect(placement.scale).toBeLessThanOrEqual(1);
    expect(placement.scale).toBeGreaterThan(0.97);

    expect(placement.x - slot.x).toBeCloseTo(
      slot.x + slot.width - (placement.x + placement.width),
      9,
    );
    expect(placement.y - slot.y).toBeCloseTo(
      slot.y + slot.height - (placement.y + placement.height),
      9,
    );
  });

  it("never lets a placed label escape its quadrant", () => {
    for (const index of [0, 1, 2, 3]) {
      const slot = sheetSlotFor(index);
      const placement = placeLabelInSlot(slot);
      expect(placement.x).toBeGreaterThanOrEqual(slot.x - 1e-9);
      expect(placement.y).toBeGreaterThanOrEqual(slot.y - 1e-9);
      expect(placement.x + placement.width).toBeLessThanOrEqual(
        slot.x + slot.width + 1e-9,
      );
      expect(placement.y + placement.height).toBeLessThanOrEqual(
        slot.y + slot.height + 1e-9,
      );
    }
  });

  it("rejects non-positive placement dimensions", () => {
    expect(() =>
      placeLabelInSlot({ x: 0, y: 0, width: 0, height: 10 }),
    ).toThrow();
    expect(() => placeLabelInSlot(sheetSlotFor(0), 0, 10)).toThrow();
  });

  it("describes volume without ever calling a sheet a label", () => {
    expect(describeOutputVolume(100, "a4_4up")).toBe(
      "100 LABELS / 25 A4 SHEETS",
    );
    expect(describeOutputVolume(1, "a4_4up")).toBe("1 LABEL / 1 A4 SHEET");
    expect(describeOutputVolume(3, "label_100x150")).toBe(
      "3 LABELS / 3 LABEL PAGES",
    );
  });

  it("guards the layout union at runtime boundaries", () => {
    expect(isOutputLayout("a4_4up")).toBe(true);
    expect(isOutputLayout("label_100x150")).toBe(true);
    expect(isOutputLayout("a4")).toBe(false);
    expect(isOutputLayout(undefined)).toBe(false);
    expect(isOutputLayout(4)).toBe(false);
  });

  it("gives each layout a distinct filename", () => {
    expect(describeOutputLayout("label_100x150").filename).toBe(
      "PRINT_READY_LABELS.pdf",
    );
    expect(describeOutputLayout("a4_4up").filename).toBe(
      "PRINT_READY_LABELS_A4.pdf",
    );
  });
});
