import { describe, expect, it } from "vitest";
import { classify, Grammar, removeEpsilonRules } from "./grammar/grammar";
import { isCNF, removeUnitRules, removeUselessSymbols, toCNF } from "./grammar/normalForm";
import { cyk, cykMembership } from "./grammar/cyk";
import { parseGrammar } from "./parse/definitionParser";
import { serializeDefinition } from "./parse/serialize";
import { evaluateCells } from "./workspace";
import { allWords, cfgWordsUpTo, randomCFG, rng, sorted } from "./testing";

const grammar = (start: string, nonterminals: string, rules: string, terminals = "a, b") => {
  const r = parseGrammar(`Grammar:
  name: G
  charset: ${terminals}
  variables: ${nonterminals}
  init: ${start}
  rules:
${rules
  .trim()
  .split("\n")
  .map((l) => `    - ${l.trim()}`)
  .join("\n")}`);
  if (!r.ok) throw new Error(JSON.stringify(r.diagnostics));
  return r.value!;
};

/** Right-hand sides per left-hand side, sorted ("" = ε). */
const ruleSets = (g: Grammar) => {
  const out: Record<string, string[]> = {};
  for (const r of g.rules) (out[r.left] ??= []).push(r.right);
  for (const k of Object.keys(out)) out[k].sort();
  return out;
};

const words = (g: Grammar, maxLength = 6) => sorted(cfgWordsUpTo(g, maxLength));
const withoutEpsilon = (ws: string[]) => ws.filter((w) => w !== "");

const nonterminalSet = (g: Grammar) => new Set(g.nonterminals);
const isUnit = (g: Grammar) => (r: Grammar["rules"][number]) => r.right.length === 1 && nonterminalSet(g).has(r.right);

/**
 * Shortest terminal word length per variable (Infinity = derives no terminal word),
 * by relaxation — an oracle independent of the set fixpoint in removeUselessSymbols.
 */
function shortest(g: Grammar): Map<string, number> {
  const len = new Map(g.nonterminals.map((A) => [A, Infinity]));
  const symLen = (c: string) => len.get(c) ?? 1;
  for (let round = 0; round <= g.nonterminals.length + 1; round++)
    for (const r of g.rules) {
      const l = [...r.right].reduce((s, c) => s + symLen(c), 0);
      if (l < len.get(r.left)!) len.set(r.left, l);
    }
  return len;
}

/** Symbols reachable from the start symbol — a plain DFS over the rules. */
function reachableSymbols(g: Grammar): Set<string> {
  const seen = new Set([g.start]);
  const stack = [g.start];
  while (stack.length) {
    const A = stack.pop()!;
    for (const r of g.rules)
      if (r.left === A)
        for (const c of r.right)
          if (!seen.has(c)) {
            seen.add(c);
            stack.push(c);
          }
  }
  return seen;
}

/**
 * Number of leftmost derivations of the word in a grammar without ε- and unit rules
 * (= the number of derivation trees), by brute-force search over sentential forms.
 */
function countLeftmost(g: Grammar, word: string): number {
  const nt = nonterminalSet(g);
  let count = 0;
  const go = (form: string) => {
    if (form.length > word.length) return; // no rule shortens
    const i = [...form].findIndex((c) => nt.has(c));
    if (i === -1) {
      if (form === word) count++;
      return;
    }
    if (form.slice(0, i) !== word.slice(0, i)) return;
    for (const r of g.rules) if (r.left === form[i]) go(form.slice(0, i) + r.right + form.slice(i + 1));
  };
  go(g.start);
  return count;
}

// lecture notes, Exercise 6.15 (input of 6.19)
const notes615 = grammar(
  "S",
  "S, A, B, C, D",
  `S -> ABCD
   A -> CD | AC
   B -> Cb
   C -> a | ε
   D -> bD | ε`
);

