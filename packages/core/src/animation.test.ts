import { describe, expect, it } from "vitest";
import { ANIMATION_STATE_LIMIT, AnimFrame, transKey } from "./fsm/animation";
import { acceptsFSM, FSM, makeFSM } from "./fsm/fsm";
import { complete, determinize, minimize, product, ProductMode, removeEpsilon } from "./fsm/ops";
import { regexToNFA } from "./fsm/regex";
import { fsmToRegex } from "./fsm/toRegex";
import { evaluateExpression } from "./expr/expression";
import { cyk, cykAnimation, cykMembership, cykOrder } from "./grammar/cyk";
import { parseGrammar } from "./parse/definitionParser";
import { allWords, randomCFG, randomNFA, rng } from "./testing";
import { EPS } from "./types";

const fsm = (states: string[], start: string, accept: string[], t: [string, string, string][], alphabet = ["0", "1"]) =>
  makeFSM({ name: "M", alphabet, states, start, accept, transitions: t.map(([from, symbol, to]) => ({ from, symbol, to })) });

const keysOf = (f: FSM) => f.transitions.map((t) => transKey(t.from, t.symbol, t.to));

// 2.15: the words ending in 01
const ends01 = fsm(["A", "B", "C"], "A", ["C"], [
  ["A", "0", "A"],
  ["A", "1", "A"],
  ["A", "0", "B"],
  ["B", "1", "C"]
]);

/** 2.30: the DFA of the words ending in 01 that remembers the last two letters */
function lastTwo(): FSM {
  const states = ["S", "0", "1", "00", "01", "10", "11"];
  const transitions = states.flatMap((s) =>
    ["0", "1"].map((c) => ({ from: s, symbol: c, to: ((s === "S" ? "" : s) + c).slice(-2) }))
  );
  return makeFSM({ name: "M", alphabet: ["0", "1"], states, start: "S", accept: ["01"], transitions });
}

describe("the subset construction played on its result", () => {
  it("2.17 frame by frame: the start set, then δ'(R, a) row by row, then the whole automaton", () => {
    const r = determinize(ends01);
    const d = r.value!;
    const frames = r.animation!.frames;
    expect(frames.every((f) => f.graph === d)).toBe(true);
    expect(frames.map((f) => f.caption.key.replace("ops.det.anim.", ""))).toEqual([
      "start",
      "new", // δ'({A}, 0) = {A,B}
      "known", // δ'({A}, 1) = {A}
      "known", // δ'({A,B}, 0) = {A,B}
      "newAccept", // δ'({A,B}, 1) = {A,C}
      "known",
      "known",
      "done"
    ]);
    expect(frames.map((f) => f.shown)).toEqual([
      ["{A}"],
      ["{A}", "{A,B}"],
      ["{A}", "{A,B}"],
      ["{A}", "{A,B}"],
      ["{A}", "{A,B}", "{A,C}"],
      ["{A}", "{A,B}", "{A,C}"],
      ["{A}", "{A,B}", "{A,C}"],
      undefined
    ]);
    // a set waits (faded) from when it is found until its row is processed
    expect(frames.map((f) => f.pending)).toEqual([
      ["{A}"],
      ["{A,B}"],
      ["{A,B}"],
      [],
      ["{A,C}"],
      [],
      [],
      undefined
    ]);
    expect(frames[1].caption.params).toEqual({ set: "{A}", symbol: "0", expr: "{A,B}" });
    expect(frames[3].caption.params).toEqual({ set: "{A,B}", symbol: "0", expr: "{A,B} ∪ ∅ = {A,B}" });
    expect(frames[3].focus).toEqual(["{A,B}"]);
    expect(frames[3].focusEdges).toEqual([transKey("{A,B}", "0", "{A,B}")]);
  });

  it("every transition appears exactly once, in the frame that computes it, and stays", () => {
    const frames = determinize(ends01).animation!.frames;
    const middle = frames.slice(1, -1);
    middle.forEach((f, i) => {
      expect(f.edges!.length).toBe(i + 1);
      expect(f.edges!.slice(0, i)).toEqual(i === 0 ? [] : middle[i - 1].edges);
      expect(f.focusEdges).toEqual([f.edges![i]]);
    });
    expect(new Set(middle.at(-1)!.edges)).toEqual(new Set(keysOf(determinize(ends01).value!)));
  });

  it("the empty set appears where a letter leads nowhere, and gets its loops at the end", () => {
    const m = fsm(["p", "q"], "p", ["q"], [["p", "0", "q"]]);
    const r = determinize(m);
    const frames = r.animation!.frames;
    const keys = frames.map((f) => f.caption.key.replace("ops.det.anim.", ""));
    expect(keys).toEqual(["start", "newAccept", "empty", "known", "known", "trap", "done"]);
    expect(frames[2].shown).toEqual(["{p}", "{q}", "∅"]);
    expect(frames[5].focusEdges).toEqual([transKey("∅", "0", "∅"), transKey("∅", "1", "∅")]);
    expect(new Set(frames[5].edges)).toEqual(new Set(keysOf(r.value!)));
    expect(frames[5].pending).toEqual([]);
  });

  it("an ε-NFA starts from the closure, and says so", () => {
    const m = fsm(["p", "q"], "p", ["q"], [["p", "ε", "q"], ["q", "0", "q"]], ["0"]);
    const first = determinize(m).animation!.frames[0];
    expect(first.caption).toEqual({ key: "ops.det.anim.startEpsilon", params: { start: "{p,q}", startExpr: "E({p})" } });
  });

  it("random NFAs: the frames end with every state and transition of the result, each shown state drawn", () => {
    const rand = rng(11);
    for (let i = 0; i < 60; i++) {
      const r = determinize(randomNFA(rand, { states: 4, alphabet: ["a", "b"], density: 0.35, epsDensity: i % 2 === 0 ? 0.15 : 0 }));
      const d = r.value!;
      const frames = r.animation!.frames;
      const lastPartial = frames.at(-2)!;
      expect(new Set(lastPartial.shown)).toEqual(new Set(d.states));
      expect(new Set(lastPartial.edges)).toEqual(new Set(keysOf(d)));
      expect(lastPartial.edges!.length).toBe(d.transitions.length);
      for (const f of frames.slice(0, -1)) {
        const shown = new Set(f.shown);
        for (const k of f.edges!) {
          const [from, , to] = k.split("\u0001");
          expect(shown.has(from) && shown.has(to)).toBe(true);
        }
        for (const p of f.pending!) expect(shown.has(p)).toBe(true);
      }
    }
  });

  it("a result too big to watch records no animation", () => {
    // n states, every subset reachable: 2ⁿ states
    const n = 6;
    const states = Array.from({ length: n }, (_, i) => `q${i}`);
    const t: [string, string, string][] = states.flatMap((s, i) => [
      [s, "0", states[(i + 1) % n]] as [string, string, string],
      [s, "1", s] as [string, string, string],
      [s, "1", states[0]] as [string, string, string]
    ]);
    const r = determinize(fsm(states, "q0", ["q0"], t));
    expect(r.value!.states.length).toBeGreaterThan(ANIMATION_STATE_LIMIT);
    expect(r.animation).toBeUndefined();
  });
});

