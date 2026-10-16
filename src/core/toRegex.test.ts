import { describe, expect, it } from "vitest";
import { EPS } from "./types";
import { acceptsFSM, FSM, makeFSM } from "./fsm/fsm";
import { checkEquivalence, minimize, complete, determinize } from "./fsm/ops";
import { regexToNFA } from "./fsm/regex";
import { fsmToRegex } from "./fsm/toRegex";
import { evaluateCells } from "./workspace";
import { runMachine } from "./machine/machine";
import { allWords, randomNFA, rng } from "./testing";

type T = [string, string, string];
const fsm = (
  states: string[],
  start: string,
  accept: string[],
  transitions: T[],
  alphabet = [...new Set(transitions.map((t) => t[1]).filter((c) => c !== EPS))].sort()
): FSM =>
  makeFSM({
    name: "M",
    alphabet,
    states,
    start,
    accept,
    transitions: transitions.map(([from, symbol, to]) => ({ from, symbol, to }))
  });

const escapeJs = (c: string) => c.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");

/** Our regex syntax → a JavaScript RegExp: a membership oracle sharing no code with the app. */
function jsRegExp(pattern: string): RegExp {
  let out = "";
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];
    if (c === "\\") out += escapeJs(pattern[++i]);
    else if (c === "+" || c === "|") out += "|";
    else if (c === EPS) out += "(?:)";
    else if (c === "∅") out += "(?!)";
    else if (c === "(") out += "(?:";
    else if (c === ")" || c === "*" || c === "?") out += c;
    else out += escapeJs(c);
  }
  return new RegExp(`^(?:${out})$`);
}

/** Up to this length the result is also read back through the app's own regex → ε-NFA path… */
const APP_PATH_LIMIT = 300;
/** …and up to this length also proven equivalent (determinizing a big Thompson ε-NFA is slow). */
const PROOF_LIMIT = 120;
let appPathChecks = 0;
let proofs = 0;

/**
 * toRegex(f) must describe exactly L(f): every word up to maxLength is checked against
 * JavaScript's regex engine, and (for patterns of reasonable size) against the app's
 * Thompson ε-NFA by brute force and by the product-automaton equivalence check.
 */
function expectSameLanguage(f: FSM, maxLength = 7): string {
  const r = fsmToRegex(f);
  expect(r.ok, JSON.stringify(r.diagnostics)).toBe(true);
  const pattern = r.value!.pattern;
  const words = allWords(f.alphabet, maxLength);
  const js = jsRegExp(pattern);
  expect(words.filter((w) => js.test(w) !== acceptsFSM(f, w)), pattern).toEqual([]);
  if (pattern.length <= APP_PATH_LIMIT) {
    appPathChecks++;
    const back = regexToNFA(pattern);
    expect(back.ok, pattern).toBe(true);
    expect(words.filter((w) => acceptsFSM(back.value!, w) !== acceptsFSM(f, w)), pattern).toEqual([]);
    if (pattern.length <= PROOF_LIMIT) {
      proofs++;
      const eq = checkEquivalence(f, back.value!).value!;
      expect(eq.equal, `${pattern}: ${JSON.stringify(eq.counterexample)}`).toBe(true);
    }
  }
  return pattern;
}

/** Shape guarantees of the simplifier: no leftover ∅, no ε outside a union, no starred ε. */
function expectSimplified(pattern: string) {
  if (pattern !== "∅") expect(pattern).not.toContain("∅");
  if (pattern !== EPS) {
    for (let i = 0; i < pattern.length; i++) {
      if (pattern[i] !== EPS) continue;
      expect(pattern[i - 1], `ε outside a union in ${pattern}`).toBe("+");
      expect([undefined, ")", "+"]).toContain(pattern[i + 1]);
    }
  }
  expect(pattern).not.toMatch(/\+ε\)\*/); // (r + ε)* is r*
  expect(pattern).not.toContain("ε*");
  expect(pattern).not.toContain("**");
  expect(pattern).not.toContain("()");
}

const rows = (f: FSM) => fsmToRegex(f).steps.filter((s) => s.table).map((s) => s.table!.rows);

