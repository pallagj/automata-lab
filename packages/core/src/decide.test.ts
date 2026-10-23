import { describe, expect, it } from "vitest";
import { acceptsFSM, FSM, makeFSM } from "./fsm/fsm";
import { decideDisjointFSM, decideEmptyFSM, decideFiniteFSM, languageFacts, shortlexWords } from "./fsm/decide";
import { regexToNFA } from "./fsm/regex";
import { decideEmptyGrammar, decideFiniteGrammar } from "./grammar/decide";
import { cykMembership } from "./grammar/cyk";
import { Grammar, grammarToFSM } from "./grammar/grammar";
import { removeUselessSymbols } from "./grammar/normalForm";
import { parseGrammar, parseMachine } from "./parse/definitionParser";
import { evaluateExpression, ExprValue } from "./expr/expression";
import { allWords, cfgWordsUpTo, randomCFG, randomNFA, rng, sorted } from "./testing";
import { EPS } from "./types";
import { pumpedWords, Verdict } from "./verdict";

const fsm = (f: Omit<FSM, "kind" | "name"> & { name?: string }) => makeFSM({ name: "M", ...f });
const t = (from: string, symbol: string, to: string) => ({ from, symbol, to });
/** A grammar over {a, b} from its rules; the variables are the capital letters, S first. */
const grammar = (rules: string) => {
  const variables = [...new Set(["S", ...(rules.match(/[A-Z]/g) ?? [])])];
  const lines = rules.split("\n").map((r) => `    - ${r}`);
  const r = parseGrammar(`Grammar:\n  name: G\n  charset: a, b\n  variables: ${variables.join(", ")}\n  init: S\n  rules:\n${lines.join("\n")}`);
  if (!r.ok) throw new Error(JSON.stringify(r.diagnostics));
  return r.value!;
};
const shortlexSort = (ws: Iterable<string>) => sorted(ws);
const inCF = (g: Grammar, w: string) => cykMembership(g, w).value!.accepted;

/** a*b over {a, b} as a complete DFA: s —b→ f, everything else into the trap. */
const STAR_A_B = fsm({
  alphabet: ["a", "b"],
  states: ["s", "f", "t"],
  start: "s",
  accept: ["f"],
  transitions: [t("s", "a", "s"), t("s", "b", "f"), t("f", "a", "t"), t("f", "b", "t"), t("t", "a", "t"), t("t", "b", "t")]
});

/* ------------------------------------------------------------------ */