describe("the minimization played on the automaton it minimizes", () => {
  it("2.30: the classes split round by round, then the result keeps their colours", () => {
    const m = lastTwo();
    const r = minimize(m);
    const frames = r.animation!.frames;
    const kinds = frames.map((f) => f.caption.key.replace("ops.min.anim.", ""));
    // start, a frame per state per round, a split or the fixpoint closing each round, the result
    const rounds = kinds.filter((k) => k === "split" || k === "fixpoint").length;
    expect(kinds[0]).toBe("start");
    expect(kinds.at(-2)).toBe("fixpoint");
    expect(kinds.at(-1)).toBe("build");
    expect(kinds.filter((k) => k === "state").length).toBe(rounds * m.states.length);
    expect(frames.slice(0, -1).every((f) => f.graph === m)).toBe(true);
    expect(frames.at(-1)!.graph).toBe(r.value);

    // 0-equivalence: A₁ = Q − F, A₂ = F
    expect(frames[0].tags).toEqual({ S: "A_1", "0": "A_1", "1": "A_1", "00": "A_1", "10": "A_1", "11": "A_1", "01": "A_2" });
    expect(frames[0].classes!["01"]).toBe(1);

    // a state's frame looks at where each letter takes it
    const first = frames[1];
    expect(first.focus).toEqual(["S"]);
    expect(first.focusEdges).toEqual([transKey("S", "0", "0"), transKey("S", "1", "1")]);
    expect(first.caption.params).toEqual({ round: 1, state: "S", group: "A_1", moves: "0 → 0 ∈ A_1, 1 → 1 ∈ A_1" });

    // the final classes colour the result: one colour per state, all different
    const result = frames.at(-1)!;
    expect(Object.keys(result.classes!).sort()).toEqual([...r.value!.states].sort());
    expect(new Set(Object.values(result.classes!)).size).toBe(r.value!.states.length);
  });

  it("the colours always match the partition the steps state", () => {
    const rand = rng(5);
    for (let i = 0; i < 40; i++) {
      const d = determinize(randomNFA(rand, { states: 4, alphabet: ["a", "b"], density: 0.4 })).value!;
      const r = minimize(d);
      const frames = r.animation!.frames;
      for (const f of frames.slice(0, -1)) {
        // every state is coloured, and a tag names its colour's group
        expect(Object.keys(f.classes!).sort()).toEqual([...f.graph.states].sort());
        for (const [st, c] of Object.entries(f.classes!)) expect(f.tags![st]).toBe(`A_${c + 1}`);
      }
      // the last partition is the result's classes
      const fixpoint = frames.at(-2)!;
      const groups = new Set(Object.values(fixpoint.classes!));
      expect(groups.size).toBe(r.value!.states.length);
    }
  });
});

describe("a chain plays every animated operation", () => {
  it("min(det(M)) has the subset construction's frames, then the minimization's", () => {
    const env = new Map([["M", ends01]]);
    const out = evaluateExpression("min(det(M))", env).value!;
    const animated = out.stepGroups.filter((g) => g.animation).map((g) => g.operation);
    expect(animated).toEqual(["det(M)", "min(det(M))"]);
    const frames: AnimFrame[] = out.stepGroups.flatMap((g) => g.animation?.frames ?? []);
    expect(frames[0].caption.key).toBe("ops.det.anim.start");
    expect(frames.at(-1)!.caption.key).toBe("ops.min.anim.build");
  });
});

