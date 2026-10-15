import { describe, expect, it } from "vitest";
import { grammarEpsilon, regexEpsilonWords } from "./epsilon";
import { parseGrammar } from "./parse/definitionParser";
import { regexToNFA } from "./fsm/regex";
import { acceptsFSM } from "./fsm/fsm";

const grammar = (rules: string, charset = "a, b") =>
  parseGrammar(`Grammar:\n  name: G\n  charset: ${charset}\n  variables: S, A\n  init: S\n  rules:\n${rules}`);

describe("ε in grammar right-hand sides", () => {
  it("is the identity of concatenation: εA = A", () => {
    const g = grammar("    - S -> εA | aSb | eps\n    - A -> b");
    expect(g.ok).toBe(true);
    expect(g.value!.rules.map((r) => r.right)).toEqual(["A", "aSb", "", "b"]);
  });

  it("reads eps inside a word as ε unless the letters are declared", () => {
    expect(grammarEpsilon("Aeps", new Set(["S", "A", "a"]))).toBe("A");
    expect(grammarEpsilon("aeps", new Set(["a", "e", "p", "s"]))).toBe("aeps");
  });

  it("leaves $ as an ordinary symbol, e.g. an end marker", () => {
    expect(grammarEpsilon("S$", new Set(["S", "$"]))).toBe("S$");
  });
});

describe("ε words in regexes", () => {
  it("turns whole eps / epsilon parts into ε", () => {
    expect(regexEpsilonWords("(a|eps)*")).toBe("(a|ε)*");
    expect(regexEpsilonWords("epsilon")).toBe("ε");
    const nfa = regexToNFA("(a|eps)b").value!;
    expect(acceptsFSM(nfa, "b")).toBe(true);
    expect(acceptsFSM(nfa, "ab")).toBe(true);
  });

  it("keeps letters inside longer words and the (e)ps escape", () => {
    expect(regexEpsilonWords("aeps")).toBe("aeps");
    expect(regexEpsilonWords("(e)ps")).toBe("(e)ps");
  });
});
