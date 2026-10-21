import { describe, expect, it, vi } from "vitest";

// the store (and the i18n it loads) wants a browser; where the caret goes is plain text work
vi.mock("../../state/store", () => ({ useAppStore: () => undefined }));
const { changeEnd } = await import("./worksheetUndo");

describe("the caret after an undo or redo", () => {
  it("goes to the end of what came back", () => {
    expect(changeEnd("M = ", "M = det(M)")).toBe(10);
    expect(changeEnd("a, b", "a, b, c")).toBe(7);
  });

  it("goes to where text went away", () => {
    expect(changeEnd("M = det(M)", "M = ")).toBe(4);
    expect(changeEnd("min(det(M))", "det(M)")).toBe(5);
    expect(changeEnd("Txy", "T")).toBe(1);
  });

  it("a change at both ends: the caret goes to the end of all of it", () => {
    expect(changeEnd("det(M)", "min(det(M))")).toBe(10);
  });

  it("goes to the end of a replaced middle part", () => {
    expect(changeEnd("q_0, a -> q_1", "q_0, b -> q_1")).toBe(6);
    expect(changeEnd("union(M, N)", "inter(M, N)")).toBe(5);
  });

  it("a repeated letter does not take the change beyond the text", () => {
    expect(changeEnd("aa", "aaa")).toBe(3);
    expect(changeEnd("aaa", "aa")).toBe(2);
    expect(changeEnd("", "ab")).toBe(2);
    expect(changeEnd("ab", "")).toBe(0);
    expect(changeEnd("same", "same")).toBe(4);
  });
});
