import { describe, expect, it } from "vitest";
import { epsilonAt } from "./epsilon";

const typed = (text: string) => epsilonAt(text, text.length)?.text ?? null;

describe("ε typing shortcuts", () => {
  it("turns whole $ / eps / epsilon tokens into ε", () => {
    expect(typed("$")).toBe("ε");
    expect(typed("eps")).toBe("ε");
    expect(typed("Z/$")).toBe("Z/ε");
    expect(typed("aSb | eps")).toBe("aSb | ε");
    expect(typed("q0 eps")).toBe("q0 ε");
  });

  it('folds the rest of "epsilon" back into ε after "eps" already converted', () => {
    expect(typed("εilon")).toBe("ε");
    expect(typed("εil")).toBe(null);
  });

  it("leaves partial words and longer identifiers alone", () => {
    expect(typed("ep")).toBe(null);
    expect(typed("epsfree")).toBe(null);
    expect(typed("aeps")).toBe(null);
    expect(typed("a$")).toBe(null);
  });

  it("puts the caret right after the inserted ε", () => {
    expect(epsilonAt("aSb | eps", 9)).toEqual({ text: "aSb | ε", caret: 7, tokenStart: 6 });
  });
});
