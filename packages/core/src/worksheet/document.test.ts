import { describe, expect, it } from "vitest";
import { upToDate, WorksheetDocument } from "./document";
import { Migration, SAVE_VERSION } from "./migrations";

/** a pretend history: version 1 named the function "determinize", version 2 wrote "eps" for ε */
const HISTORY: Record<number, Migration> = {
  1: { source: (s) => s.replaceAll("determinize(", "det(") },
  2: { source: (s) => s.replaceAll("eps", "ε") }
};

const doc = (version: number): WorksheetDocument => ({
  version,
  name: "Házi",
  cells: [
    { source: "D = determinize(M)", layout: { q_0: { x: 1, y: 2 } } },
    { source: "w = eps" }
  ]
});

describe("a worksheet document brought up to date", () => {
  it("goes through every step since its version, and keeps the layouts", () => {
    expect(upToDate(doc(1), HISTORY, 3)).toEqual({
      version: 3,
      name: "Házi",
      cells: [{ source: "D = det(M)", layout: { q_0: { x: 1, y: 2 } } }, { source: "w = ε" }]
    });
  });

  it("starts at its own version: a version-2 document skips the first step", () => {
    expect(upToDate(doc(2), HISTORY, 3)?.cells.map((c) => c.source)).toEqual(["D = determinize(M)", "w = ε"]);
  });

  it("is left as it is when it is already current", () => {
    expect(upToDate(doc(3), HISTORY, 3)).toEqual(doc(3));
    expect(upToDate(doc(SAVE_VERSION))).toEqual(doc(SAVE_VERSION));
  });

  it("is refused when a newer app wrote it", () => {
    expect(upToDate(doc(4), HISTORY, 3)).toBeNull();
    expect(upToDate(doc(SAVE_VERSION + 1))).toBeNull();
  });
});
