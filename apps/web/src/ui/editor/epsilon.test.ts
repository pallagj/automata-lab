import { describe, expect, it } from "vitest";
import { epsilonAt, insideRegex, typedWord, withoutEpsilon } from "./epsilon";
import { parseGrammar } from "@automatalab/core/parse/definitionParser";
import { cykMembership } from "@automatalab/core/grammar/cyk";
import { grammarAccepts } from "@automatalab/core/grammar/grammar";
import { regexToNFA } from "@automatalab/core/fsm/regex";
import { acceptsFSM } from "@automatalab/core/fsm/fsm";

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

describe("ε in word-test fields", () => {
  const grammar = (rules: string) =>
    parseGrammar(`Grammar:\n  name: G\n  charset: a, b\n  variables: S, T\n  init: S\n  rules:\n${rules}`).value!;
  const derivable = (rules: string, text: string) => cykMembership(grammar(rules), typedWord(text)!).value!.accepted;

  it("reads ε, eps and epsilon as the empty word, and nothing while the field is empty", () => {
    expect(typedWord("")).toBe(null);
    expect(typedWord("ε")).toBe("");
    expect(typedWord("eps")).toBe("");
    expect(typedWord("epsilon")).toBe("");
    expect(typedWord("εε")).toBe("");
    expect(typedWord("aεb")).toBe("ab");
    expect(typedWord("aabb")).toBe("aabb");
    expect(typedWord("\\eps")).toBe("eps");
  });

  it("eps typed in the field becomes ε, which is the empty word", () => {
    const edit = epsilonAt("eps", 3)!;
    expect(edit.text).toBe("ε");
    expect(typedWord(edit.text)).toBe("");
  });

  it("decides ε exactly for a grammar with an ε-rule", () => {
    const rules = "    - S -> aSb | eps";
    for (const text of ["ε", "eps", "ab", "aεb", "aabb"]) expect(derivable(rules, text)).toBe(true);
    for (const text of ["a", "ba", "aab", "\\eps"]) expect(derivable(rules, text)).toBe(false);
  });

  it("rejects ε when the grammar does not derive it", () => {
    expect(derivable("    - S -> aSb | ab", "ε")).toBe(false);
    expect(derivable("    - S -> aSb | ab", "ab")).toBe(true);
    // a nullable variable that is not the start: ε still is not derivable
    expect(derivable("    - S -> aT\n    - T -> eps", "ε")).toBe(false);
    expect(derivable("    - S -> T | b\n    - T -> eps", "ε")).toBe(true);
  });

  it("finds the derivation of ε, also outside the context-free class", () => {
    expect(grammarAccepts(grammar("    - S -> aSb | eps"), typedWord("ε")!)).toEqual({ verdict: "yes", derivation: ["S", ""] });
    const type0 = grammar("    - S -> aT | eps\n    - aT -> ab");
    expect(grammarAccepts(type0, typedWord("ε")!).verdict).toBe("yes");
    expect(grammarAccepts(type0, typedWord("ab")!).verdict).toBe("yes");
  });

  it("decides ε for a regular expression", () => {
    const matches = (pattern: string, text: string) => acceptsFSM(regexToNFA(pattern, "R").value!, typedWord(text)!);
    expect(matches("a*", "ε")).toBe(true);
    expect(matches("(ab)*", "eps")).toBe(true);
    expect(matches("a|eps", "ε")).toBe(true);
    expect(matches("aa*", "ε")).toBe(false);
    expect(matches("a|b", "ε")).toBe(false);
  });

  it("drops a typed ε from a tape and keeps the caret after the letters before it", () => {
    expect(withoutEpsilon("aεb", 2)).toEqual({ text: "ab", caret: 1 });
    expect(withoutEpsilon("ε", 1)).toEqual({ text: "", caret: 0 });
    expect(withoutEpsilon("εaεb", 4)).toEqual({ text: "ab", caret: 2 });
    expect(withoutEpsilon("ab", 1)).toEqual({ text: "ab", caret: 1 });
    // letters stay letters on a tape: eps is not turned into anything there
    expect(withoutEpsilon("eps", 3)).toEqual({ text: "eps", caret: 3 });
  });
});