describe("toRegex — the r(p, q, t) method", () => {
  // lecture notes, Exercise 3.23
  const notes323 = fsm(["1", "2"], "1", ["2"], [
    ["1", "a", "1"],
    ["1", "b", "2"],
    ["2", "a", "2"],
    ["2", "b", "2"]
  ]);

  it("reproduces every table of the lecture-note example (3.23)", () => {
    const tables = rows(notes323);
    expect(tables).toEqual([
      [
        ["1", "1"],
        ["2", "2"]
      ],
      [
        ["1", "a+ε", "b"],
        ["2", "∅", "a+b+ε"]
      ],
      [
        ["1", "a*", "a*b"],
        ["2", "∅", "a+b+ε"]
      ],
      [
        ["1", "a*", "a*b(a+b)*"],
        ["2", "∅", "(a+b)*"]
      ]
    ]);
    const r = fsmToRegex(notes323);
    expect(r.value).toEqual({ kind: "regex", name: "M", pattern: "a*b(a+b)*" });
    expect(r.steps.map((s) => s.title.key)).toEqual([
      "ops.toRegex.numbering.title",
      "ops.toRegex.base.title",
      "ops.toRegex.round.title",
      "ops.toRegex.round.title",
      "ops.toRegex.result.title"
    ]);
    const last = r.steps[r.steps.length - 1];
    expect(last.detail).toEqual({
      key: "ops.toRegex.result.detail",
      params: { n: 2, terms: "r(1, 2, 2)", regex: "a*b(a+b)*" }
    });
  });

  it("numbers the start state 1 and labels named states with their number", () => {
    const f = fsm(["X", "S"], "S", ["X"], [["S", "a", "X"]]);
    const r = fsmToRegex(f);
    expect(r.steps[0].table!.rows).toEqual([
      ["1", "S"],
      ["2", "X"]
    ]);
    expect(r.steps[1].table!.headers).toEqual(["p \\ q", "1 (S)", "2 (X)"]);
    expect(r.steps[1].table!.rows).toEqual([
      ["1 (S)", "ε", "a"],
      ["2 (X)", "∅", "ε"]
    ]);
    expect(r.value!.pattern).toBe("a");
  });

  describe("exact results for small automata", () => {
    const cases: [string, FSM, string][] = [
      ["no accepting state", fsm(["1", "2"], "1", [], [["1", "a", "2"]]), "∅"],
      ["only the unreachable state accepts", fsm(["1", "2"], "1", ["2"], [["2", "a", "1"]], ["a"]), "∅"],
      ["only ε", fsm(["1"], "1", ["1"], [], ["a"]), EPS],
      ["a single letter", fsm(["1", "2"], "1", ["2"], [["1", "a", "2"]]), "a"],
      ["a*", fsm(["1"], "1", ["1"], [["1", "a", "1"]]), "a*"],
      ["(a+b)*", fsm(["1"], "1", ["1"], [["1", "a", "1"], ["1", "b", "1"]]), "(a+b)*"],
      ["a*b", fsm(["1", "2"], "1", ["2"], [["1", "a", "1"], ["1", "b", "2"]]), "a*b"],
      ["ε-edge then a loop", fsm(["1", "2"], "1", ["2"], [["1", EPS, "2"], ["2", "a", "2"]]), "a*"],
      ["two accepting states", fsm(["1", "2", "3"], "1", ["2", "3"], [["1", "a", "2"], ["1", "b", "3"]]), "a+b"],
      ["accepting start and a letter", fsm(["1", "2"], "1", ["1", "2"], [["1", "a", "2"]]), "a+ε"],
      ["parallel edges and an ε-edge", fsm(["1", "2"], "1", ["2"], [["1", "b", "2"], ["1", "a", "2"], ["1", EPS, "2"]]), "a+b+ε"],
      // what the method gives by hand too: r(1,1,2) = ε + a(ba + ε)*b
      ["(ab)*", fsm(["1", "2"], "1", ["1"], [["1", "a", "2"], ["2", "b", "1"]]), "a(ba)*b+ε"]
    ];
    for (const [name, f, expected] of cases) {
      it(name, () => {
        expect(fsmToRegex(f).value!.pattern).toBe(expected);
        expectSameLanguage(f);
      });
    }
  });

  describe("lecture-note automata keep their language", () => {
    const lastTwo = (() => {
      const states = ["S", "0", "1", "00", "01", "10", "11"];
      const t: T[] = [];
      for (const s of states)
        for (const c of ["0", "1"]) t.push([s, c, (s === "S" ? c : s + c).slice(-2)]);
      return fsm(states, "S", ["01"], t);
    })();
    const cases: [string, FSM][] = [
      ["2.5 ends in 0", fsm(["A", "B"], "A", ["B"], [["A", "0", "B"], ["A", "1", "A"], ["B", "0", "B"], ["B", "1", "A"]])],
      [
        "2.6 even 0s, odd 1s",
        fsm(["00", "01", "10", "11"], "00", ["01"], [
          ["00", "1", "01"], ["01", "1", "00"], ["10", "1", "11"], ["11", "1", "10"],
          ["00", "0", "10"], ["10", "0", "00"], ["01", "0", "11"], ["11", "0", "01"]
        ])
      ],
      ["2.7", fsm(["A", "B", "C"], "A", ["B"], [["A", "0", "A"], ["A", "1", "B"], ["B", "1", "B"], ["B", "0", "C"], ["C", "0", "B"], ["C", "1", "B"]])],
      ["2.9 partial, starts with 01", fsm(["A", "B", "C"], "A", ["C"], [["A", "0", "B"], ["B", "1", "C"], ["C", "0", "C"], ["C", "1", "C"]])],
      ["2.15 NFA, ends in 01", fsm(["A", "B", "C"], "A", ["C"], [["A", "0", "A"], ["A", "1", "A"], ["A", "0", "B"], ["B", "1", "C"]])],
      [
        "2.18 ε-NFA, contains 101 or 11",
        fsm(["A", "B", "C", "D"], "A", ["D"], [
          ["A", "0", "A"], ["A", "1", "A"], ["A", "1", "B"], ["B", "0", "C"], ["B", EPS, "C"],
          ["C", "1", "D"], ["D", "0", "D"], ["D", "1", "D"]
        ])
      ],
      ["2.22 last two characters, 7 states", lastTwo],
      [
        "3.8 union with ε-moves",
        fsm(["X", "A", "B", "C", "D", "E"], "X", ["A", "C"], [
          ["X", EPS, "A"], ["X", EPS, "C"], ["A", "a", "B"], ["B", "a", "A"],
          ["C", "a", "D"], ["D", "a", "E"], ["E", "a", "C"]
        ])
      ]
    ];
    for (const [name, f] of cases) {
      it(name, () => {
        expectSimplified(expectSameLanguage(f, 8));
      });
    }

    it("2.15 minimized gives a short expression", () => {
      const nfa = cases[4][1];
      const min = minimize(complete(determinize(nfa).value!).value!).value!;
      const pattern = expectSameLanguage(min);
      expect(pattern.length).toBeLessThanOrEqual(30);
    });
  });

  it("keeps the language of 500 random ε-NFAs", () => {
    const random = rng(20261015);
    const [before, proofsBefore] = [appPathChecks, proofs];
    for (let i = 0; i < 500; i++) {
      const f = randomNFA(random, {
        states: 1 + Math.floor(random() * 5),
        alphabet: i % 4 === 0 ? ["a", "b", "c"] : ["a", "b"]
      });
      expectSimplified(expectSameLanguage(f, i % 4 === 0 ? 5 : 7));
    }
    // most cases must also have gone through the app's own regex parser
    expect(appPathChecks - before).toBeGreaterThan(400);
    expect(proofs - proofsBefore).toBeGreaterThan(350);
  });

  it("keeps the language of 200 random complete DFAs", () => {
    const random = rng(7);
    for (let i = 0; i < 200; i++) {
      const f = randomNFA(random, { states: 1 + Math.floor(random() * 3), alphabet: ["a", "b"], epsDensity: 0 });
      const dfa = complete(determinize(f).value!).value!;
      expectSimplified(expectSameLanguage(dfa));
    }
  });

  it("the JavaScript oracle itself reads the syntax right", () => {
    expect(jsRegExp("a*b(a+b)*").test("aab")).toBe(true);
    expect(jsRegExp("a*b(a+b)*").test("aa")).toBe(false);
    expect(jsRegExp("a+ε").test("")).toBe(true);
    expect(jsRegExp("∅").test("")).toBe(false);
    expect(jsRegExp("\\eps").test("eps")).toBe(true);
    expect(jsRegExp("\\+\\*").test("+*")).toBe(true);
  });

  describe("symbols the regex syntax would misread", () => {
    it("the letters e, p, s in a row do not turn into ε", () => {
      const f = fsm(["1", "2", "3", "4"], "1", ["4"], [["1", "e", "2"], ["2", "p", "3"], ["3", "s", "4"]]);
      const pattern = expectSameLanguage(f, 4);
      expect(pattern).toBe("\\eps");
      expect(acceptsFSM(regexToNFA(pattern).value!, "eps")).toBe(true);
      expect(acceptsFSM(regexToNFA(pattern).value!, "")).toBe(false);
    });

    it("operator characters as letters are escaped", () => {
      const f = fsm(["1", "2", "3"], "1", ["3"], [
        ["1", "+", "2"], ["2", "*", "3"], ["1", "(", "3"], ["3", ")", "3"], ["2", "|", "2"], ["1", "?", "1"]
      ]);
      expectSameLanguage(f, 5);
    });
  });

  describe("failures", () => {
    it("a symbol longer than one character", () => {
      const f = fsm(["1", "2"], "1", ["2"], [["1", "ab", "2"]]);
      const r = fsmToRegex(f);
      expect(r.ok).toBe(false);
      expect(r.diagnostics[0].title).toEqual({ key: "ops.toRegex.multiCharSymbol.title", params: { symbol: "ab" } });
    });

    it("stops with an explanation when the expression explodes", () => {
      // 9 states, every pair joined by its own letter: no simplification can help
      const n = 9;
      const states = Array.from({ length: n }, (_, i) => String(i + 1));
      const t: T[] = [];
      let code = 0x100;
      for (const p of states) for (const q of states) t.push([p, String.fromCharCode(code++), q]);
      const r = fsmToRegex(fsm(states, "1", ["2"], t));
      expect(r.ok).toBe(false);
      expect(r.diagnostics[0].title.key).toBe("ops.toRegex.tooLarge.title");
      expect(r.steps[0].title.key).toBe("ops.toRegex.numbering.title");
    });
  });
});