describe("emptiness of an automaton (lecture notes 5.2)", () => {
  it("a reachable accepting state: the search stops there, with a shortest word", () => {
    const r = decideEmptyFSM(STAR_A_B);
    expect(r.value).toMatchObject({ question: "empty", empty: false, word: "b", subject: "M" });
    expect(r.steps.map((s) => s.title.key)).toEqual(["decide.empty.search.title"]);
    expect(r.steps[0].detail!.key).toBe("decide.empty.search.detailFound");
    expect(r.steps[0].table!.rows).toEqual([
      ["s", EPS, "✗"],
      ["f", "b", "✓"]
    ]);
  });

  it("ε-transitions read no letter: the word is the shortest, not the path with fewest edges", () => {
    const m = fsm({
      alphabet: ["a", "b"],
      states: ["s", "p", "e1", "e2", "e3", "f"],
      start: "s",
      accept: ["f"],
      transitions: [t("s", "a", "p"), t("p", "a", "f"), t("s", EPS, "e1"), t("e1", EPS, "e2"), t("e2", EPS, "e3"), t("e3", "b", "f")]
    });
    expect(decideEmptyFSM(m).value!.word).toBe("b");
  });

  it("ε in the language: the start state's closure accepts, the word is ε", () => {
    const m = fsm({ alphabet: ["a"], states: ["s", "f"], start: "s", accept: ["f"], transitions: [t("s", EPS, "f"), t("f", "a", "f")] });
    const r = decideEmptyFSM(m).value!;
    expect(r.empty).toBe(false);
    expect(r.word).toBe("");
  });

  it("no accepting state, and an accepting state that cannot be reached: L = ∅", () => {
    const none = fsm({ alphabet: ["a"], states: ["s"], start: "s", accept: [], transitions: [t("s", "a", "s")] });
    expect(decideEmptyFSM(none).value).toMatchObject({ empty: true, word: undefined });
    const cut = fsm({
      alphabet: ["a", "b"],
      states: ["s", "p", "f"],
      start: "s",
      accept: ["f"],
      transitions: [t("s", "a", "p"), t("p", "b", "s"), t("f", "a", "s")]
    });
    const r = decideEmptyFSM(cut);
    expect(r.value!.empty).toBe(true);
    expect(r.steps[0].detail).toEqual({ key: "decide.empty.search.detailNone", params: { count: 2 } });
    expect(r.steps[0].table!.rows.map((row) => row[0])).toEqual(["s", "p"]);
  });

  it("agrees with brute force on 500 random ε-NFAs, and the word is a shortest one", () => {
    const next = rng(71);
    for (let k = 0; k < 500; k++) {
      const m = randomNFA(next, { states: 1 + Math.floor(next() * 5), alphabet: ["a", "b"], acceptRate: 0.2 });
      // a shortest accepted word reads fewer letters than there are states
      const accepted = allWords(["a", "b"], m.states.length).filter((w) => acceptsFSM(m, w));
      const v = decideEmptyFSM(m).value!;
      expect(v.empty, String(k)).toBe(accepted.length === 0);
      expect(languageFacts(m).empty, String(k)).toBe(v.empty);
      if (!v.empty) {
        expect(acceptsFSM(m, v.word!)).toBe(true);
        expect(v.word!.length).toBe(accepted[0].length);
      }
    }
  });
});

/* ------------------------------------------------------------------ */

