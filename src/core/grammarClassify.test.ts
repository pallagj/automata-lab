import { describe, expect, it } from "vitest";
import { classify, Grammar, grammarToFSM, removeEpsilonRules } from "./grammar/grammar";
import { removeUnitRules, toCNF } from "./grammar/normalForm";
import { parseGrammar } from "./parse/definitionParser";
import { acceptsFSM } from "./fsm/fsm";
import { allWords, cfgWordsUpTo, randomCFG, rng, sorted } from "./testing";

const grammar = (rules: string, variables = "S, A, B, C, D", terminals = "a, b, c", start = "S") => {
  const r = parseGrammar(`Grammar:
  name: G
  charset: ${terminals}
  variables: ${variables}
  init: ${start}
  rules:
${rules
  .trim()
  .split("\n")
  .map((l) => `    - ${l.trim()}`)
  .join("\n")}`);
  expect(r.ok, JSON.stringify(r.diagnostics)).toBe(true);
  return r.value!;
};

const keys = (vs: { key: string }[]) => vs.map((v) => v.key);

describe("the Chomsky classes of the lecture notes (4.12–4.15)", () => {
  it("4.18: S → ε | aA | bA | a | b, A → aA | bA | a | b is type 3", () => {
    const c = classify(grammar("S -> ε | aA | bA | a | b\nA -> aA | bA | a | b"));
    expect(c.type).toBe(3);
    expect([c.reasons.type3.holds, c.reasons.type2.holds, c.reasons.type1.holds]).toEqual([true, true, true]);
  });

  it("4.5 / 4.18: S → aS | bS | ε is \"only of class 0\" — S → ε while S is on a right-hand side", () => {
    const c = classify(grammar("S -> aS | bS | ε"));
    expect(c.type).toBe(0);
    for (const level of [c.reasons.type3, c.reasons.type2, c.reasons.type1])
      expect(keys(level.violations)).toEqual(["grammar.classify.startEpsilonNotAllowed"]);
    // its language is still regular: it is right-linear, and toFsm takes it
    expect(c.rightLinear).toBe(true);
    const m = grammarToFSM(grammar("S -> aS | bS | ε")).value!;
    for (const w of allWords(["a", "b"], 5)) expect(acceptsFSM(m, w)).toBe(true);
  });

  it("4.8, 4.10, 4.11: the same S → ε keeps these out of every class above 0", () => {
    for (const rules of ["S -> aSb | ε", "S -> aSa | bSb | a | b | ε", "S -> aSbS | bSaS | ε"]) {
      const c = classify(grammar(rules));
      expect(c.type, rules).toBe(0);
      expect(c.contextFreeForm, rules).toBe(true);
    }
  });

  it("6.15: ε-rules on C and D — the notes \"turn it into a CF grammar\"; ε-removal gives type 2", () => {
    const g = grammar("S -> ABCD\nA -> CD | AC\nB -> Cb\nC -> a | ε\nD -> bD | ε");
    const c = classify(g);
    expect(c.type).toBe(0);
    expect(c.contextFreeForm).toBe(true);
    expect(keys(c.reasons.type2.violations)).toEqual(["grammar.classify.deletingRule", "grammar.classify.deletingRule"]);
    expect(classify(removeEpsilonRules(g).value!).type).toBe(2);
  });

  it("4.22: S → aA | bB | b, A → aS | bC, B → aC | bS, C → aB | bA | a is type 3", () => {
    expect(classify(grammar("S -> aA | bB | b\nA -> aS | bC\nB -> aC | bS\nC -> aB | bA | a")).type).toBe(3);
  });

  it("6.26 and its Chomsky normal form are type 2", () => {
    const g = grammar("S -> aSa | bSb | c");
    expect(classify(g).type).toBe(2);
    expect(classify(g).reasons.type3.violations.map((v) => v.params?.rule)).toEqual(["S → aSa", "S → bSb"]);
    expect(classify(toCNF(g).value!).type).toBe(2);
  });

  it("4.23: a left-regular grammar is type 2, not 3 — its language is still regular", () => {
    const c = classify(grammar("S -> Sa | Ab | a\nA -> Aa | b"));
    expect(c.type).toBe(2);
    expect(c.leftLinear).toBe(true);
    expect(c.rightLinear).toBe(false);
  });

  it("type 3 takes one terminal and at most one variable: A → abB and A → B are type 2 (right-linear)", () => {
    for (const rules of ["S -> abS | a", "S -> A | a\nA -> aS | b", "S -> aS | ab"]) {
      const c = classify(grammar(rules));
      expect(c.type, rules).toBe(2);
      expect(c.rightLinear, rules).toBe(true);
    }
  });

  it("4.9 and 12.7: non-contracting grammars are not of the form βAγ → βαγ — type 0 by 4.14", () => {
    const notes49 = grammar("S -> aSBC | abC\nCB -> BC\nbB -> bb\nbC -> bc\ncC -> cc");
    const notes127 = grammar("S -> aBSc | abc\nBa -> aB\nBb -> bb");
    for (const g of [notes49, notes127]) {
      const c = classify(g);
      expect(c.type).toBe(0);
      expect(c.nonContracting).toBe(true);
      expect(keys(c.reasons.type1.violations)).toEqual(["grammar.classify.notContextSensitive"]);
    }
    expect(classify(notes49).reasons.type1.violations[0].params?.rule).toBe("CB → BC");
    expect(classify(notes127).reasons.type1.violations[0].params?.rule).toBe("Ba → aB");
  });

  it("a genuine type-1 grammar for aⁿbⁿcⁿ: CB → BC split into rules that rewrite one variable in place", () => {
    const g = grammar(
      "S -> aSBC | aBC\nCB -> CZ\nCZ -> WZ\nWZ -> WC\nWC -> BC\naB -> ab\nbB -> bb\nbC -> bc\ncC -> cc",
      "S, B, C, W, Z"
    );
    const c = classify(g);
    expect(c.type).toBe(1);
    expect(c.contextFreeForm).toBe(false);
    // the rules one by one: β A γ → β α γ
    for (const rules of ["CB -> CZ", "CZ -> WZ", "WZ -> WC", "WC -> BC", "aB -> ab", "S -> SS"])
      expect(classify(grammar(rules, "S, B, C, W, Z")).reasons.type1.holds, rules).toBe(true);
    for (const rules of ["CB -> BC", "aB -> ba", "ABC -> AC", "aBc -> abcc"])
      expect(classify(grammar(rules, "S, A, B, C")).reasons.type1.holds, rules).toBe(rules === "aBc -> abcc");
  });

  it("S → ε is allowed in every class when S is on no right-hand side", () => {
    expect(classify(grammar("S -> ε | aA\nA -> aA | a")).type).toBe(3);
    expect(classify(grammar("S -> ε | AA\nA -> aAb | ab")).type).toBe(2);
    expect(classify(grammar("S -> ε | aBc\naB -> abb", "S, B")).type).toBe(1);
    // an ε-rule on another variable is allowed nowhere
    expect(keys(classify(grammar("S -> aA\nA -> ε")).reasons.type3.violations)).toEqual(["grammar.classify.deletingRule"]);
  });

  it("the classes are nested on 2000 random grammars, and the class is the highest that holds", () => {
    const next = rng(4142);
    const symbols = ["S", "A", "B", "a", "b"];
    for (let k = 0; k < 2000; k++) {
      const rules: Grammar["rules"] = [];
      const n = 1 + Math.floor(next() * 4);
      for (let i = 0; i < n; i++) {
        const side = (min: number) => {
          const len = min + Math.floor(next() * 3);
          return Array.from({ length: len }, () => symbols[Math.floor(next() * symbols.length)]);
        };
        let left = side(1);
        if (!left.some((x) => x === x.toUpperCase())) left = [...left, "A"];
        rules.push({ left, right: next() < 0.15 ? [] : side(1) });
      }
      const g: Grammar = { kind: "grammar", name: "G", terminals: ["a", "b"], nonterminals: ["S", "A", "B"], start: "S", rules };
      const c = classify(g);
      const { type3, type2, type1 } = c.reasons;
      if (type3.holds) expect(type2.holds).toBe(true);
      if (type2.holds) expect(type1.holds).toBe(true);
      expect(c.type).toBe(type3.holds ? 3 : type2.holds ? 2 : type1.holds ? 1 : 0);
      if (type1.holds) expect(c.nonContracting).toBe(true);
      if (type2.holds) expect(c.contextFreeForm).toBe(true);
      if (type3.holds) expect(c.rightLinear).toBe(true);
    }
  });

  it("ε-removal gives type 2 on 300 random A → α grammars (6.14); with unitfree too", () => {
    const next = rng(77);
    for (let k = 0; k < 300; k++) {
      const g = randomCFG(next);
      const out = removeEpsilonRules(g).value!;
      expect(classify(out).type).toBeGreaterThanOrEqual(2);
      expect(classify(removeUnitRules(out).value!).type).toBeGreaterThanOrEqual(2);
      expect(sorted(cfgWordsUpTo(out, 6))).toEqual(sorted(cfgWordsUpTo(g, 6)));
    }
  });
});