describe("the CYK table filling in", () => {
  const grammar = (rules: string, terminals = "a, b") => {
    const r = parseGrammar(`Grammar:
  name: G
  charset: ${terminals}
  variables: S, A, B, C
  init: S
  rules:
${rules
  .trim()
  .split("\n")
  .map((l) => `    - ${l.trim()}`)
  .join("\n")}`);
    if (!r.ok) throw new Error(JSON.stringify(r.diagnostics));
    return r.value!;
  };
  // 8.1
  const notes81 = grammar(`S -> AB | BC
     A -> BA | a
     B -> CC | b
     C -> AB | a`);
  const play = (word: string, g = notes81) => cykAnimation(g, cyk(g, word).value!);
  const kinds = (frames: ReturnType<typeof play>) => frames.map((f) => f.caption.key.replace("grammar.cyk.anim.", ""));

  it("8.1 with baaba: the bottom row letter by letter, then the rows above, then the top-left cell decides", () => {
    const frames = play("baaba");
    expect(kinds(frames)).toEqual([
      "start",
      ...Array(5).fill("letter"),
      ...Array(4).fill("cell"),
      "cellEmpty", // T[3,1]: the notes' crossed-out cell
      "cell",
      "cell",
      "cellEmpty",
      "cell",
      "cell",
      "accepted"
    ]);
    // every cell once, row by row from the bottom, each row from the left
    expect(frames.slice(1, -1).map((f) => f.cell)).toEqual(
      [0, 1, 2, 3, 4].flatMap((j) => Array.from({ length: 5 - j }, (_, i) => [j, i]))
    );
    expect(frames.map((f) => f.filled)).toEqual([...Array.from({ length: 16 }, (_, k) => k), 15]);
    expect(frames.at(-1)!.caption.params).toEqual({ start: "S", n: 5 });
  });

  it("8.1: T[2,1] and T[3,1] as the notes explain them", () => {
    const frames = play("baaba");
    const at = (length: number, start: number) => frames.find((f) => f.cell?.[0] === length - 1 && f.cell[1] === start - 1)!;
    expect(at(1, 2).caption.params).toMatchObject({ length: 1, start: 2, word: "a", cell: "{A, C}", reasons: "A → a; C → a" });
    // T[2,1]: one pair of cells, T[1,1] = {B} and T[1,2] = {A, C}, gives BA and BC
    const t21 = at(2, 1);
    expect(t21.caption.params).toMatchObject({ length: 2, start: 1, word: "ba", cell: "{S, A}" });
    expect(String(t21.caption.params!.reasons).split("; ").sort()).toEqual([
      "A → BA: B ∈ T[1,1], A ∈ T[1,2]",
      "S → BC: B ∈ T[1,1], C ∈ T[1,2]"
    ]);
    expect(t21.uses).toEqual([
      [0, 0],
      [0, 1]
    ]);
    // T[3,1]: the pairs T[1,1]–T[2,2] and T[2,1]–T[1,3] give BB, AA, AC, SA, SC — no rule
    const t31 = at(3, 1);
    expect(t31.caption).toEqual({
      key: "grammar.cyk.anim.cellEmpty",
      params: { length: 3, start: 1, word: "baa", cell: "∅", reasons: "", splits: "b·aa, ba·a" }
    });
    expect(t31.uses).toEqual([]);
    // T[5,1]: only the splits whose two cells have a matching rule are used
    const t51 = at(5, 1);
    for (const [j, i] of t51.uses) expect(cyk(notes81, "baaba").value!.cells[j][i].size).toBeGreaterThan(0);
    expect(t51.uses.length % 2).toBe(0);
  });

  it("a word that is not derivable, and a letter that no rule produces", () => {
    expect(kinds(play("bb"))).toEqual(["start", "letter", "letter", "cellEmpty", "rejected"]);
    const g = grammar(
      `S -> AB | BC
       A -> BA | a
       B -> CC | b
       C -> AB | a`,
      "a, b, c"
    );
    const frames = play("bc", g);
    expect(kinds(frames)).toEqual(["start", "letter", "letterEmpty", "cellEmpty", "rejected"]);
    expect(frames[2].caption.params).toMatchObject({ length: 1, start: 2, word: "c", cell: "∅" });
  });

  it("the filling order numbers the cells 0, 1, … row by row", () => {
    for (const n of [1, 2, 5, 9]) {
      const order = Array.from({ length: n }, (_, j) => Array.from({ length: n - j }, (_, i) => cykOrder(j, i, n))).flat();
      expect(order).toEqual(Array.from({ length: (n * (n + 1)) / 2 }, (_, k) => k));
    }
  });

  it("random grammars: a cell uses two adjacent parts of its subword, filled before it, exactly when it is not empty", () => {
    const rand = rng(29);
    let checked = 0;
    for (let i = 0; i < 200; i++) {
      const g = randomCFG(rand);
      for (const word of ["ab", "aba", "abba", "baab", "aabab"]) {
        const m = cykMembership(g, word).value!;
        if (!m.table) continue;
        const { table } = m;
        const frames = cykAnimation(m.cnf!, table);
        const n = word.length;
        expect(frames.length).toBe((n * (n + 1)) / 2 + 2);
        expect(frames.at(-1)!.caption.key).toBe(table.accepted ? "grammar.cyk.anim.accepted" : "grammar.cyk.anim.rejected");
        for (const f of frames.slice(1, -1)) {
          const [j, i] = f.cell!;
          expect(f.filled).toBe(cykOrder(j, i, n) + 1);
          const empty = table.cells[j][i].size === 0;
          expect(f.caption.key.endsWith("Empty")).toBe(empty);
          if (j === 0 || empty) {
            expect(f.uses).toEqual([]);
            continue;
          }
          expect(f.uses.length).toBeGreaterThan(0);
          for (let k = 0; k < f.uses.length; k += 2) {
            const [[lj, li], [rj, ri]] = [f.uses[k], f.uses[k + 1]];
            expect(li).toBe(i);
            expect(ri).toBe(i + lj + 1);
            expect(lj + 1 + rj + 1).toBe(j + 1);
            expect(cykOrder(lj, li, n)).toBeLessThan(f.filled - 1);
            expect(cykOrder(rj, ri, n)).toBeLessThan(f.filled - 1);
          }
          checked++;
        }
      }
    }
    expect(checked).toBeGreaterThan(100);
  });
});

