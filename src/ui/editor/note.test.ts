import { describe, expect, it } from "vitest";
import { isNoteSource, noteSource, noteText } from "./note";

describe("note cells", () => {
  it("are the cells whose source starts with #", () => {
    expect(isNoteSource("# hello")).toBe(true);
    expect(isNoteSource("  #")).toBe(true);
    expect(isNoteSource("det(M)")).toBe(false);
    expect(isNoteSource("")).toBe(false);
  });

  it("show their text without the # markers", () => {
    expect(noteText("# Title\n# second line")).toBe("Title\nsecond line");
    expect(noteText("#tight")).toBe("tight");
    expect(noteText("# ")).toBe("");
  });

  it("store every line behind a marker", () => {
    expect(noteSource("Title\nsecond line")).toBe("# Title\n# second line");
    expect(noteSource("")).toBe("# ");
  });

  it("round-trip any text, even one with its own # or indentation", () => {
    for (const text of ["", "plain", "#tag", "  indented", "\ttab", "a\n\n# b", "x #y"]) {
      expect(noteText(noteSource(text))).toBe(text);
      expect(isNoteSource(noteSource(text))).toBe(true);
    }
  });
});
