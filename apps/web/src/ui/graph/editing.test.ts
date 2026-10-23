import { describe, expect, it, vi } from "vitest";
import { suggestStateName } from "./editing";

// the suggestion is plain data; the store (and the i18n it loads) wants a browser
vi.mock("../../state/store", () => ({ useAppStore: () => undefined, activeWorkspace: () => undefined }));

describe("a new state's suggested name", () => {
  it("numbered states get the next number, written canonically: q_0, q_1 → q_2", () => {
    expect(suggestStateName(new Set(["q_0", "q_1"]))).toBe("q_2");
    // spelt as typed, the same states
    expect(suggestStateName(new Set(["q0", "q_{1}"]))).toBe("q_2");
    // the first free number, then two digits in braces
    expect(suggestStateName(new Set(["q_0", "q_2"]))).toBe("q_1");
    const ten = new Set(Array.from({ length: 10 }, (_, i) => `q_${i}`));
    expect(suggestStateName(ten)).toBe("q_{10}");
  });

  it("other states get a free letter", () => {
    expect(suggestStateName(new Set(["S", "A"]))).toBe("B");
    expect(suggestStateName(new Set(["q_0", "ok"]))).toBe("A");
    expect(suggestStateName(new Set())).toBe("A");
  });
});