describe("the r(p, q, t) rounds played on the automaton", () => {
  // 3.23
  const notes323 = fsm(["1", "2"], "1", ["2"], [
    ["1", "a", "1"],
    ["1", "b", "2"],
    ["2", "a", "2"],
    ["2", "b", "2"]
  ], ["a", "b"]);

  it("3.23 frame by frame: numbering, r(p, q, 0), each round with the entries it changes, the result", () => {
    const r = fsmToRegex(notes323);
    const frames = r.animation!.frames;
    expect(frames.every((f) => f.graph === notes323)).toBe(true);
    expect(frames.map((f) => f.caption.key)).toEqual([
      "ops.toRegex.numbering.detail",
      "ops.toRegex.base.detail",
      "ops.toRegex.anim.round",
      "ops.toRegex.anim.cell", // r(1, 1, 1)
      "ops.toRegex.anim.cell", // r(1, 2, 1)
      "ops.toRegex.anim.roundDone",
      "ops.toRegex.anim.round",
      "ops.toRegex.anim.cell", // r(1, 2, 2)
      "ops.toRegex.anim.cell", // r(2, 2, 2)
      "ops.toRegex.anim.roundDone",
      "ops.toRegex.result.detail"
    ]);
    expect(frames.every((f) => f.tags!["1"] === "1" && f.tags!["2"] === "2")).toBe(true);
    expect(frames[1].table).toEqual({
      headers: ["r(p, q, 0)", "1", "2"],
      rows: [
        ["1", "a+ε", "b"],
        ["2", "∅", "a+b+ε"]
      ]
    });

    // round 1: state 1 may be passed through; row 1 and column 1 of r(p, q, 0) are used
    const round1 = frames[2];
    expect(round1.caption.params).toEqual({ t: 1, prev: 0, state: "1" });
    expect(round1.focus).toEqual(["1"]);
    expect(round1.classes).toEqual({ "1": 1 });
    expect(new Set(round1.table!.marked!.map(String))).toEqual(new Set(["0,1", "0,2", "1,1"]));

    // the notes' two computations
    expect(frames[3].caption.params).toEqual({
      p: 1,
      q: 1,
      t: 1,
      prev: 0,
      formula: "(a+ε) + (a+ε)(a+ε)*(a+ε)",
      value: "a*"
    });
    expect(frames[4].caption.params).toEqual({ p: 1, q: 2, t: 1, prev: 0, formula: "b + (a+ε)(a+ε)*b", value: "a*b" });
    expect(frames[4].focus).toEqual(["1", "2"]);
    expect(frames[4].table!.focus).toEqual([[0, 2]]);
    expect(frames[4].table!.marked).toEqual([
      [0, 1],
      [0, 1],
      [0, 2]
    ]);
    // a computation shows the table it reads from: r(p, q, 0)
    expect(frames[4].table!.rows).toEqual(frames[1].table!.rows);

    expect(frames[5].caption.params).toEqual({ t: 1, count: 2 });
    expect(frames[5].classes).toEqual({ "1": 0 });
    expect(frames[5].table).toEqual({
      headers: ["r(p, q, 1)", "1", "2"],
      rows: [
        ["1", "a*", "a*b"],
        ["2", "∅", "a+b+ε"]
      ],
      focus: [
        [0, 1],
        [0, 2]
      ]
    });

    expect(frames[7].caption.params).toMatchObject({ p: 1, q: 2, formula: "a*b + a*b(a+b+ε)*(a+b+ε)", value: "a*b(a+b)*" });
    expect(frames[8].caption.params).toMatchObject({ p: 2, q: 2, value: "(a+b)*" });
    expect(frames[6].classes).toEqual({ "1": 0, "2": 1 });

    const result = frames.at(-1)!;
    expect(result.caption).toEqual(r.steps.at(-1)!.detail);
    expect(result.focus).toEqual(["2"]);
    expect(result.classes).toEqual({ "1": 0, "2": 0 });
    expect(result.table!.rows).toEqual([
      ["1", "a*", "a*b(a+b)*"],
      ["2", "∅", "(a+b)*"]
    ]);
    expect(result.table!.focus).toEqual([[0, 2]]);
  });

  it("a round names its state by number, and by name when that differs", () => {
    const rounds = fsmToRegex(ends01).animation!.frames.filter((f) => f.caption.key === "ops.toRegex.anim.round");
    expect(rounds.map((f) => f.caption.params!.state)).toEqual(["1 (A)", "2 (B)", "3 (C)"]);
    expect(rounds.map((f) => f.focus)).toEqual([["A"], ["B"], ["C"]]);
    expect(rounds[1].classes).toEqual({ A: 0, B: 1 });
  });

  it("a round that changes nothing says so", () => {
    // state 2 is a dead end: nothing leads out of it, so passing through it adds nothing
    const m = fsm(["1", "2"], "1", ["1"], [["1", "a", "2"]], ["a"]);
    const keys = fsmToRegex(m).animation!.frames.map((f) => f.caption.key.replace("ops.toRegex.", ""));
    expect(keys).toContain("anim.roundSame");
  });

  it("random NFAs: each computed entry is the one the next table shows, and the tables are the steps' tables", () => {
    const rand = rng(17);
    for (let i = 0; i < 60; i++) {
      const f = randomNFA(rand, { states: 1 + (i % 4), alphabet: ["a", "b"], density: 0.35, epsDensity: i % 3 === 0 ? 0.15 : 0 });
      const r = fsmToRegex(f);
      if (!r.ok) continue;
      const frames = r.animation!.frames;
      const stepTables = r.steps.filter((s) => s.table).slice(1).map((s) => s.table!.rows.map((row) => row.slice(1)));
      const frameTables = frames
        .filter((fr) => ["ops.toRegex.base.detail", "ops.toRegex.anim.roundDone", "ops.toRegex.anim.roundSame"].includes(fr.caption.key))
        .map((fr) => fr.table!.rows.map((row) => row.slice(1)));
      expect(frameTables).toEqual(stepTables);
      let pending: { p: number; q: number; value: string }[] = [];
      for (const fr of frames) {
        if (fr.caption.key === "ops.toRegex.anim.cell") {
          const { p, q, value } = fr.caption.params as { p: number; q: number; value: string };
          pending.push({ p, q, value });
        }
        if (fr.caption.key === "ops.toRegex.anim.roundDone" || fr.caption.key === "ops.toRegex.anim.roundSame") {
          for (const c of pending) expect(fr.table!.rows[c.p - 1][c.q]).toBe(c.value);
          expect(fr.table!.focus!.length).toBe(pending.length);
          pending = [];
        }
      }
    }
  });

  it("an automaton with too many states records no animation", () => {
    expect(fsmToRegex(lastTwo()).animation).toBeUndefined();
  });

  it("toRegex(min(M)) plays the minimization, then the rounds", () => {
    const env = new Map([["M", lastTwo()]]);
    const out = evaluateExpression("toRegex(min(M))", env).value!;
    expect(out.stepGroups.filter((g) => g.animation).map((g) => g.operation)).toEqual(["min(M)", "toRegex(min(M))"]);
  });
});