describe("finiteness of an automaton (lecture notes 5.5, Theorem 5.3)", () => {
  it("a*b: the minimal automaton has n = 3 states, R₃ meets F, and aab = uvw with v = a", () => {
    const r = decideFiniteFSM(STAR_A_B);
    const v = r.value!;
    expect(v.finite).toBe(false);
    expect(v.pumping).toEqual({ kind: "regular", u: "", v: "a", w: "ab", state: "s" });
    expect(pumpedWords(v.pumping!)).toEqual(["ab", "aab", "aaab", "aaaab"]);
    expect(r.steps.map((s) => s.title.key)).toEqual(["decide.finite.min.title", "decide.finite.lengths.title", "decide.finite.pump.title"]);
    expect(r.steps[0].detail).toEqual({ key: "decide.finite.min.min", params: { n: 3 } });
    expect(r.steps[1].detail).toEqual({ key: "decide.finite.lengths.detailFound", params: { n: 3, twoN: 6, k: 3, word: "aab" } });
    expect(r.steps[1].table!.rows).toEqual([
      ["0", "{s}", "∅"],
      ["1", "{s, f}", "{f}"],
      ["2", "{s, f, t}", "{f}"],
      ["3", "{s, f, t}", "{f}"]
    ]);
  });

  it("an NFA is determinized and minimized first", () => {
    const m = fsm({
      alphabet: ["a", "b"],
      states: ["p", "q"],
      start: "p",
      accept: ["q"],
      transitions: [t("p", "a", "p"), t("p", "a", "q"), t("q", "b", "q")]
    });
    const r = decideFiniteFSM(m);
    expect(r.steps[0].detail!.key).toBe("decide.finite.min.detMin");
    expect(r.value!.finite).toBe(false);
    for (const w of pumpedWords(r.value!.pumping!, 6)) expect(acceptsFSM(m, w)).toBe(true);
  });

  it("all words of length at most 2: finite, every word listed in shortlex order", () => {
    const m = fsm({
      alphabet: ["a", "b"],
      states: ["0", "1", "2"],
      start: "0",
      accept: ["0", "1", "2"],
      transitions: [t("0", "a", "1"), t("0", "b", "1"), t("1", "a", "2"), t("1", "b", "2")]
    });
    const r = decideFiniteFSM(m);
    const v = r.value!;
    expect(r.steps[0].detail).toEqual({ key: "decide.finite.min.completeMin", params: { n: 4 } });
    expect(v).toMatchObject({ finite: true, count: "7", countExact: true });
    expect(v.words).toEqual(["", "a", "b", "aa", "ab", "ba", "bb"]);
    expect(r.steps[1].detail).toEqual({ key: "decide.finite.lengths.detailNone", params: { n: 4, twoN: 8 } });
    expect(r.steps[1].table!.rows).toHaveLength(9);
    expect(r.steps[2].detail).toEqual({ key: "decide.finite.words.detail", params: { n: 4, count: "7" } });
  });

  it("the empty language is finite, with no words", () => {
    const none = fsm({ alphabet: ["a"], states: ["s"], start: "s", accept: [], transitions: [t("s", "a", "s")] });
    const r = decideFiniteFSM(none);
    expect(r.value).toMatchObject({ finite: true, count: "0", words: [] });
    expect(r.steps[2].detail!.key).toBe("decide.finite.words.detailEmpty");
  });

  it("a finite language too large to list: the count is exact, the list stops", () => {
    // every word of length 10 over {a, b}: 1024 words
    const states = Array.from({ length: 11 }, (_, i) => String(i));
    const m = fsm({
      alphabet: ["a", "b"],
      states,
      start: "0",
      accept: ["10"],
      transitions: states.slice(0, 10).flatMap((q, i) => [t(q, "a", String(i + 1)), t(q, "b", String(i + 1))])
    });
    const v = decideFiniteFSM(m).value!;
    expect(v).toMatchObject({ finite: true, count: "1024", countExact: true });
    expect(v.words).toHaveLength(200);
    expect(v.words![0]).toBe("aaaaaaaaaa");
    expect(v.words![1]).toBe("aaaaaaaaab");
  });

  it("agrees with brute force (a word of length N…2N, N the number of states) on 400 random ε-NFAs", () => {
    const next = rng(97);
    for (let k = 0; k < 400; k++) {
      const m = randomNFA(next, { states: 1 + Math.floor(next() * 4), alphabet: ["a", "b"], density: 0.25 });
      const N = m.states.length;
      const words = allWords(["a", "b"], 2 * N).filter((w) => acceptsFSM(m, w));
      const infinite = words.some((w) => w.length >= N);
      const r = decideFiniteFSM(m);
      const v = r.value!;
      expect(v.finite, String(k)).toBe(!infinite);
      expect(languageFacts(m).finite, String(k)).toBe(!infinite);
      if (v.finite) {
        expect(v.words, String(k)).toEqual(shortlexSort(words));
        expect(v.count).toBe(String(words.length));
      } else {
        const p = v.pumping!;
        if (p.kind !== "regular") throw new Error("regular pumping expected");
        const n = Number((r.steps[0].detail!.params as { n: number }).n);
        const x = p.u + p.v + p.w;
        expect(p.v.length).toBeGreaterThan(0);
        expect((p.u + p.v).length).toBeLessThanOrEqual(n);
        expect(x.length).toBeGreaterThanOrEqual(n);
        expect(x.length).toBeLessThanOrEqual(2 * n);
        for (const w of pumpedWords(p, 5)) expect(acceptsFSM(m, w), `${k}: ${w}`).toBe(true);
      }
    }
  });
});

/* ------------------------------------------------------------------ */

describe("the words of an automaton in shortlex order", () => {
  it("agrees with brute force on 300 random ε-NFAs", () => {
    const next = rng(5);
    for (let k = 0; k < 300; k++) {
      const m = randomNFA(next, { states: 1 + Math.floor(next() * 4), alphabet: ["a", "b"] });
      const expected = shortlexSort(allWords(["a", "b"], 6).filter((w) => acceptsFSM(m, w))).slice(0, 15);
      expect(shortlexWords(m, 15, 6), String(k)).toEqual(expected);
    }
  });

  it("long words cost no search over the words that lead nowhere", () => {
    // the only word is a⁴⁰: a breadth-first enumeration would follow 2⁴⁰ prefixes
    const states = Array.from({ length: 41 }, (_, i) => String(i));
    const m = fsm({
      alphabet: ["b", "a"],
      states,
      start: "0",
      accept: ["40"],
      transitions: states.slice(0, 40).map((q, i) => t(q, "a", String(i + 1)))
    });
    expect(shortlexWords(m, 5, 64)).toEqual(["a".repeat(40)]);
  });

  it("the alphabet's order decides between words of the same length", () => {
    const m = fsm({ alphabet: ["b", "a"], states: ["s", "f"], start: "s", accept: ["f"], transitions: [t("s", "a", "f"), t("s", "b", "f")] });
    expect(shortlexWords(m, 5, 3)).toEqual(["b", "a"]);
  });
});

