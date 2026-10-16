import { describe, expect, it } from "vitest";
import { classify, Grammar, removeEpsilonRules } from "./grammar/grammar";
import { parseGrammar } from "./parse/definitionParser";
import { evaluateCells } from "./workspace";
import { cfgWordsUpTo, randomCFG, rng, sorted } from "./testing";

const grammar = (start: string, nonterminals: string, rules: string, terminals = "a, b") =>
  parseGrammar(`Grammar:
  name: G
  charset: ${terminals}
  variables: ${nonterminals}
  init: ${start}
  rules:
${rules
  .trim()
  .split("\n")
  .map((l) => `    - ${l.trim()}`)
  .join("\n")}`).value!;

/** Right-hand sides per left-hand side, in rule order ("" = ε). */
const byLeft = (g: Grammar) => {
  const out: Record<string, string[]> = {};
  for (const r of g.rules) (out[r.left] ??= []).push(r.right);
  return out;
};

/** The invariants every result must satisfy (lecture notes, 6.3.1 and Theorem 6.14). */
function expectEpsilonFree(original: Grammar, out: Grammar) {
  for (const r of out.rules) {
    if (r.right === "") {
      expect(r.left, "an ε-rule may only stay on a new start symbol").toBe(out.start);
      expect(out.start).not.toBe(original.start);
    }
    // the algorithm never creates an A → A rule (an ε-free input is returned unchanged)
    if (r.right === r.left) expect(original.rules, `created ${r.left} → ${r.right}`).toContainEqual(r);
  }
  expect(out.rules.some((r) => r.right.includes(out.start) && out.start !== original.start)).toBe(false);
  const keys = out.rules.map((r) => `${r.left}→${r.right}`);
  expect(new Set(keys).size, "no duplicate rules").toBe(keys.length);
  const c = classify(out);
  expect(c.epsilonFree).toBe(true);
  expect(c.reasons.type2.holds).toBe(true);
}

/** L(out) = L(original), compared word by word up to the given length. */
function expectSameLanguage(original: Grammar, out: Grammar, maxLength = 7) {
  expect(sorted(cfgWordsUpTo(out, maxLength))).toEqual(sorted(cfgWordsUpTo(original, maxLength)));
}