describe("the product built pair by pair", () => {
  // 3.7: La (first and last letter a) and Lb (first and last letter b), D and T are traps
  const la = fsm(["A", "B", "C", "D"], "A", ["B"], [
    ["A", "a", "B"],
    ["A", "b", "D"],
    ["B", "a", "B"],
    ["B", "b", "C"],
    ["C", "a", "B"],
    ["C", "b", "C"],
    ["D", "a", "D"],
    ["D", "b", "D"]
  ], ["a", "b"]);
  const lb = fsm(["X", "Y", "Z", "T"], "X", ["Y"], [
    ["X", "b", "Y"],
    ["X", "a", "T"],
    ["Y", "b", "Y"],
    ["Y", "a", "Z"],
    ["Z", "b", "Y"],
    ["Z", "a", "Z"],
    ["T", "a", "T"],
    ["T", "b", "T"]
  ], ["a", "b"]);
  const kinds = (frames: AnimFrame[]) => frames.map((f) => f.caption.key.replace("ops.product.anim.", ""));

  it("3.7 frame by frame: the start pair, then δ((p, q), a) row by row — the five pairs of the notes", () => {
    const r = product(la, lb, "union");
    const u = r.value!;
    const frames = r.animation!.frames;
    expect(frames.every((f) => f.graph === u)).toBe(true);
    expect(kinds(frames)).toEqual([
      "start",
      "newAccept", // δ((A,X), a) = (B,T): B ∈ F₁
      "newAccept", // δ((A,X), b) = (D,Y): Y ∈ F₂
      "known",
      "new", // (C,T)
      "new", // (D,Z)
      "known",
      "known",
      "known",
      "known",
      "known",
      "done"
    ]);
    expect(frames.map((f) => f.shown)).toEqual([
      ["(A,X)"],
      ["(A,X)", "(B,T)"],
      ["(A,X)", "(B,T)", "(D,Y)"],
      ["(A,X)", "(B,T)", "(D,Y)"],
      ["(A,X)", "(B,T)", "(D,Y)", "(C,T)"],
      ["(A,X)", "(B,T)", "(D,Y)", "(C,T)", "(D,Z)"],
      ...Array(5).fill(["(A,X)", "(B,T)", "(D,Y)", "(C,T)", "(D,Z)"]),
      undefined
    ]);
    // a pair waits (dashed) from when it is found until its row is processed
    expect(frames.map((f) => f.pending)).toEqual([
      ["(A,X)"],
      ["(B,T)"],
      ["(B,T)", "(D,Y)"],
      ["(D,Y)"],
      ["(D,Y)", "(C,T)"],
      ["(C,T)", "(D,Z)"],
      ["(C,T)", "(D,Z)"],
      ["(D,Z)"],
      ["(D,Z)"],
      [],
      [],
      undefined
    ]);
    expect(frames[0].caption).toEqual({ key: "ops.product.anim.start", params: { start: "(A,X)" } });
    expect(frames[1].caption.params).toEqual({ pair: "(A,X)", symbol: "a", p: "A", q: "X", to: "(B,T)", why: "B ∈ F₁" });
    expect(frames[2].caption.params).toEqual({ pair: "(A,X)", symbol: "b", p: "A", q: "X", to: "(D,Y)", why: "Y ∈ F₂" });
    expect(frames[4].caption.params).toEqual({ pair: "(B,T)", symbol: "b", p: "B", q: "T", to: "(C,T)" });
    expect(frames[4].focus).toEqual(["(B,T)"]);
    expect(frames[4].focusEdges).toEqual([transKey("(B,T)", "b", "(C,T)")]);
    expect(frames.at(-1)!.caption.params).toEqual({ count: 5, n1: 4, n2: 4, possible: 16 });
    expect(new Set(frames.at(-2)!.edges)).toEqual(new Set(keysOf(u)));
  });

  // even number of a's × ends with b
  const even = fsm(["E", "O"], "E", ["E"], [
    ["E", "a", "O"],
    ["O", "a", "E"],
    ["E", "b", "E"],
    ["O", "b", "O"]
  ], ["a", "b"]);
  const endsB = fsm(["N", "B"], "N", ["B"], [
    ["N", "a", "N"],
    ["N", "b", "B"],
    ["B", "a", "N"],
    ["B", "b", "B"]
  ], ["a", "b"]);

  it("the reason a pair accepts follows the operation: both coordinates, or the first but not the second", () => {
    const meet = product(even, endsB, "intersect").animation!.frames;
    expect(meet[0].caption.key).toBe("ops.product.anim.start");
    const eb = meet.find((f) => f.caption.params?.to === "(E,B)" && f.caption.key.endsWith("newAccept"))!;
    expect(eb.caption.params!.why).toBe("E ∈ F₁, B ∈ F₂");
    const minus = product(even, endsB, "difference").animation!.frames;
    // (E,N) accepts at once: an even number of a's, not ending in b
    expect(minus[0].caption).toEqual({ key: "ops.product.anim.startAccept", params: { start: "(E,N)", why: "E ∈ F₁, N ∉ F₂" } });
    expect(kinds(minus).filter((k) => k === "newAccept")).toEqual([]);
    // the union names only the coordinate that accepts
    const union = product(even, endsB, "union").animation!.frames;
    expect(union[0].caption.params!.why).toBe("E ∈ F₁");
    const ob = union.find((f) => f.caption.params?.to === "(O,B)")!;
    expect(ob.caption.params!.why).toBe("B ∈ F₂");
  });

  it("over a common alphabet, the possible pairs count the trap states the completion adds", () => {
    const onlyA = fsm(["p"], "p", ["p"], [["p", "a", "p"]], ["a"]);
    const onlyB = fsm(["q"], "q", ["q"], [["q", "b", "q"]], ["b"]);
    const r = product(onlyA, onlyB, "union");
    expect(r.animation!.frames.at(-1)!.caption.params).toEqual({ count: r.value!.states.length, n1: 2, n2: 2, possible: 4 });
  });

  it("random DFAs: the pairs and transitions appear exactly as built, and a new pair accepts exactly when the caption says so", () => {
    const rand = rng(23);
    const modes: ProductMode[] = ["union", "intersect", "difference"];
    for (let i = 0; i < 60; i++) {
      const dfa = () => complete(determinize(randomNFA(rand, { states: 3, alphabet: ["a", "b"], density: 0.4 })).value!).value!;
      const [m1, m2] = [dfa(), dfa()];
      const mode = modes[i % 3];
      const r = product(m1, m2, mode);
      const out = r.value!;
      const frames = r.animation!.frames;
      const lastPartial = frames.at(-2)!;
      expect(new Set(lastPartial.shown)).toEqual(new Set(out.states));
      expect(new Set(lastPartial.edges)).toEqual(new Set(keysOf(out)));
      expect(lastPartial.edges!.length).toBe(out.transitions.length);
      expect(lastPartial.pending).toEqual([]);
      const accept = new Set(out.accept);
      for (const f of frames.slice(1, -1)) {
        const shown = new Set(f.shown);
        for (const k of f.edges!) {
          const [from, , to] = k.split("\u0001");
          expect(shown.has(from) && shown.has(to)).toBe(true);
        }
        const { to, why } = f.caption.params as { to: string; why?: string };
        const kind = f.caption.key.replace("ops.product.anim.", "");
        if (kind === "newAccept") {
          expect(accept.has(to)).toBe(true);
          if (mode === "intersect") expect(why).toMatch(/∈ F₁, .* ∈ F₂$/);
          if (mode === "difference") expect(why).toMatch(/∈ F₁, .* ∉ F₂$/);
          if (mode === "union") expect(why).not.toContain("∉");
        }
        if (kind === "new") expect(accept.has(to)).toBe(false);
      }
    }
  });

  it("union(M, N) plays the product in a chain", () => {
    const env = new Map([
      ["M", la],
      ["N", lb]
    ]);
    const out = evaluateExpression("min(union(M, N))", env).value!;
    expect(out.stepGroups.filter((g) => g.animation).map((g) => g.operation)).toEqual(["union(M, N)", "min(union(M, N))"]);
  });
});