/* ------------------------------------------------------------------ */

describe("disjointness of two automata (lecture notes 5.4)", () => {
  const plus = (c: string) =>
    fsm({ name: c.toUpperCase(), alphabet: ["a", "b"], states: ["s", "f"], start: "s", accept: ["f"], transitions: [t("s", c, "f"), t("f", c, "f")] });

  it("a⁺ and b⁺ are disjoint: no reachable pair accepts in both", () => {
    const r = decideDisjointFSM(plus("a"), plus("b"));
    expect(r.value).toMatchObject({ question: "disjoint", disjoint: true, common: undefined, machineA: "A", machineB: "B" });
    expect(r.steps[0].detail).toEqual({ key: "decide.disjoint.search.detailNone", params: { count: 1 } });
    expect(r.steps[0].table!.headers.slice(2)).toEqual(["p ∈ F(A)", "q ∈ F(B)"]);
  });

  it("a⁺ and a*b*: they meet, in a shortest common word", () => {
    const ab = fsm({
      name: "C",
      alphabet: ["a", "b"],
      states: ["x", "y"],
      start: "x",
      accept: ["x", "y"],
      transitions: [t("x", "a", "x"), t("x", "b", "y"), t("y", "b", "y")]
    });
    const r = decideDisjointFSM(plus("a"), ab);
    expect(r.value).toMatchObject({ disjoint: false, common: "a" });
    expect(r.steps[0].table!.rows.at(-1)).toEqual(["(f, x)", "a", "✓", "✓"]);
  });

  it("different alphabets: only the common letters move the pair", () => {
    const onlyC = fsm({ alphabet: ["c"], states: ["s"], start: "s", accept: ["s"], transitions: [t("s", "c", "s")] });
    expect(decideDisjointFSM(plus("a"), onlyC).value!.disjoint).toBe(true);
    const withEps = { ...plus("a"), accept: ["s", "f"] };
    expect(decideDisjointFSM(withEps, onlyC).value).toMatchObject({ disjoint: false, common: "" });
  });

  it("agrees with brute force on 400 random pairs of ε-NFAs, and the common word is a shortest one", () => {
    const next = rng(13);
    for (let k = 0; k < 400; k++) {
      const a = randomNFA(next, { states: 1 + Math.floor(next() * 3), alphabet: ["a", "b"] });
      const b = randomNFA(next, { states: 1 + Math.floor(next() * 3), alphabet: ["a", "b"] });
      // a shortest common word visits each pair of states at most once
      const common = allWords(["a", "b"], a.states.length * b.states.length).filter((w) => acceptsFSM(a, w) && acceptsFSM(b, w));
      const v = decideDisjointFSM(a, b).value!;
      expect(v.disjoint, String(k)).toBe(common.length === 0);
      if (!v.disjoint) {
        expect(acceptsFSM(a, v.common!) && acceptsFSM(b, v.common!)).toBe(true);
        expect(v.common!.length).toBe(common[0].length);
      }
    }
  });
});

/* ------------------------------------------------------------------ */

