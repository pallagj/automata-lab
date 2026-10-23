import { describe, expect, it } from "vitest";
import { EPS } from "./types";
import { fsmToGrammar, Grammar, removeEpsilonRules } from "./grammar/grammar";
import { removeUnitRules, toCNF } from "./grammar/normalForm";
import { cyk, cykMembership } from "./grammar/cyk";
import { derivationTrees, leftmostDerivation, treeAnimation, TreeNode } from "./grammar/derivationTree";
import { makeFSM } from "./fsm/fsm";
import { parseGrammar } from "./parse/definitionParser";
import { allWords, cfgWordsUpTo, randomCFG, rng } from "./testing";

const grammar = (start: string, variables: string, rules: string, terminals = "a, b") => {
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
  if (!r.ok) throw new Error(JSON.stringify(r.diagnostics));
  return r.value!;
};

/** A tree written as text: S(a S(ε) b). */
const show = (t: TreeNode): string => (t.children ? `${t.symbol}(${t.children.map(show).join(" ")})` : t.symbol);
const forms = (t: TreeNode) => leftmostDerivation(t).forms.map((f) => f.join("") || EPS);
const allTrees = (g: Grammar, w: string) => {
  const r = derivationTrees(g, w).value!;
  return Array.from({ length: Number(r.listed) }, (_, k) => r.tree(BigInt(k)));
};

/**
 * Checks a tree against the definition: the root is the start variable, the children of
 * every variable are the right-hand side of the rule it names (a single ε leaf for an
 * ε-rule), the leaves read left to right give the word. Says whether a variable comes
 * again over the same subword on some path from the root.
 */
function checkTree(g: Grammar, t: TreeNode, word: string): { repeats: boolean } {
  const nt = new Set(g.nonterminals);
  expect(t.symbol).toBe(g.start);
  const span = new Map<TreeNode, string>();
  let at = 0;
  const walk = (x: TreeNode) => {
    if (!x.children) {
      expect(nt.has(x.symbol), `leaf ${x.symbol}`).toBe(false);
      if (x.symbol !== EPS) expect(x.symbol).toBe(word[at++]);
      return;
    }
    const rule = g.rules[x.rule!];
    expect(rule.left).toEqual([x.symbol]);
    expect(x.children.map((c) => c.symbol)).toEqual(rule.right.length === 0 ? [EPS] : rule.right);
    const from = at;
    x.children.forEach(walk);
    span.set(x, `${x.symbol}[${from},${at})`);
  };
  walk(t);
  expect(at).toBe([...word].length);
  const repeats = (x: TreeNode, path: Set<string>): boolean =>
    !!x.children && (path.has(span.get(x)!) || x.children.some((c) => repeats(c, new Set(path).add(span.get(x)!))));
  return { repeats: repeats(t, new Set()) };
}

/**
 * The derivation trees counted straight from the definition, without the tables: a variable
 * over word[i … j) takes a rule and every way of cutting the span among its symbols. A
 * variable may occur at most `limit` times over the same span on a path from the root —
 * its ancestors over that span are the only ones that can come again below it, so they
 * are all a subtree's count depends on.
 */
function bruteTrees(g: Grammar, word: string, limit: number): number {
  const nt = new Set(g.nonterminals);
  const w = [...word];
  const memo = new Map<string, number>();
  const go = (A: string, i: number, j: number, above: string[]): number => {
    if (above.filter((B) => B === A).length >= limit) return 0;
    const key = `${A},${i},${j}|${[...above].sort().join(",")}`;
    if (memo.has(key)) return memo.get(key)!;
    const inner = [...above, A];
    let total = 0;
    for (const r of g.rules) {
      if (r.left[0] !== A) continue;
      // every cut i = m₀ ≤ m₁ ≤ … ≤ m_k = j
      const cut = (d: number, m: number): number => {
        if (d === r.right.length) return m === j ? 1 : 0;
        const x = r.right[d];
        let sum = 0;
        for (let e = m; e <= j; e++) {
          const here = nt.has(x) ? go(x, m, e, m === i && e === j ? inner : []) : e === m + 1 && w[m] === x ? 1 : 0;
          if (here > 0) sum += here * cut(d + 1, e);
        }
        return sum;
      };
      total += cut(0, i);
    }
    memo.set(key, total);
    return total;
  };
  return go(g.start, 0, w.length, []);
}