describe("unit-rule elimination (6.3.2)", () => {
  it("gives the grammar of the lecture notes (6.19)", () => {
    const g = removeEpsilonRules(notes615).value!;
    const r = removeUnitRules(g);
    expect(r.ok).toBe(true);
    expect(ruleSets(r.value!)).toEqual(
      ruleSets(
        grammar(
          "S",
          "S, A, B, C, D",
          `S -> ABCD | BCD | BD | BC | Cb | b | ABD | ABC | AB
           A -> CD | a | bD | b | AC
           B -> Cb | b
           C -> a
           D -> bD | b`
        )
      )
    );
    expect(r.steps[1].table!.rows.map((row) => row.slice(0, 2))).toEqual([
      ["S", "{S, B}"],
      ["A", "{A, D, C}"],
      ["B", "{B}"],
      ["C", "{C}"],
      ["D", "{D}"]
    ]);
    expect(r.diagnostics).toEqual([]);
    expect(words(r.value!)).toEqual(words(notes615).filter((w) => w !== ""));
  });

  it("follows chains and cycles of unit rules", () => {
    const g = grammar("S", "S, A, B", "S -> A\nA -> B | a\nB -> A | S | b");
    const out = removeUnitRules(g).value!;
    expect(ruleSets(out)).toEqual({ S: ["a", "b"], A: ["a", "b"], B: ["a", "b"] });
    expect(out.rules.some(isUnit(out))).toBe(false);
  });

  it("A → A is dropped, nothing else changes", () => {
    const g = grammar("S", "S", "S -> S | aSb | ab");
    expect(ruleSets(removeUnitRules(g).value!)).toEqual({ S: ["aSb", "ab"] });
  });

  it("a grammar without unit rules stays the same, in one step", () => {
    const g = grammar("S", "S, A", "S -> aA | b\nA -> b");
    const r = removeUnitRules(g);
    expect(r.value!.rules).toEqual(g.rules);
    expect(r.steps).toHaveLength(1);
    expect(r.steps[0].detail!.key).toBe("grammar.unitfree.step1.detailNone");
  });

  it("warns when ε-rules are still there, with the working order as a fix", () => {
    const g = grammar("S", "S, A", "S -> aA | A\nA -> ε | b");
    const r = removeUnitRules(g);
    expect(r.ok).toBe(true);
    expect(r.diagnostics.map((d) => [d.level, d.title.key, d.fix?.code])).toEqual([
      ["warning", "grammar.unitfree.epsilonFirst.title", "unitfree(epsfree(G))"]
    ]);
    expect(words(r.value!)).toEqual(words(g));
  });

  it("refuses a grammar that is not context-free", () => {
    const r = removeUnitRules(grammar("S", "S, B", "S -> aSB | ab\nbB -> bb"));
    expect(r.ok).toBe(false);
    expect(r.diagnostics[0].title).toEqual({ key: "grammar.needsContextFree.title", params: { opKey: "opNames.unitfree" } });
  });

  it("keeps the language of 500 random grammars, with or without ε-removal first", () => {
    const random = rng(632);
    let withUnits = 0;
    for (let i = 0; i < 500; i++) {
      const g = randomCFG(random);
      if (g.rules.some(isUnit(g))) withUnits++;
      const direct = removeUnitRules(g).value!;
      expect(direct.rules.some(isUnit(direct))).toBe(false);
      expect(words(direct)).toEqual(words(g));

      const after = removeUnitRules(removeEpsilonRules(g).value!);
      expect(after.diagnostics).toEqual([]);
      const out = after.value!;
      expect(out.rules.some(isUnit(out))).toBe(false);
      expect(classify(out).epsilonFree).toBe(true);
      expect(words(out)).toEqual(words(g));
    }
    expect(withUnits).toBeGreaterThan(150);
  });
});