/** Our regular expressions as JavaScript ones, for an independent check; x?* and x** are x*, x?? is x?. */
const jsRegex = (r: string) =>
  new RegExp(
    `^(?:${r
      .replace(/[*?]{2,}/g, (ops) => (ops.includes("*") ? "*" : "?"))
      .replaceAll("+", "|")
      .replaceAll("ε", "(?:)")
      .replaceAll("∅", "(?:(?!))")})$`
  );

describe("a regular expression's automaton built inside out", () => {
  const kinds = (frames: AnimFrame[]) => frames.map((f) => f.caption.key.replace("regex.anim.", ""));

  it("a+b: the two letters' automata side by side, each in its colour, then joined by a new start state", () => {
    const r = regexToNFA("a+b");
    const nfa = r.value!;
    const frames = r.animation!.frames;
    expect(frames.every((f) => f.graph === nfa)).toBe(true);
    expect(kinds(frames)).toEqual(["start", "lit", "lit", "alt", "done"]);
    expect(frames[0]).toMatchObject({ shown: [], edges: [], caption: { params: { expr: "a+b" } } });

    const [, a, b, alt] = frames;
    expect(a).toMatchObject({
      shown: ["q_1", "q_2"],
      edges: [transKey("q_1", "a", "q_2")],
      start: ["q_1"],
      accept: ["q_2"],
      classes: { q_1: 0, q_2: 0 },
      tags: { q_1: "a" },
      focus: ["q_1", "q_2"],
      focusEdges: [transKey("q_1", "a", "q_2")]
    });
    expect(a.caption.params).toEqual({ expr: "a", letter: "a", start: "q_1", accept: "q_2" });
    // two separate automata: two start states, two colours, each tagged with its expression
    expect(b).toMatchObject({
      shown: ["q_1", "q_2", "q_3", "q_4"],
      start: ["q_1", "q_3"],
      accept: ["q_2", "q_4"],
      classes: { q_1: 0, q_2: 0, q_3: 1, q_4: 1 },
      tags: { q_1: "a", q_3: "b" },
      focus: ["q_3", "q_4"]
    });
    expect(alt).toMatchObject({
      shown: ["q_0", "q_1", "q_2", "q_3", "q_4"],
      start: ["q_0"],
      accept: ["q_2", "q_4"],
      classes: { q_0: 0, q_1: 0, q_2: 0, q_3: 0, q_4: 0 },
      tags: { q_0: "a+b" },
      focus: ["q_0"],
      focusEdges: [transKey("q_0", EPS, "q_1"), transKey("q_0", EPS, "q_3")]
    });
    expect(alt.caption.params).toEqual({
      expr: "a+b",
      a: "a",
      b: "b",
      start: "q_0",
      aStart: "q_1",
      bStart: "q_3",
      accept: "q_2, q_4"
    });
    expect(new Set(alt.edges)).toEqual(new Set(keysOf(nfa)));
    expect(frames.at(-1)!.caption.params).toEqual({ expr: "a+b", count: 5 });
  });

  it("ab: the first automaton's accepting state stops accepting once ε leads on into the second", () => {
    const frames = regexToNFA("ab").animation!.frames;
    expect(kinds(frames)).toEqual(["start", "lit", "lit", "cat", "done"]);
    expect(frames[2].accept).toEqual(["q_1", "q_3"]);
    expect(frames[3]).toMatchObject({ start: ["q_0"], accept: ["q_3"], focus: [], focusEdges: [transKey("q_1", EPS, "q_2")] });
    expect(frames[3].caption.params).toEqual({
      expr: "ab",
      a: "a",
      b: "b",
      from: "q_1",
      bStart: "q_2",
      start: "q_0",
      accept: "q_3"
    });
  });

  it("star, optional, ε and ∅ — and the joins that have nothing to join from", () => {
    const star = regexToNFA("a*").animation!.frames;
    expect(kinds(star)).toEqual(["start", "lit", "star", "done"]);
    expect(star[2]).toMatchObject({
      start: ["q_0"],
      accept: ["q_0"],
      focus: ["q_0"],
      focusEdges: [transKey("q_0", EPS, "q_1"), transKey("q_2", EPS, "q_0")]
    });
    expect(star[2].caption.params).toEqual({ expr: "a*", a: "a", start: "q_0", aStart: "q_1", from: "q_2" });
    // a? is a + ε: the ε part is built (and shown) too
    expect(kinds(regexToNFA("a?").animation!.frames)).toEqual(["start", "lit", "eps", "opt", "done"]);
    expect(kinds(regexToNFA("∅*").animation!.frames)).toEqual(["start", "empty", "starNone", "done"]);
    const none = regexToNFA("∅a").animation!.frames;
    expect(kinds(none)).toEqual(["start", "empty", "lit", "catNone", "done"]);
    expect(none[3]).toMatchObject({ accept: ["q_2"], focusEdges: [] });
    const eps = regexToNFA("ε").animation!.frames;
    expect(eps[1]).toMatchObject({ shown: ["q_0"], start: ["q_0"], accept: ["q_0"], edges: [] });
  });

  it("every frame of 300 random expressions: each automaton drawn accepts exactly its subexpression's words", () => {
    const next = rng(77);
    const pick = <T,>(xs: T[]) => xs[Math.floor(next() * xs.length)];
    const gen = (depth: number): string => {
      if (depth === 0 || next() < 0.3) return pick(["a", "b", "a", "b", "ε", "∅"]);
      const x = gen(depth - 1);
      switch (pick(["alt", "cat", "star", "opt"])) {
        case "alt":
          return `(${x}+${gen(depth - 1)})`;
        case "cat":
          return `(${x})(${gen(depth - 1)})`;
        case "star":
          return `(${x})*`;
        default:
          return `(${x})?`;
      }
    };
    const words = allWords(["a", "b"], 4);
    let checked = 0;
    for (let i = 0; i < 300; i++) {
      const r = regexToNFA(gen(3));
      const nfa = r.value!;
      if (!r.animation) {
        expect(nfa.states.length).toBeGreaterThan(ANIMATION_STATE_LIMIT);
        continue;
      }
      const frames = r.animation.frames;
      const builds = frames.slice(1, -1);
      // one frame per row of the steps' table, the newest automaton tagged with the row's subexpression
      const rows = r.steps[0].table!.rows;
      expect(builds.length).toBe(rows.length);
      builds.forEach((f, k) => expect(f.tags![f.start!.at(-1)!]).toBe(rows[k][0]));
      // the last one is the whole automaton
      const whole = builds.at(-1)!;
      expect(new Set(whole.shown)).toEqual(new Set(nfa.states));
      expect(new Set(whole.edges)).toEqual(new Set(keysOf(nfa)));
      expect(whole.start).toEqual([nfa.start]);
      expect(whole.accept).toEqual(nfa.accept);

      for (const f of builds) {
        expect(new Set(Object.keys(f.classes!))).toEqual(new Set(f.shown));
        f.start!.forEach((start, part) => {
          expect(f.classes![start]).toBe(part);
          const states = f.shown!.filter((st) => f.classes![st] === part);
          const own = new Set(states);
          const transitions = f.edges!.map((k) => k.split("\u0001")).filter(([from]) => own.has(from));
          // no transition leads out of an automaton that is not joined yet
          for (const [, , to] of transitions) expect(own.has(to)).toBe(true);
          const drawn = makeFSM({
            name: "F",
            alphabet: ["a", "b"],
            states,
            start,
            accept: f.accept!.filter((st) => own.has(st)),
            transitions: transitions.map(([from, symbol, to]) => ({ from, symbol, to }))
          });
          const expected = jsRegex(f.tags![start]);
          for (const w of words) expect(acceptsFSM(drawn, w)).toBe(expected.test(w));
          checked++;
        });
      }
    }
    expect(checked).toBeGreaterThan(1500);
  });

  it("an expression with too many states records no animation", () => {
    const r = regexToNFA("a".repeat(ANIMATION_STATE_LIMIT));
    expect(r.value!.states.length).toBeGreaterThan(ANIMATION_STATE_LIMIT);
    expect(r.animation).toBeUndefined();
  });

  it("toFsm(R) plays the construction, and det(toFsm(R)) the subset construction after it", () => {
    const env = new Map([["R", { kind: "regex" as const, name: "R", pattern: "(a+b)*b" }]]);
    const out = evaluateExpression("det(toFsm(R))", env).value!;
    expect(out.stepGroups.filter((g) => g.animation).map((g) => g.operation)).toEqual(["toFsm(R)", "det(toFsm(R))"]);
  });
});