describe("emptiness of a context-free grammar (lecture notes 8.2)", () => {
  it("the start variable derives a terminal word: the round it enters, and a shortest word", () => {
    const g = grammar("S -> AB | aSb\nA -> aA | a\nB -> b | bB");
    const r = decideEmptyGrammar(g);
    expect(r.value).toMatchObject({ question: "empty", empty: false, word: "ab" });
    expect(r.steps[0].table!.rows).toEqual([
      ["0", "{a, b}"],
      ["1", "{A, B, a, b}"],
      ["2", "{S, A, B, a, b}"],
      ["3", "{S, A, B, a, b}"]
    ]);
    expect(r.steps[0].detail).toEqual({ key: "decide.emptyGrammar.detailFound", params: { start: "S", round: 2, word: "ab" } });
  });

  it("the start variable is useless: L = ∅", () => {
    const r = decideEmptyGrammar(grammar("S -> aS | AB\nA -> a\nB -> bB"));
    expect(r.value).toMatchObject({ empty: true, word: undefined });
    expect(r.steps[0].detail).toEqual({ key: "decide.emptyGrammar.detailNone", params: { start: "S" } });
  });

  it("S → ε: the word is ε", () => {
    expect(decideEmptyGrammar(grammar("S -> aSb | ε")).value).toMatchObject({ empty: false, word: "" });
  });

  it("only for context-free grammars", () => {
    const g = grammar("S -> aSb | ab\naS -> b");
    expect(decideEmptyGrammar(g).ok).toBe(false);
    expect(decideFiniteGrammar(g).ok).toBe(false);
  });

  it("agrees with the useless symbols and with CYK on 400 random grammars; the word is a shortest one", () => {
    const next = rng(29);
    for (let k = 0; k < 400; k++) {
      const g = randomCFG(next);
      const v = decideEmptyGrammar(g).value!;
      const trimmedEmpty = removeUselessSymbols(g).diagnostics.some((d) => d.title.key === "grammar.trim.emptyLanguage.title");
      expect(v.empty, String(k)).toBe(trimmedEmpty);
      if (v.empty) expect(cfgWordsUpTo(g, 8).size).toBe(0);
      else {
        expect(inCF(g, v.word!), `${k}: ${v.word}`).toBe(true);
        if (v.word!.length <= 8) expect(shortlexSort(cfgWordsUpTo(g, 8))[0].length).toBe(v.word!.length);
      }
    }
  });
});

/* ------------------------------------------------------------------ */