describe("useless symbols (6.3.3)", () => {
  it("gives the rounds and the grammar of the lecture notes (6.21)", () => {
    const g = grammar("S", "S, A, B", "S -> AB | a\nA -> B | b");
    const r = removeUselessSymbols(g);
    expect(r.steps[0].table!.rows).toEqual([
      ["0", "{a, b}"],
      ["1", "{S, A, a, b}"],
      ["2", "{S, A, a, b}"]
    ]);
    expect(r.steps[0].detail!.params).toEqual({ removed: "B" });
    expect(r.steps[1].table!.rows).toEqual([
      ["0", "{S}"],
      ["1", "{S, a}"],
      ["2", "{S, a}"]
    ]);
    expect(r.steps[1].detail!.params).toEqual({ removed: "A, b" });
    const out = r.value!;
    expect(out.rules).toEqual([{ left: "S", right: "a" }]);
    expect(out.nonterminals).toEqual(["S"]);
    expect(out.terminals).toEqual(["a"]);
  });

  it("the order matters (6.22): nothing useless stays", () => {
    const g = grammar("S", "S, A, B", "S -> AB | a\nA -> B | b");
    const out = removeUselessSymbols(g).value!;
    // the reversed order would keep A → b
    expect(out.rules.some((r) => r.left === "A")).toBe(false);
  });

  it("an empty language keeps only the start symbol", () => {
    const g = grammar("S", "S, A", "S -> aS | A\nA -> bA");
    const r = removeUselessSymbols(g);
    expect(r.value!.rules).toEqual([]);
    expect(r.value!.nonterminals).toEqual(["S"]);
    expect(r.diagnostics.map((d) => d.title.key)).toEqual(["grammar.trim.emptyLanguage.title"]);
  });

  it("a grammar without useless symbols stays the same", () => {
    const g = grammar("S", "S, A", "S -> aA | ε\nA -> b");
    const r = removeUselessSymbols(g);
    expect(r.value!.rules).toEqual(g.rules);
    expect(r.value!.terminals).toEqual(["a", "b"]);
    expect(r.steps.map((s) => s.detail!.key)).toEqual(["grammar.trim.step1.detailNone", "grammar.trim.step2.detailNone"]);
  });

  it("keeps the language of 500 random grammars and leaves nothing useless", () => {
    const random = rng(633);
    let changed = 0;
    let empty = 0;
    for (let i = 0; i < 500; i++) {
      const g = randomCFG(random);
      const out = removeUselessSymbols(g).value!;
      expect(words(out)).toEqual(words(g));
      if (out.rules.length !== g.rules.length) changed++;
      if (shortest(g).get(g.start) === Infinity) {
        empty++;
        expect(out.rules).toEqual([]);
        continue;
      }
      // every variable left derives a terminal word and every symbol left is reachable
      const len = shortest(out);
      for (const A of out.nonterminals) expect(len.get(A), `${A} in ${JSON.stringify(out.rules)}`).toBeLessThan(Infinity);
      const reach = reachableSymbols(out);
      for (const x of [...out.nonterminals, ...out.terminals]) expect(reach.has(x), x).toBe(true);
      // and nothing useful was thrown away: idempotent
      expect(removeUselessSymbols(out).value!.rules).toEqual(out.rules);
    }
    expect(changed).toBeGreaterThan(100);
    expect(empty).toBeGreaterThan(10);
  });
});