describe("ε-removal played on the automaton", () => {
  // a*b*c*: 0 →ε 1 →ε 2, with a loop on each
  const abc = fsm(["0", "1", "2"], "0", ["2"], [
    ["0", "a", "0"],
    ["0", EPS, "1"],
    ["1", "b", "1"],
    ["1", EPS, "2"],
    ["2", "c", "2"]
  ], ["a", "b", "c"]);
  const kinds = (frames: AnimFrame[]) => frames.map((f) => f.caption.key.replace("ops.epsfree.anim.", "").replace("ops.epsfree.", ""));

  it("a*b*c* frame by frame: E(q), then the transitions that become direct, then the new accepting states, then ε goes", () => {
    const r = removeEpsilon(abc);
    const out = r.value!;
    const frames = r.animation!.frames;
    // state 2: E(2) = {2} and nothing new — no frame of its own
    expect(kinds(frames)).toEqual(["start", "closure", "direct", "closure", "direct", "step3.detailChanged", "done"]);
    const graph = frames[0].graph;
    expect(frames.every((f) => f.graph === graph)).toBe(true);
    // laid out as the ε-NFA: the new transitions do not move its states
    expect(frames.every((f) => f.layout === abc)).toBe(true);
    expect(new Set(graph.states)).toEqual(new Set(abc.states));

    const eps = [transKey("0", EPS, "1"), transKey("1", EPS, "2")];
    expect(frames[0]).toMatchObject({ edges: keysOf(abc), accept: ["2"], focusEdges: eps });
    expect(frames[1]).toMatchObject({ accept: ["2"], focus: ["0", "1", "2"], focusEdges: eps });
    expect(frames[1].caption.params).toEqual({ state: "0", closure: "{0,1,2}" });

    const from0 = [
      transKey("0", "a", "1"),
      transKey("0", "a", "2"),
      transKey("0", "b", "1"),
      transKey("0", "b", "2"),
      transKey("0", "c", "2")
    ];
    expect(frames[2]).toMatchObject({ focus: ["0"], focusEdges: from0, edges: [...keysOf(abc), ...from0] });
    expect(frames[2].caption.params).toEqual({ state: "0", values: "δ'(0, a) = {0,1,2}; δ'(0, b) = {1,2}; δ'(0, c) = {2}" });
    // where each one comes from is the steps' table: the five of 0, then the two of 1
    const reasons = r.steps[1].table!.rows;
    expect(reasons[0]).toEqual(["δ'(0, a) ∋ 1", "0 ∈ E(0), δ(0,a) ∋ 0, 1 ∈ E(0)"]);
    expect(reasons.length).toBe(7);

    expect(frames[3]).toMatchObject({ focus: ["1", "2"], focusEdges: [transKey("1", EPS, "2")] });
    expect(frames[4].focusEdges).toEqual([transKey("1", "b", "2"), transKey("1", "c", "2")]);
    // 0 and 1 accept now: their closures contain 2
    expect(frames[5]).toMatchObject({ accept: ["0", "1", "2"], focus: ["0", "1"] });
    expect(frames[5].caption.params).toEqual({ list: "0, 1" });
    // the result: no ε-transition left
    expect(frames[6]).toMatchObject({ edges: keysOf(out), accept: out.accept });
    expect(frames[6].edges!.some((k) => k.includes(EPS))).toBe(false);
  });

  it("a closure that brings nothing new says so, and the accepting states may stay", () => {
    // p →ε q, but q reads nothing: δ'(p, a) = E({r}) = {r}, as before
    const m = fsm(["p", "q", "r"], "p", ["r"], [["p", EPS, "q"], ["p", "a", "r"]], ["a"]);
    const frames = removeEpsilon(m).animation!.frames;
    expect(kinds(frames)).toEqual(["start", "closureNoNew", "step3.detailUnchanged", "done"]);
    expect(frames[1].caption.params).toEqual({ state: "p", closure: "{p,q}" });
  });

  it("the steps' table lists only the transitions the automaton did not have", () => {
    // p →a q, q →ε r and the original p →a r: δ'(p, a) = {q, r}, nothing new
    const m = fsm(["p", "q", "r"], "p", ["r"], [["p", "a", "q"], ["q", EPS, "r"], ["p", "a", "r"]], ["a"]);
    const r = removeEpsilon(m);
    expect(r.steps.map((s) => s.title.key)).toEqual(["ops.epsfree.step1.title", "ops.epsfree.step3.title"]);
    expect(kinds(r.animation!.frames)).toEqual(["start", "closureNoNew", "step3.detailChanged", "done"]);
  });

  it("random ε-NFAs: every new transition appears once, from its own state, and the last frame is the result", () => {
    const rand = rng(41);
    for (let i = 0; i < 80; i++) {
      const f = randomNFA(rand, { states: 4, alphabet: ["a", "b"], density: 0.25, epsDensity: 0.3 });
      const r = removeEpsilon(f);
      if (!r.animation) {
        expect(f.transitions.some((t) => t.symbol === EPS)).toBe(false);
        continue;
      }
      const out = r.value!;
      const frames = r.animation.frames;
      const original = keysOf(f);
      const added = keysOf(out).filter((k) => !original.includes(k));
      const directs = frames.filter((fr) => fr.caption.key === "ops.epsfree.anim.direct");
      expect(directs.flatMap((fr) => fr.focusEdges)).toEqual(added);
      for (const fr of directs) {
        const from = fr.focus![0];
        for (const k of fr.focusEdges!) expect(k.split("\u0001")[0]).toBe(from);
        expect(fr.layout).toBe(f);
      }
      // the closures shown are the states reachable along ε alone
      for (const fr of frames.filter((x) => x.caption.key.startsWith("ops.epsfree.anim.closure"))) {
        const q = String(fr.caption.params!.state);
        const reach = new Set([q]);
        for (let grew = true; grew; ) {
          grew = false;
          for (const t of f.transitions)
            if (t.symbol === EPS && reach.has(t.from) && !reach.has(t.to)) {
              reach.add(t.to);
              grew = true;
            }
        }
        expect(new Set(fr.focus)).toEqual(reach);
      }
      // the accepting states change in one frame only, the one that says so
      const acceptAt = frames.findIndex((fr) => fr.caption.key.startsWith("ops.epsfree.step3"));
      expect(frames.slice(0, acceptAt).every((fr) => fr.accept === f.accept)).toBe(true);
      expect(frames.slice(acceptAt).every((fr) => fr.accept === out.accept)).toBe(true);
      const last = frames.at(-1)!;
      expect(new Set(last.edges)).toEqual(new Set(keysOf(out)));
      expect(frames.at(-2)!.edges!.length).toBe(original.length + added.length);
      // the last frame accepts what the automaton did
      const transitions = last.edges!.map((k) => {
        const [from, symbol, to] = k.split("\u0001");
        return { from, symbol, to };
      });
      const drawn = makeFSM({ ...f, accept: last.accept!, transitions });
      for (const w of allWords(["a", "b"], 4)) expect(acceptsFSM(drawn, w)).toBe(acceptsFSM(f, w));
    }
  });

  it("epsfree(M) plays in a chain", () => {
    const env = new Map([["M", abc]]);
    const out = evaluateExpression("det(epsfree(M))", env).value!;
    expect(out.stepGroups.filter((g) => g.animation).map((g) => g.operation)).toEqual(["epsfree(M)", "det(epsfree(M))"]);
  });
});