describe("finiteness of a context-free grammar (lecture notes 8.3)", () => {
  it("S → aSb | ε: S repeats, S′ ⇒ aSb and S ⇒ aSb pump a·aᵏ·ab·bᵏ·b", () => {
    const r = decideFiniteGrammar(grammar("S -> aSb | ε"));
    const v = r.value!;
    expect(v.finite).toBe(false);
    expect(v.pumping).toEqual({ kind: "contextFree", u: "a", v: "a", w: "ab", x: "b", y: "b", variable: "S" });
    expect(pumpedWords(v.pumping!)).toEqual(["aabb", "aaabbb", "aaaabbbb", "aaaaabbbbb"]);
    expect(r.steps.map((s) => s.title.key)).toEqual([
      "decide.finiteGrammar.prepare.title",
      "decide.finiteGrammar.repeat.title",
      "decide.finiteGrammar.pump.title"
    ]);
    expect(r.steps[0].table!.rows).toEqual([
      ["S′", "ε | aSb | ab"],
      ["S", "aSb | ab"]
    ]);
    expect(r.steps[1].table!.rows).toEqual([
      ["S′", "S", "{S}"],
      ["S", "S", "{S}"]
    ]);
    expect(r.steps[2].detail!.params).toMatchObject({ start: "S′", outer: "aSb", inner: "aSb", variable: "S" });
  });

  it("a repetition through another variable: S → aA, A → bS | b", () => {
    const g = grammar("S -> aA\nA -> bS | b");
    const v = decideFiniteGrammar(g).value!;
    expect(v.finite).toBe(false);
    const p = v.pumping!;
    if (p.kind !== "contextFree") throw new Error("context-free pumping expected");
    expect(p.variable).toBe("S");
    expect(p.v + p.x).toBe("ab");
    for (const w of pumpedWords(p, 5)) expect(inCF(g, w), w).toBe(true);
  });

  it("no variable repeats: every word, in shortlex order", () => {
    const r = decideFiniteGrammar(grammar("S -> AB\nA -> a | aa\nB -> b | ε"));
    expect(r.value).toMatchObject({ finite: true, words: ["a", "aa", "ab", "aab"], count: "4", countExact: true });
    expect(r.steps[1].detail).toEqual({ key: "decide.finiteGrammar.repeat.detailNone", params: { m: 3 } });
    expect(r.steps[2].detail).toEqual({ key: "decide.finiteGrammar.words.detail", params: { count: 4 } });
  });

  it("a cycle only among useless symbols does not count: S → a | B, B → bB", () => {
    expect(decideFiniteGrammar(grammar("S -> a | B\nB -> bB")).value).toMatchObject({ finite: true, words: ["a"] });
  });

  it("a unit-rule cycle pumps nothing: S → A | a, A → S | b", () => {
    expect(decideFiniteGrammar(grammar("S -> A | a\nA -> S | b")).value).toMatchObject({ finite: true, words: ["a", "b"] });
  });

  it("an ε-rule cycle pumps nothing: S → SA | a, A → ε", () => {
    expect(decideFiniteGrammar(grammar("S -> SA | a\nA -> ε")).value).toMatchObject({ finite: true, words: ["a"] });
  });

  it("the empty language is finite", () => {
    const r = decideFiniteGrammar(grammar("S -> aS"));
    expect(r.value).toMatchObject({ finite: true, words: [], count: "0" });
    expect(r.steps.map((s) => s.detail!.key)).toEqual(["decide.finiteGrammar.prepare.detailEmpty"]);
  });

  it("agrees with the words up to a bound and pumps by CYK on 400 random grammars", () => {
    const next = rng(41);
    for (let k = 0; k < 400; k++) {
      const g = randomCFG(next);
      const v = decideFiniteGrammar(g).value!;
      if (v.finite) {
        const longest = Math.max(0, ...v.words!.map((w) => w.length));
        // the useful variables of a finite language are finite too, so this stays small
        const words = cfgWordsUpTo(removeUselessSymbols(g).value!, 2 * longest + 6);
        expect(v.words, String(k)).toEqual(shortlexSort(words));
        expect(v.count).toBe(String(words.size));
      } else {
        const p = v.pumping!;
        if (p.kind !== "contextFree") throw new Error("context-free pumping expected");
        expect((p.v + p.x).length, String(k)).toBeGreaterThan(0);
        for (const w of pumpedWords(p, 3)) expect(inCF(g, w), `${k}: ${w}`).toBe(true);
      }
    }
  });

  it("a right-linear grammar: the grammar method and the automaton method agree (300 random grammars)", () => {
    const next = rng(3);
    const vars = ["S", "A", "B"];
    for (let k = 0; k < 300; k++) {
      const lines = vars.map((A) => {
        const alts: string[] = [];
        for (let i = 0; i < 1 + Math.floor(next() * 3); i++) {
          const x = next();
          const c = next() < 0.5 ? "a" : "b";
          alts.push(x < 0.15 ? "ε" : x < 0.4 ? c : `${c}${vars[Math.floor(next() * vars.length)]}`);
        }
        return `${A} -> ${[...new Set(alts)].join(" | ")}`;
      });
      const g = grammar(lines.join("\n"));
      const byGrammar = decideFiniteGrammar(g).value!;
      const byAutomaton = decideFiniteFSM(grammarToFSM(g).value!).value!;
      expect(byGrammar.finite, `${k}: ${lines.join("; ")}`).toBe(byAutomaton.finite);
      if (byGrammar.finite) expect(byGrammar.words).toEqual(byAutomaton.words);
      expect(decideEmptyGrammar(g).value!.empty).toBe(decideEmptyFSM(grammarToFSM(g).value!).value!.empty);
    }
  });
});

/* ------------------------------------------------------------------ */