describe("Chomsky normal form (6.4.1)", () => {
  it("the lecture-note example (6.26), with free letters for Xa and the Ci", () => {
    const g = grammar("S", "S", "S -> aSa | bSb | c", "a, b, c");
    const r = toCNF(g);
    const out = r.value!;
    expect(out.rules).toEqual([
      { left: "S", right: "AC" },
      { left: "C", right: "SA" },
      { left: "S", right: "BD" },
      { left: "D", right: "SB" },
      { left: "S", right: "c" },
      { left: "A", right: "a" },
      { left: "B", right: "b" }
    ]);
    expect(out.nonterminals).toEqual(["S", "A", "B", "C", "D"]);
    expect(r.steps.find((s) => s.title.key === "grammar.cnf.step3.title")!.table!.rows).toEqual([
      ["a", "Xa = A", "A → a"],
      ["b", "Xb = B", "B → b"]
    ]);
    expect(r.steps.find((s) => s.title.key === "grammar.cnf.step4.title")!.table!.rows).toEqual([
      ["S → ASA", "S → AC, C → SA"],
      ["S → BSB", "S → BD, D → SB"]
    ]);
    expect(isCNF(out)).toBe(true);
    expect(words(out, 9)).toEqual(words(g, 9));
  });

  it("needs an ε-free grammar, and says how to get one", () => {
    const r = toCNF(grammar("S", "S", "S -> aSb | ε"));
    expect(r.ok).toBe(false);
    expect(r.diagnostics[0].title.key).toBe("grammar.cnf.needsEpsilonFree.title");
    expect(r.diagnostics[0].fix!.code).toBe("cnf(epsfree(G))");
  });

  it("drops S → ε and says so", () => {
    const g = removeEpsilonRules(grammar("S", "S", "S -> aSb | ε")).value!;
    const r = toCNF(g);
    expect(r.diagnostics.map((d) => d.title.key)).toContain("grammar.cnf.epsilonDropped.title");
    expect(isCNF(r.value!)).toBe(true);
    expect(words(r.value!, 10)).toEqual(withoutEpsilon(words(g, 10)));
  });

  it("new names never clash, even when every Latin capital is taken", () => {
    const vars = [..."ABCDEFGHIJKLMNOPQRSTUVWXYZ"];
    const rules = ["S -> aABb", ...vars.filter((v) => v !== "S").map((v) => `${v} -> a`)].join("\n");
    const g = grammar("S", vars.join(", "), rules);
    const out = toCNF(g).value!;
    expect(isCNF(out)).toBe(true);
    expect(new Set(out.nonterminals).size).toBe(out.nonterminals.length);
    for (const v of out.nonterminals) expect(g.terminals).not.toContain(v);
    expect(out.nonterminals.length).toBe(26 + 2 + 2); // Xa, Xb and two chain variables
    expect(words(out, 5)).toEqual(words(g, 5));
  });

  it("an expanded result parses back to the same grammar", () => {
    const g = grammar("S", "S, A", "S -> aSA | b\nA -> ab", "a, b");
    const out = toCNF(g).value!;
    const back = parseGrammar(serializeDefinition(out));
    expect(back.ok, JSON.stringify(back.diagnostics)).toBe(true);
    // the YAML groups the rules by left-hand side, so only the order may change
    expect(ruleSets(back.value!)).toEqual(ruleSets(out));
    expect(back.value!.nonterminals).toEqual(out.nonterminals);
  });

  it("is in CNF and keeps L(G) \\ {ε} for 500 random grammars", () => {
    const random = rng(641);
    for (let i = 0; i < 500; i++) {
      const g = randomCFG(random);
      const r = toCNF(removeEpsilonRules(g).value!);
      expect(r.ok).toBe(true);
      const out = r.value!;
      expect(isCNF(out), JSON.stringify(out.rules)).toBe(true);
      expect(new Set(out.nonterminals).size).toBe(out.nonterminals.length);
      expect(words(out)).toEqual(withoutEpsilon(words(g)));
    }
  });
});

