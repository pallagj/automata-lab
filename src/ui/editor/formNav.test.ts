import { describe, expect, it } from "vitest";
import { Box, verticalTarget } from "./formNav";

/** A row's fields from their [left, right] spans, all on one line at y. */
const row = (y: number, row: number | null, rowKind: string | null, spans: [number, number][]): Box[] =>
  spans.map(([left, right], col) => ({ top: y, bottom: y + 26, left, right, row, rowKind, col }));

describe("↑ and ↓ between the form's fields", () => {
  // δ(start, a) = (sawA, _, →) over δ(matchA, _) = (ok, &, •): the fields' widths differ
  const delta = [
    ...row(100, 0, "row", [[20, 52], [60, 68], [92, 128], [134, 142], [148, 166]]),
    ...row(130, 1, "row", [[20, 66], [74, 82], [106, 120], [126, 134], [140, 158]])
  ];

  it("goes to the same column of a transition row, however wide its fields", () => {
    for (let col = 0; col < 5; col++) {
      expect(verticalTarget(delta, col, 1)).toBe(5 + col);
      expect(verticalTarget(delta, 5 + col, -1)).toBe(col);
    }
  });

  it("goes to the last field of a shorter row", () => {
    const boxes = [...row(100, 0, "row", [[20, 40], [50, 60], [70, 90], [100, 120]]), ...row(130, 1, "row", [[20, 40], [50, 60]])];
    expect(verticalTarget(boxes, 3, 1)).toBe(5);
  });

  it("stops at the first and the last line", () => {
    expect(verticalTarget(delta, 2, -1)).toBeNull();
    expect(verticalTarget(delta, 7, 1)).toBeNull();
  });

  it("skips no line: the nearest one in that direction", () => {
    const boxes = [...row(100, 0, "row", [[20, 40]]), ...row(130, 1, "row", [[20, 40]]), ...row(160, 2, "row", [[20, 40]])];
    expect(verticalTarget(boxes, 0, 1)).toBe(1);
    expect(verticalTarget(boxes, 2, -1)).toBe(1);
  });

  it("outside rows, and between rows of different kinds, goes to the nearest field across", () => {
    // the definition's grid: Σ | Q over q₀ | F, then a storage row, then a transition
    const boxes = [
      ...row(10, null, null, [[0, 160], [176, 336]]),
      ...row(40, null, null, [[0, 160], [176, 336]]),
      ...row(80, 0, "storage", [[0, 100], [105, 230], [235, 336]]),
      ...row(120, 1, "row", [[20, 52], [60, 68], [92, 128]])
    ];
    expect(verticalTarget(boxes, 1, 1)).toBe(3); // Q → F
    expect(verticalTarget(boxes, 3, 1)).toBe(6); // F → the storage's initial content
    expect(verticalTarget(boxes, 5, 1)).toBe(9); // the storage's type → the transition's nearest field
    expect(verticalTarget(boxes, 7, -1)).toBe(4); // the transition's first field → the storage's name
    expect(verticalTarget(boxes, 4, -1)).toBe(2); // the storage's name → q₀
  });

  it("treats fields of slightly different heights in one row as one line", () => {
    const boxes: Box[] = [
      { top: 100, bottom: 126, left: 0, right: 100, row: 0, rowKind: "storage", col: 0 },
      { top: 99, bottom: 128, left: 105, right: 230, row: 0, rowKind: "storage", col: 1 },
      { top: 140, bottom: 166, left: 0, right: 100, row: 1, rowKind: "storage", col: 0 },
      { top: 139, bottom: 168, left: 105, right: 230, row: 1, rowKind: "storage", col: 1 }
    ];
    expect(verticalTarget(boxes, 0, 1)).toBe(2);
    expect(verticalTarget(boxes, 1, 1)).toBe(3);
  });
});