describe("grammar ε-rule elimination", () => {
  // lecture notes, Exercise 6.15
  const notes615 = grammar(
    "S",
    "S, A, B, C, D",
    `S -> ABCD
     A -> CD | AC
     B -> Cb
     C -> a | ε
     D -> bD | ε`
  );

  it("finds the nullable variables round by round, as in the lecture notes (6.15)", () => {
    const r = removeEpsilonRules(notes615);
    expect(r.ok).toBe(true);
    const step1 = r.steps[0];
    expect(step1.title.key).toBe("grammar.epsfree.step1.title");
    expect(step1.table!.rows).toEqual([
      ["1", "{C, D}"],
      ["2", "{A, C, D}"],
      ["3", "{A, C, D}"]
    ]);
    expect(step1.detail).toEqual({
      key: "grammar.epsfree.step1.detailSome",
      params: { nullable: "{A, C, D}", rounds: 3 }
    });
  });

  it("produces exactly the grammar of the lecture notes (6.15)", () => {
    const out = removeEpsilonRules(notes615).value!;
    expect(out.start).toBe("S");
    expect(out.nonterminals).toEqual(["S", "A", "B", "C", "D"]);
    const rules = byLeft(out);
    // the same order as in the lecture notes
    expect(rules.S).toEqual(["ABCD", "BCD", "ABD", "ABC", "BD", "BC", "AB", "B"]);
    expect([...rules.A].sort()).toEqual(["AC", "C", "CD", "D"]);
    expect(rules.B).toEqual(["Cb", "b"]);
    expect(rules.C).toEqual(["a"]);
    expect(rules.D).toEqual(["bD", "b"]);
    expect(Object.keys(rules).sort()).toEqual(["A", "B", "C", "D", "S"]);
    expectEpsilonFree(notes615, out);
    expectSameLanguage(notes615, out);
  });

  it("shows every rule's variants in the second step", () => {
    const step2 = removeEpsilonRules(notes615).steps[1];
    expect(step2.title.key).toBe("grammar.epsfree.step2.title");
    expect(step2.table!.rows).toEqual([
      ["S → ABCD", "S → ABCD | BCD | ABD | ABC | BD | BC | AB | B"],
      ["A → CD", "A → CD | D | C"],
      ["A → AC", "A → AC | C"],
      ["B → Cb", "B → Cb | b"],
      ["C → a", "C → a"],
      ["C → ε", "—"],
      ["D → bD", "D → bD | b"],
      ["D → ε", "—"]
    ]);
  });

  it("a nullable start symbol gets a new start symbol S′ → S | ε", () => {
    const g = grammar("S", "S", "S -> aSb | ε");
    const r = removeEpsilonRules(g);
    const out = r.value!;
    expect(out.start).toBe("Z");
    expect(out.nonterminals).toEqual(["Z", "S"]);
    expect(byLeft(out)).toEqual({ Z: ["S", ""], S: ["aSb", "ab"] });
    expect(r.steps.map((s) => s.title.key)).toEqual([
      "grammar.epsfree.step1.title",
      "grammar.epsfree.step2.title",
      "grammar.epsfree.step3.title"
    ]);
    expect(r.steps[2].detail).toEqual({ key: "grammar.epsfree.step3.detail", params: { s2: "Z", start: "S" } });
    expectEpsilonFree(g, out);
    expectSameLanguage(g, out, 10);
  });

  it("the new start symbol is a fresh one", () => {
    const g = grammar("S", "S, Z", "S -> Z | a\nZ -> ε");
    const out = removeEpsilonRules(g).value!;
    expect(out.start).toBe("Y");
    expectEpsilonFree(g, out);
    expectSameLanguage(g, out);
  });

  it("the language {ε} keeps only ε", () => {
    const g = grammar("S", "S", "S -> ε");
    const out = removeEpsilonRules(g).value!;
    expect(cfgWordsUpTo(out, 5)).toEqual(new Set([""]));
    expectEpsilonFree(g, out);
  });

  it("an ε-free grammar stays the same, in one step", () => {
    const g = grammar("S", "S, A", "S -> aA | b\nA -> b");
    const r = removeEpsilonRules(g);
    expect(r.value!.rules).toEqual(g.rules);
    expect(r.value!.start).toBe("S");
    expect(r.steps).toHaveLength(1);
    expect(r.steps[0].detail!.key).toBe("grammar.epsfree.step1.detailNone");
    expect(r.steps[0].table).toBeUndefined();
  });

  it("drops the useless A → A rules it would create", () => {
    const g = grammar("S", "S, A", "S -> AA | a\nA -> ε | b");
    const out = removeEpsilonRules(g).value!;
    expect(byLeft(out).S).toEqual(["AA", "A", "a"]);
    expect(out.rules.some((r) => r.left === r.right)).toBe(false);
    expectEpsilonFree(g, out);
    expectSameLanguage(g, out);
  });

  it("a regular grammar stays regular (lecture notes, 6.16)", () => {
    const g = grammar("S", "S, A", "S -> aS | bA | ε\nA -> bA | ε");
    const out = removeEpsilonRules(g).value!;
    expect(classify(out).type).toBe(3);
    expectEpsilonFree(g, out);
    expectSameLanguage(g, out);
  });

  it("refuses a grammar that is not context-free", () => {
    const g = grammar("S", "S, B", "S -> aSB | ε\naB -> ab", "a, b");
    const r = removeEpsilonRules(g);
    expect(r.ok).toBe(false);
    expect(r.diagnostics[0].title.key).toBe("grammar.epsfree.needsContextFree.title");
  });

  it("keeps the language of 500 random context-free grammars", () => {
    const random = rng(615);
    let withNullable = 0;
    let startNullable = 0;
    for (let i = 0; i < 500; i++) {
      const g = randomCFG(random);
      const r = removeEpsilonRules(g);
      expect(r.ok).toBe(true);
      const out = r.value!;
      if (r.steps[0].table) withNullable++;
      if (out.start !== g.start) startNullable++;
      expectEpsilonFree(g, out);
      expectSameLanguage(g, out, 6);
    }
    // the sample must actually exercise the algorithm
    expect(withNullable).toBeGreaterThan(250);
    expect(startNullable).toBeGreaterThan(80);
  });
});

describe("epsfree on a grammar in a worksheet", () => {
  const src = `Grammar:
  name: G
  charset: a, b
  variables: S, A
  init: S
  rules:
    - S -> aSb | A
    - A -> bA | ε`;

  it("returns a grammar, with the steps", () => {
    const rs = evaluateCells([src, "E = epsfree(G)"]);
    const out = rs[1].value as Grammar;
    expect(out.kind).toBe("grammar");
    expect(out.rules.filter((r) => r.right === "")).toEqual([{ left: out.start, right: "" }]);
    expect(rs[1].stepGroups.map((g) => g.operation)).toEqual(["epsfree(G)"]);
    expectSameLanguage(rs[0].value as Grammar, out, 8);
  });

  it("a right-linear grammar stays a grammar instead of turning into an automaton", () => {
    const rs = evaluateCells([
      `Grammar:
  name: G
  charset: a
  variables: S
  init: S
  rules:
    - S -> aS | ε`,
      "E = epsfree(G)"
    ]);
    expect(rs[1].value?.kind).toBe("grammar");
  });

  it("an automaton still gets its ε-transitions removed", () => {
    const rs = evaluateCells([
      `Machine:
  name: M
  charset: a
  states: S, A
  init: S
  accept: A
  transitions:
    - S ε A
    - A a A`,
      "E = epsfree(M)"
    ]);
    expect(rs[1].value?.kind).toBe("machine");
  });
});
