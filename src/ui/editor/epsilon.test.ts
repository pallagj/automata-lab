import { describe, expect, it } from "vitest";
import { epsilonAt, insideRegex } from "./epsilon";

const typed = (text: string) => epsilonAt(text, text.length)?.text ?? null;

describe("ε typing shortcut", () => {
  it("turns eps into ε as soon as it is typed, anywhere", () => {
    expect(typed("eps")).toBe("ε");
    expect(typed("Z/eps")).toBe("Z/ε");
    expect(typed("aSb | eps")).toBe("aSb | ε");
    expect(typed("Aeps")).toBe("Aε");
    expect(typed("(a|eps")).toBe("(a|ε");
  });

  it('folds the rest of "epsilon" back into ε', () => {
    expect(typed("εilon")).toBe("ε");
    expect(typed("εil")).toBe(null);
  });

  it("leaves \\eps, partial words and $ alone", () => {
    expect(typed("\\eps")).toBe(null);
    expect(typed("\\epsilon")).toBe(null);
    expect(typed("ep")).toBe(null);
    expect(typed("$")).toBe(null);
  });

  it("puts the caret right after the inserted ε", () => {
    expect(epsilonAt("aSb | eps", 9)).toEqual({ text: "aSb | ε", caret: 7 });
  });
});

describe("ε shortcut in expression cells", () => {
  it("applies only inside an unclosed regex(…)", () => {
    expect(insideRegex("R = regex(a|")).toBe(true);
    expect(insideRegex("toFsm(regex((a|b)")).toBe(true);
    expect(insideRegex("regex(a) + regex(")).toBe(true);
    expect(insideRegex("regex(a)")).toBe(false);
    expect(insideRegex("D = det(epsfree(M")).toBe(false);
  });
});