/** The leftmost derivations of a word in a grammar with no ε-rule and no unit rule: each step lengthens the form or adds a letter. */
function countLeftmost(g: Grammar, word: string): number {
  const nt = new Set(g.nonterminals);
  const target = [...word];
  let count = 0;
  const go = (form: string[]) => {
    if (form.length > target.length) return;
    const i = form.findIndex((c) => nt.has(c));
    if (i === -1) {
      if (form.join("") === word) count++;
      return;
    }
    for (let k = 0; k < i; k++) if (form[k] !== target[k]) return;
    for (const r of g.rules) if (r.left[0] === form[i]) go([...form.slice(0, i), ...r.right, ...form.slice(i + 1)]);
  };
  go([g.start]);
  return count;
}

// lecture notes, 6.2 and 6.6: the arithmetic expressions
const arithmetic = grammar("E", "E", "E -> E+E | E*E | (E) | a", "a, +, *, (, )");
// lecture notes, (6.1): the unambiguous grammar of the same language
const layered = grammar("E", "E, T, F", "E -> E+T | T\nT -> T*F | F\nF -> (E) | a", "a, +, *, (, )");

describe("derivation trees (lecture notes 6.1)", () => {
  it("finds the two trees of a+a*a, as 6.6 draws them", () => {
    const r = derivationTrees(arithmetic, "a+a*a").value!;
    expect(r.count).toBe(2n);
    expect(r.listed).toBe(2n);
    expect(r.repeat).toBeUndefined();
    expect(allTrees(arithmetic, "a+a*a").map(show)).toEqual([
      "E(E(a) + E(E(a) * E(a)))",
      "E(E(E(a) + E(a)) * E(a))"
    ]);
  });

  it("gives each tree its leftmost derivation, the two of 6.6", () => {
    const [plus, times] = allTrees(arithmetic, "a+a*a");
    expect(forms(plus)).toEqual(["E", "E+E", "a+E", "a+E*E", "a+a*E", "a+a*a"]);
    expect(forms(times)).toEqual(["E", "E*E", "E+E*E", "a+E*E", "a+a*E", "a+a*a"]);
    // the rule applied at each step, as 6.2 numbers them above the arrows
    expect(leftmostDerivation(plus).rewritten.map((n) => n.rule! + 1)).toEqual([1, 4, 2, 4, 4]);
  });

  it("the grammar (6.1) derives every expression with exactly one tree, the same words as the ambiguous one", () => {
    const [tree] = allTrees(layered, "a+a*a");
    expect(show(tree)).toBe("E(E(T(F(a))) + T(T(F(a)) * F(a)))");
    expect(forms(tree)).toEqual(["E", "E+T", "T+T", "F+T", "a+T", "a+T*F", "a+F*F", "a+a*F", "a+a*a"]);
    // |w| = 1: only E ⇒ T ⇒ F ⇒ a
    expect(forms(allTrees(layered, "a")[0])).toEqual(["E", "T", "F", "a"]);
    for (const w of allWords(["a", "+", "*", "(", ")"], 5)) {
      const one = derivationTrees(layered, w).value!.count!;
      const many = derivationTrees(arithmetic, w).value!.count!;
      expect(one <= 1n, w).toBe(true);
      expect(one > 0n, w).toBe(many > 0n);
    }
    for (const w of cfgWordsUpTo(layered, 9)) expect(derivationTrees(layered, w).value!.count, w).toBe(1n);
  });

  it("counts the trees of a+a+…+a: the Catalan numbers", () => {
    const catalan = [1n, 1n, 2n, 5n, 14n, 42n, 132n, 429n];
    for (let n = 1; n <= 8; n++)
      expect(derivationTrees(arithmetic, Array(n).fill("a").join("+")).value!.count).toBe(catalan[n - 1]);
    const g = grammar("S", "S", "S -> SS | a", "a");
    expect(derivationTrees(g, "a".repeat(20)).value!.count).toBe(1767263190n);
    expect(derivationTrees(g, "a".repeat(30)).value!.count).toBe(1002242216651368n);
    // and any one of them, without building the others
    const r = derivationTrees(g, "a".repeat(30)).value!;
    for (const k of [0n, 1n, 123456789n, r.listed - 1n]) checkTree(g, r.tree(k), "a".repeat(30));
    expect(show(r.tree(0n)).startsWith("S(S(a) S(S(a) S(")).toBe(true);
  });

  it("an ε-rule gives an ε leaf", () => {
    const g = grammar("S", "S", "S -> aSb | ε");
    expect(allTrees(g, "").map(show)).toEqual(["S(ε)"]);
    expect(forms(allTrees(g, "")[0])).toEqual(["S", "ε"]);
    expect(allTrees(g, "aabb").map(show)).toEqual(["S(a S(a S(ε) b) b)"]);
    expect(forms(allTrees(g, "aabb")[0])).toEqual(["S", "aSb", "aaSbb", "aabb"]);
  });

  it("a word that is not derivable has no tree", () => {
    const g = grammar("S", "S", "S -> aSb | ε");
    for (const w of ["aab", "ba", "c", "abc"]) {
      const r = derivationTrees(g, w).value!;
      expect(r.count).toBe(0n);
      expect(r.listed).toBe(0n);
      expect(() => r.tree(0n)).toThrow(RangeError);
    }
    expect(derivationTrees(grammar("S", "S", "S -> a"), "").value!.count).toBe(0n);
  });

  it("a regular grammar's tree hangs every letter to the left (6.3), one tree per word of a DFA", () => {
    const g = grammar("S", "S, A", "S -> aS | bA\nA -> bA | b");
    const [t] = allTrees(g, "aabb");
    expect(show(t)).toBe("S(a S(a S(b A(b))))");
    expect(forms(t)).toEqual(["S", "aS", "aaS", "aabA", "aabb"]);
    // a DFA's grammar: exactly one tree for each accepted word, none for the others
    const dfa = makeFSM({
      name: "M",
      alphabet: ["a", "b"],
      states: ["p", "q", "r"],
      start: "p",
      accept: ["r"],
      transitions: [
        { from: "p", symbol: "a", to: "q" },
        { from: "p", symbol: "b", to: "p" },
        { from: "q", symbol: "a", to: "q" },
        { from: "q", symbol: "b", to: "r" },
        { from: "r", symbol: "a", to: "q" },
        { from: "r", symbol: "b", to: "p" }
      ]
    });
    const dg = fsmToGrammar(dfa).value!;
    for (const w of allWords(["a", "b"], 7)) expect(derivationTrees(dg, w).value!.count, w).toBe(w.endsWith("ab") ? 1n : 0n);
  });

  it("a variable deriving itself over the same subword gives infinitely many trees", () => {
    const unit = derivationTrees(grammar("S", "S", "S -> S | a", "a"), "a").value!;
    expect(unit.count).toBeNull();
    expect(unit.repeat).toEqual({ variable: "S", subword: "a" });
    expect(unit.listed).toBe(1n);
    expect(show(unit.tree(0n))).toBe("S(a)");

    const cycle = grammar("S", "S, A", "S -> A | a\nA -> S | b");
    const b = derivationTrees(cycle, "b").value!;
    expect([b.count, b.listed, show(b.tree(0n))]).toEqual([null, 1n, "S(A(b))"]);
    expect(b.repeat?.subword).toBe("b");

    // through a symbol that vanishes: S ⇒ SA ⇒ S
    const vanish = derivationTrees(grammar("S", "S, A", "S -> SA | a\nA -> ε", "a"), "a").value!;
    expect([vanish.count, vanish.listed, show(vanish.tree(0n))]).toEqual([null, 1n, "S(a)"]);

    const empty = derivationTrees(grammar("S", "S", "S -> SS | ε", "a"), "").value!;
    expect([empty.count, empty.listed, show(empty.tree(0n))]).toEqual([null, 1n, "S(ε)"]);
    expect(empty.repeat).toEqual({ variable: "S", subword: "" });

    // a repeat inside, not at the root: aa itself has no loop, its letters do
    const inner = derivationTrees(grammar("S", "S, A", "S -> AA\nA -> A | a", "a"), "aa").value!;
    expect([inner.count, inner.listed, show(inner.tree(0n))]).toEqual([null, 1n, "S(A(a) A(a))"]);
    expect(inner.repeat).toEqual({ variable: "A", subword: "a" });
  });

  it("with infinitely many trees, numbers those without a repeat", () => {
    const g = grammar("S", "S, A, B", "S -> A | B\nA -> B | a\nB -> A | a", "a");
    const r = derivationTrees(g, "a").value!;
    expect(r.count).toBeNull();
    expect(allTrees(g, "a").map(show)).toEqual(["S(A(B(a)))", "S(A(a))", "S(B(A(a)))", "S(B(a))"]);
  });

  it("a loop of too many variables numbers one tree only", () => {
    // S → A_1 → A_2 → … → A_24 → S, each also → a
    const vars = ["S", ...Array.from({ length: 24 }, (_, k) => `A_${k + 1}`)];
    const g: Grammar = {
      kind: "grammar",
      name: "G",
      terminals: ["a"],
      nonterminals: vars,
      start: "S",
      rules: vars.flatMap((A, k) => [
        { left: [A], right: [vars[(k + 1) % vars.length]] },
        { left: [A], right: ["a"] }
      ])
    };
    const r = derivationTrees(g, "a").value!;
    expect([r.count, r.listed, r.partial]).toEqual([null, 1n, true]);
    expect(checkTree(g, r.tree(0n), "a").repeats).toBe(false);
    expect(() => r.tree(1n)).toThrow(RangeError);
  });

  it("gives up numbering, not the answer, when the repeat-free trees are too many to count", () => {
    // every variable derives every other one: the repeat-free trees are the simple paths from S
    const vars = ["S", ...Array.from({ length: 14 }, (_, k) => `A_${k + 1}`)];
    const g: Grammar = {
      kind: "grammar",
      name: "G",
      terminals: ["a"],
      nonterminals: vars,
      start: "S",
      rules: vars.flatMap((A) => [...vars.filter((B) => B !== A).map((B) => ({ left: [A], right: [B] })), { left: [A], right: ["a"] }])
    };
    const r = derivationTrees(g, "a").value!;
    expect(r.count).toBeNull();
    // Σ 14!/j! simple paths from S, when it got there
    let paths = 0n;
    for (let j = 0n, f = 1n; j <= 14n; j++, f *= 15n - j) paths += f;
    if (!r.partial) expect(r.listed).toBe(paths);
    expect(checkTree(g, r.tree(0n), "a").repeats).toBe(false);
  });

  it("needs rules of the form A → α", () => {
    const g = grammar("S", "S, B", "S -> aSB | ab\nbB -> bb", "a, b");
    const r = derivationTrees(g, "ab");
    expect(r.ok).toBe(false);
    expect(r.diagnostics[0].title.key).toBe("grammar.needsContextFree.title");
  });

  it("CNF grammars: as many trees as CYK counts, for 100 random grammars and every word up to length 6", () => {
    const random = rng(61);
    const words = allWords(["a", "b"], 6).filter((w) => w !== "");
    let ambiguous = 0;
    for (let i = 0; i < 100; i++) {
      const g = toCNF(removeEpsilonRules(randomCFG(random)).value!).value!;
      for (const w of words) {
        const trees = cyk(g, w).value!.trees;
        expect(derivationTrees(g, w).value!.count, `${w} in ${JSON.stringify(g.rules)}`).toBe(trees);
        if (trees > 1n) ambiguous++;
      }
    }
    expect(ambiguous).toBeGreaterThan(50);
  });

  it("no ε-rule and no unit rule: as many trees as leftmost derivations (6.5), for 100 random grammars", () => {
    const random = rng(65);
    const words = allWords(["a", "b"], 5);
    let several = 0;
    for (let i = 0; i < 100; i++) {
      const g = removeUnitRules(removeEpsilonRules(randomCFG(random)).value!).value!;
      g.rules = g.rules.filter((r) => r.right.length > 0);
      for (const w of words) {
        const count = derivationTrees(g, w).value!.count;
        expect(count, `${w} in ${JSON.stringify(g.rules)}`).toBe(BigInt(countLeftmost(g, w)));
        if (count! > 1n) several++;
      }
    }
    expect(several).toBeGreaterThan(50);
  });

  it("any grammar: derivable exactly when CYK says so, infinitely many trees exactly when one repeats, for 300 random grammars", () => {
    const random = rng(66);
    const words = allWords(["a", "b"], 3);
    const seen = { infinite: 0, several: 0, accepted: 0 };
    for (let i = 0; i < 300; i++) {
      const g = randomCFG(random);
      const lang = cfgWordsUpTo(g, 3);
      for (const w of words) {
        const r = derivationTrees(g, w).value!;
        const what = `${JSON.stringify(w)} in ${JSON.stringify(g.rules)}`;
        expect(r.listed > 0n, what).toBe(cykMembership(g, w).value!.accepted);
        expect(r.listed > 0n, what).toBe(lang.has(w));
        // the repeat-free trees, counted from the definition; one more allowed repeat adds trees exactly when there are infinitely many
        const once = bruteTrees(g, w, 1);
        expect(r.listed, what).toBe(BigInt(once));
        expect(r.count === null, what).toBe(bruteTrees(g, w, 2) > once);
        expect(r.repeat !== undefined, what).toBe(r.count === null);
        if (r.listed > 0n) seen.accepted++;
        if (r.count === null) seen.infinite++;
        else if (r.count > 1n) seen.several++;
      }
    }
    expect(seen.accepted).toBeGreaterThan(300);
    expect(seen.infinite).toBeGreaterThan(50);
    expect(seen.several).toBeGreaterThan(50);
  });

  it("every numbered tree is a derivation tree of the word, without a repeat, and no two are the same", () => {
    const random = rng(67);
    const words = allWords(["a", "b"], 4);
    let checked = 0;
    for (let i = 0; i < 80; i++) {
      const g = randomCFG(random);
      for (const w of words) {
        const r = derivationTrees(g, w).value!;
        if (r.listed === 0n || r.listed > 300n) continue;
        const shown = new Set<string>();
        for (let k = 0n; k < r.listed; k++) {
          const t = r.tree(k);
          expect(checkTree(g, t, w).repeats, show(t)).toBe(false);
          shown.add(show(t));
          checked++;
        }
        expect(shown.size).toBe(Number(r.listed));
        expect(() => r.tree(r.listed)).toThrow(RangeError);
        expect(() => r.tree(-1n)).toThrow(RangeError);
      }
    }
    expect(checked).toBeGreaterThan(1000);
  });

  it("the leftmost derivation rewrites the leftmost variable each step, by the rule of its node", () => {
    const random = rng(68);
    let checked = 0;
    for (let i = 0; i < 100; i++) {
      const g = randomCFG(random);
      const nt = new Set(g.nonterminals);
      for (const w of allWords(["a", "b"], 4)) {
        const r = derivationTrees(g, w).value!;
        for (let k = 0n; k < r.listed && k < 5n; k++) {
          const t = r.tree(k);
          const { forms: f, rewritten } = leftmostDerivation(t);
          expect(f[0]).toEqual([g.start]);
          expect(f[f.length - 1].join("")).toBe(w);
          expect(rewritten.length).toBe(f.length - 1);
          rewritten.forEach((node, s) => {
            const at = f[s].findIndex((c) => nt.has(c));
            const rule = g.rules[node.rule!];
            expect(f[s][at]).toBe(node.symbol);
            expect(f[s + 1]).toEqual([...f[s].slice(0, at), ...rule.right, ...f[s].slice(at + 1)]);
          });
          checked++;
        }
      }
    }
    expect(checked).toBeGreaterThan(300);
  });

  it("the tree grows along its leftmost derivation, a variable a frame", () => {
    const [plus] = allTrees(arithmetic, "a+a*a");
    const frames = treeAnimation(arithmetic, plus);
    expect(frames.map((f) => f.caption.key.replace("grammar.trees.anim.", ""))).toEqual([
      "start",
      "step",
      "step",
      "step",
      "step",
      "step",
      "done"
    ]);
    expect(frames.map((f) => f.expanded)).toEqual([0, 1, 2, 3, 4, 5, 5]);
    expect(frames[0].caption.params).toEqual({ start: "E" });
    expect(frames[3].caption.params).toEqual({ variable: "E", rule: "E → E*E", before: "a+E", after: "a+E*E" });
    expect(frames[6].caption.params).toEqual({ word: "a+a*a" });
    const eps = treeAnimation(grammar("S", "S", "S -> aSb | ε"), allTrees(grammar("S", "S", "S -> aSb | ε"), "")[0]);
    expect(eps.map((f) => f.caption.params)).toEqual([{ start: "S" }, { variable: "S", rule: "S → ε", before: "S", after: "ε" }, { word: "ε" }]);
  });
});
