import { describe, expect, it } from "vitest";
import { declaredSymbols, epsilonAt, REGEX_BOUNDARY } from "./epsilon";

const typed = (text: string) => epsilonAt(text, text.length)?.text ?? null;

describe("ε typing shortcuts", () => {
  it("turns whole eps / epsilon tokens into ε", () => {
    expect(typed("eps")).toBe("ε");
    expect(typed("epsilon")).toBe("ε");
    expect(typed("Z/eps")).toBe("Z/ε");
    expect(typed("aSb | eps")).toBe("aSb | ε");
    expect(typed("q0 eps")).toBe("q0 ε");
  });

  it('folds the rest of "epsilon" back into ε after "eps" already converted', () => {
    expect(typed("εilon")).toBe("ε");
    expect(typed("εil")).toBe(null);
  });

  it("leaves $, partial words and longer identifiers alone", () => {
    expect(typed("$")).toBe(null);
    expect(typed("ep")).toBe(null);
    expect(typed("epsfree")).toBe(null);
    expect(typed("aeps")).toBe(null);
  });

  it("puts the caret right after the inserted ε", () => {
    expect(epsilonAt("aSb | eps", 9)).toEqual({ text: "aSb | ε", caret: 7, tokenStart: 6 });
  });
});

describe("ε typing shortcuts in grammars and regexes", () => {
  const grammar = (text: string, declared: string[]) =>
    epsilonAt(text, text.length, { declared: new Set(declared) })?.text ?? null;

  it("works inside a grammar word unless its letters are declared symbols", () => {
    expect(grammar("Aeps", ["S", "A", "a", "b"])).toBe("Aε");
    expect(grammar("Aeps", ["S", "A", "e", "p", "s"])).toBe(null);
    expect(grammar("eps", ["S", "e", "p", "s"])).toBe(null);
    expect(grammar("eps", ["S", "a"])).toBe("ε");
  });

  it("treats regex operators as boundaries", () => {
    const regex = (text: string) => epsilonAt(text, text.length, { boundary: REGEX_BOUNDARY })?.text ?? null;
    expect(regex("(a|eps")).toBe("(a|ε");
    expect(regex("b*eps")).toBe("b*ε");
    expect(regex("aeps")).toBe(null);
  });

  it("reads declared symbols from charset/variables lists", () => {
    expect([...declaredSymbols("a, b", "[S, A]")]).toEqual(["a", "b", "S", "A"]);
    expect(declaredSymbols("a-d").has("c")).toBe(true);
  });
});
