import { describe, expect, it } from "vitest";
import { ANIMATION_STATE_LIMIT, AnimFrame, transKey } from "./fsm/animation";
import { FSM, makeFSM } from "./fsm/fsm";
import { determinize, minimize } from "./fsm/ops";
import { evaluateExpression } from "./expr/expression";
import { randomNFA, rng } from "./testing";

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