describe("toRegex in a worksheet", () => {
  const machine = `Machine:
  name: M
  charset: a, b
  states: 1, 2
  init: "1"
  accept: "2"
  transitions:
    - 1 a 1
    - 1 b 2
    - 2 . 2`;

  it("returns a regex value that is equivalent to the automaton", () => {
    const rs = evaluateCells([machine, "R = toRegex(M)", "V = equal(M, R)", "A = toFsm(R)"]);
    expect(rs[1].value).toEqual({ kind: "regex", name: "R", pattern: "a*b(a+b)*" });
    expect((rs[2].value as { equal: boolean }).equal).toBe(true);
    expect(runMachine(rs[3].value as never, "aab").verdict).toBe("accepted");
    expect(runMachine(rs[3].value as never, "aa").verdict).toBe("rejected");
    expect(rs[1].stepGroups.map((g) => g.operation)).toEqual(["toRegex(M)"]);
  });

  it("works on a right-linear grammar through its automaton", () => {
    const rs = evaluateCells([
      `Grammar:
  name: G
  charset: a, b
  variables: S
  init: S
  rules:
    - S -> aS | b`,
      "R = toRegex(G)"
    ]);
    const back = regexToNFA((rs[1].value as { pattern: string }).pattern).value!;
    for (const w of allWords(["a", "b"], 6)) expect(acceptsFSM(back, w)).toBe(/^a*b$/.test(w));
  });

  it("refuses a pushdown automaton", () => {
    // a stack makes the language possibly non-regular — toRegex needs a finite automaton
    const rs = evaluateCells([
      `Machine:
  name: P
  charset: a, b
  states: q
  init: q
  storages:
    stack: stack
  transitions:
    - q a Z/AZ q`,
      "R = toRegex(P)"
    ]);
    expect(rs[1].value).toBeNull();
    expect(rs[1].diagnostics.some((d) => d.level === "error")).toBe(true);
  });
});