describe("CYK (8.1)", () => {
  const notes81 = grammar(
    "S",
    "S, A, B, C",
    `S -> AB | BC
     A -> BA | a
     B -> CC | b
     C -> AB | a`
  );

  it("fills the table of the lecture notes", () => {
    const r = cyk(notes81, "baaba").value!;
    const cell = (j: number, i: number) => [...r.cells[j - 1][i - 1].keys()].sort().join(",");
    expect([1, 2, 3, 4, 5].map((i) => cell(1, i))).toEqual(["B", "A,C", "A,C", "B", "A,C"]);
    expect([1, 2, 3, 4].map((i) => cell(2, i))).toEqual(["A,S", "B", "C,S", "A,S"]);
    expect([1, 2, 3].map((i) => cell(3, i))).toEqual(["", "B", "B"]);
    expect([1, 2].map((i) => cell(4, i))).toEqual(["", "A,C,S"]);
    expect(cell(5, 1)).toBe("A,C,S");
    expect(r.accepted).toBe(true);
    expect(r.trees).toBe(BigInt(countLeftmost(notes81, "baaba")));
  });

  it("counts the derivation trees: S → SS | a gives the Catalan numbers", () => {
    const g = grammar("S", "S", "S -> SS | a", "a");
    const catalan = [1, 1, 2, 5, 14, 42, 132, 429];
    for (let n = 1; n <= 8; n++) expect(cyk(g, "a".repeat(n)).value!.trees).toBe(BigInt(catalan[n - 1]));
    expect(cyk(g, "a".repeat(20)).value!.trees).toBe(1767263190n);
  });

  it("needs a grammar in CNF", () => {
    const r = cyk(grammar("S", "S", "S -> aSb | ab"), "ab");
    expect(r.ok).toBe(false);
    expect(r.diagnostics[0].title.key).toBe("grammar.cyk.needsCNF.title");
  });

  it("a letter outside the alphabet is never derivable", () => {
    expect(cyk(notes81, "bac").value!.accepted).toBe(false);
  });

  it("decides membership exactly for 300 random grammars, every word up to length 6", () => {
    const random = rng(81);
    const all = allWords(["a", "b"], 6);
    let accepted = 0;
    for (let i = 0; i < 300; i++) {
      const g = randomCFG(random);
      const lang = cfgWordsUpTo(g, 6);
      for (const w of all) {
        const m = cykMembership(g, w).value!;
        expect(m.accepted, `${w} in ${JSON.stringify(g.rules)}`).toBe(lang.has(w));
        if (m.accepted) accepted++;
      }
    }
    expect(accepted).toBeGreaterThan(1500);
  });

  it("the tree count matches brute force on random CNF grammars", () => {
    const random = rng(82);
    let ambiguous = 0;
    for (let i = 0; i < 150; i++) {
      const g = toCNF(removeEpsilonRules(randomCFG(random)).value!).value!;
      for (const w of allWords(["a", "b"], 5)) {
        if (w === "") continue;
        const trees = cyk(g, w).value!.trees;
        expect(trees, `${w} in ${JSON.stringify(g.rules)}`).toBe(BigInt(countLeftmost(g, w)));
        if (trees > 1n) ambiguous++;
      }
    }
    expect(ambiguous).toBeGreaterThan(50);
  });

  it("ε is decided by the nullable start symbol, without a table", () => {
    expect(cykMembership(grammar("S", "S", "S -> aSb | ε"), "").value).toEqual({
      accepted: true,
      table: null,
      cnf: null,
      converted: false
    });
    expect(cykMembership(grammar("S", "S", "S -> aSb | ab"), "").value!.accepted).toBe(false);
  });

  it("runs on the grammar itself when it is in CNF, on cnf(epsfree(G)) otherwise", () => {
    expect(cykMembership(notes81, "baaba").value!.converted).toBe(false);
    const m = cykMembership(grammar("S", "S", "S -> aSb | ε"), "aabb").value!;
    expect(m.converted).toBe(true);
    expect(m.accepted).toBe(true);
    expect(isCNF(m.cnf!)).toBe(true);
  });
});

describe("grammar transformations in a worksheet", () => {
  const src = `Grammar:
  name: G
  charset: a, b
  variables: S, A, B
  init: S
  rules:
    - S -> aSb | A | ε
    - A -> aA | B
    - B -> b`;

  it("chain like the lecture notes: trim(unitfree(epsfree(G))) and cnf(epsfree(G))", () => {
    const rs = evaluateCells([src, "T = trim(unitfree(epsfree(G)))", "C = cnf(epsfree(G))"]);
    const g = rs[0].value as Grammar;
    const t = rs[1].value as Grammar;
    const c = rs[2].value as Grammar;
    expect(t.kind).toBe("grammar");
    expect(words(t, 8)).toEqual(words(g, 8));
    expect(isCNF(c)).toBe(true);
    expect(words(c, 8)).toEqual(withoutEpsilon(words(g, 8)));
    expect(rs[1].stepGroups.map((s) => s.operation)).toEqual(["epsfree(G)", "unitfree(epsfree(G))", "trim(unitfree(epsfree(G)))"]);
  });

  it("cnf on a grammar with ε-rules explains and offers the fix", () => {
    const rs = evaluateCells([src, "C = cnf(G)"]);
    expect(rs[1].value).toBeNull();
    expect(rs[1].diagnostics[0].fix?.code).toBe("cnf(epsfree(G))");
  });

  it("an automaton is not a grammar", () => {
    const rs = evaluateCells([
      `Machine:
  name: M
  charset: a
  states: S
  init: S
  accept: S
  transitions:
    - S a S`,
      "X = cnf(M)"
    ]);
    expect(rs[1].value).toBeNull();
    expect(rs[1].diagnostics[0].detail).toEqual({
      key: "expression.error.needsGrammar",
      params: { opKey: "opNames.cnf", kindKey: "machineKind.fsm" }
    });
  });
});
