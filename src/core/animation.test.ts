import { describe, expect, it } from "vitest";
import { ANIMATION_STATE_LIMIT, AnimFrame, transKey } from "./fsm/animation";
import { FSM, makeFSM } from "./fsm/fsm";
import { determinize, minimize } from "./fsm/ops";
import { fsmToRegex } from "./fsm/toRegex";
import { evaluateExpression } from "./expr/expression";
import { cyk, cykAnimation, cykMembership, cykOrder } from "./grammar/cyk";
import { parseGrammar } from "./parse/definitionParser";
import { randomCFG, randomNFA, rng } from "./testing";

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