describe("empty, finite and disjoint in expressions", () => {
  const run = (src: string, env: [string, ExprValue][]) => evaluateExpression(src, new Map(env));
  const verdict = (src: string, env: [string, ExprValue][]) => {
    const r = run(src, env);
    expect(r.ok, JSON.stringify(r.diagnostics)).toBe(true);
    return r.value!.value as Verdict;
  };
  const anbn = parseMachine(`Machine:
  name: P
  charset: a, b
  states: q_0, q_1, q_2
  init: q_0
  accept: q_2
  storages:
    stack: stack
  transitions:
    - (q_0, a, Z) -> (q_0, AZ)
    - (q_0, a, A) -> (q_0, AA)
    - (q_0, b, A) -> (q_1, ε)
    - (q_1, b, A) -> (q_1, ε)
    - (q_1, ε, Z) -> (q_2, Z)`).value!;

  it("an automaton, a regular expression and a regular grammar go by chapter 5", () => {
    expect(verdict("finite(M)", [["M", STAR_A_B]])).toMatchObject({ question: "finite", subject: "M", finite: false });
    const r = run("empty(R)", [["R", { kind: "regex", name: "R", pattern: "a∅" }]]);
    expect((r.value!.value as Verdict & { empty: boolean }).empty).toBe(true);
    expect(r.value!.stepGroups.map((s) => s.operation)).toEqual(["toFsm(R)", "empty(R)"]);
    const g = grammar("S -> aS | b");
    const f = run("finite(G)", [["G", g]]);
    expect(f.value!.stepGroups.map((s) => s.operation)).toEqual(["toFsm(G)", "finite(G)"]);
    expect(f.value!.stepGroups[1].steps[0].title.key).toBe("decide.finite.min.title");
  });

  it("a context-free grammar goes by chapter 8, a pushdown automaton by its grammar", () => {
    const g = grammar("S -> aSb | ab");
    const f = run("finite(G)", [["G", g]]);
    expect(f.value!.stepGroups[0].steps[0].title.key).toBe("decide.finiteGrammar.prepare.title");
    expect(verdict("empty(P)", [["P", anbn]])).toMatchObject({ question: "empty", subject: "P", empty: false, word: "ab" });
    const p = run("finite(P)", [["P", anbn]]);
    expect(p.value!.stepGroups.map((s) => s.operation)).toEqual(["toGrammar(P)", "finite(P)"]);
    const v = p.value!.value as Verdict & { finite: boolean; pumping: Parameters<typeof pumpedWords>[0] };
    expect(v.finite).toBe(false);
    for (const w of pumpedWords(v.pumping)) expect(w).toMatch(/^(a+)(b+)$/);
    for (const w of pumpedWords(v.pumping)) expect(w.indexOf("b") * 2).toBe(w.length);
  });

  it("beyond the context-free languages: no decision, and the reason", () => {
    const tm = parseMachine(`Machine:
  name: T
  charset: a
  states: s
  init: s
  accept: s
  input: tape
  storages:
    tape: tape
  transitions:
    - (s, a) -> (s, a, R)`).value!;
    const r = run("empty(T)", [["T", tm]]);
    expect(r.ok).toBe(false);
    expect(r.diagnostics[0].detail).toEqual({
      key: "expression.error.undecidableMachine",
      params: { opKey: "opNames.empty", name: "T", machineKindKey: "machineKind.tm" }
    });
    const g1 = grammar("S -> aSb | ab\naS -> b");
    expect(run("finite(G)", [["G", g1]]).diagnostics[0].detail!.key).toBe("expression.error.undecidableGrammar");
  });

  it("disjoint takes two regular languages and names them as written", () => {
    const a = regexToNFA("a*", "A").value!;
    const b = regexToNFA("b*", "B").value!;
    expect(verdict("disjoint(A, B)", [["A", a], ["B", b]])).toMatchObject({ machineA: "A", machineB: "B", disjoint: false, common: "" });
    expect(verdict("disjoint(A, regex(bb*))", [["A", a]])).toMatchObject({ machineB: "regex(bb*)", disjoint: true });
    expect(run("disjoint(P, A)", [["P", anbn], ["A", a]]).ok).toBe(false);
  });

  it("the argument as written names an unnamed language", () => {
    expect(verdict("empty(intersect(M, M))", [["M", STAR_A_B]])).toMatchObject({ subject: "intersect(M, M)", empty: false });
  });
});