describe("toFsm (lecture notes 4.20)", () => {
  it("the new accepting state is E, as in the notes; another name when E is a variable", () => {
    const m = grammarToFSM(grammar("S -> aA | b\nA -> bS | a", "S, A")).value!;
    expect(m.accept).toEqual(["E"]);
    expect(m.states).toEqual(["S", "A", "E"]);
    const clash = grammarToFSM(grammar("S -> aE | b\nE -> bS | a", "S, E")).value!;
    expect(clash.accept).toEqual(["E′"]);
  });

  it("refuses a grammar that is not right-linear", () => {
    const r = grammarToFSM(grammar("S -> Sa | a"));
    expect(r.ok).toBe(false);
    expect(r.diagnostics[0].title.key).toBe("grammar.toFsm.needsRightLinear.title");
  });
});

describe("the example worksheet's grammars", () => {
  it("G_1 is type 1 and N is a non-contracting type-0 grammar, both of aⁿbⁿcⁿ", async () => {
    const { EXAMPLE_WORKSHEETS } = await import("../state/examples");
    const cells = EXAMPLE_WORKSHEETS.flatMap((w) => w.cells);
    const named = (n: string) => parseGrammar(cells.find((c) => c.startsWith("Grammar:") && c.includes(`name: ${n}\n`))!).value!;
    const g1 = named("G_1");
    const n = named("N");
    expect(classify(g1).type).toBe(1);
    expect(classify(n).type).toBe(0);
    expect(classify(n).nonContracting).toBe(true);
    const { grammarAccepts } = await import("./grammar/grammar");
    for (const g of [g1, n])
      for (const w of allWords(["a", "b", "c"], 6).filter((x) => x !== "")) {
        const k = w.length / 3;
        const inL = w === "a".repeat(k) + "b".repeat(k) + "c".repeat(k);
        expect(grammarAccepts(g, w).verdict, `${g.name} ${w}`).toBe(inL ? "yes" : "no");
      }
  });
});
