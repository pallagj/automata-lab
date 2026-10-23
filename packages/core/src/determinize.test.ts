import { describe, expect, it } from "vitest";
import { acceptsFSM, analyzeFSM, epsilonClosure, FSM, makeFSM } from "./fsm/fsm";
import { complement, determinize, minimize, product } from "./fsm/ops";
import { allWords, randomNFA, rng } from "./testing";
import { EPS, setName } from "./types";

const fsm = (states: string[], start: string, accept: string[], t: [string, string, string][], alphabet = ["0", "1"]) =>
  makeFSM({ name: "M", alphabet, states, start, accept, transitions: t.map(([from, symbol, to]) => ({ from, symbol, to })) });

/** δ' of the result as a map "R,a" → set name. */
const deltaOf = (d: FSM) => new Map(d.transitions.map((t) => [`${t.from},${t.symbol}`, t.to]));

describe("the subset construction (lecture notes 2.16)", () => {
  // 2.15: the words ending in 01
  const ends01 = fsm(["A", "B", "C"], "A", ["C"], [
    ["A", "0", "A"],
    ["A", "1", "A"],
    ["A", "0", "B"],
    ["B", "1", "C"]
  ]);

  it("2.17: the states A, AB, AC and their transitions, as the notes work them out", () => {
    const r = determinize(ends01);
    const d = r.value!;
    expect(d.states).toEqual(["{A}", "{A,B}", "{A,C}"]);
    expect(d.start).toBe("{A}");
    expect(d.accept).toEqual(["{A,C}"]);
    const delta = deltaOf(d);
    expect([...delta]).toEqual([
      ["{A},0", "{A,B}"],
      ["{A},1", "{A}"],
      ["{A,B},0", "{A,B}"],
      ["{A,B},1", "{A,C}"],
      ["{A,C},0", "{A,B}"],
      ["{A,C},1", "{A}"]
    ]);
    // the table writes δ'(R, a) as the union of its parts, as 2.17 does: {A,B} ∪ ∅ = {A,B}
    const table = r.steps.find((s) => s.title.key === "ops.det.step.title")!.table!;
    expect(table.rows).toEqual([
      ["{A}", "{A,B}", "{A}"],
      ["{A,B}", "{A,B} ∪ ∅ = {A,B}", "{A} ∪ {C} = {A,C}"],
      ["{A,C}", "{A,B} ∪ ∅ = {A,B}", "{A} ∪ ∅ = {A}"]
    ]);
    // no ∅ state here, so no word about it
    expect(r.diagnostics.some((x) => x.title.key === "ops.det.emptySet.title")).toBe(false);
  });

  it("2.18: an ε-transition is followed through E(·) — six states, the ones the figure shows", () => {
    const n = fsm(["A", "B", "C", "D"], "A", ["D"], [
      ["A", "0", "A"],
      ["A", "1", "A"],
      ["A", "1", "B"],
      ["B", "0", "C"],
      ["B", EPS, "C"],
      ["C", "1", "D"],
      ["D", "0", "D"],
      ["D", "1", "D"]
    ]);
    const r = determinize(n);
    const d = r.value!;
    expect(d.states).toEqual(["{A}", "{A,B,C}", "{A,C}", "{A,B,C,D}", "{A,C,D}", "{A,D}"]);
    expect(d.accept).toEqual(["{A,B,C,D}", "{A,C,D}", "{A,D}"]);
    // the closures come first, then the construction
    expect(r.steps.map((s) => s.title.key)).toEqual(["ops.det.closures.title", "ops.det.step.title", "ops.det.result.title"]);
    expect(r.steps[0].table!.rows).toEqual([
      ["A", "{A}"],
      ["B", "{B,C}"],
      ["C", "{C}"],
      ["D", "{D}"]
    ]);
    for (const w of allWords(["0", "1"], 7)) expect(acceptsFSM(d, w), w).toBe(/101|11/.test(w));
  });

  it("the start state is E({q₀}): ε-moves from the start are taken before reading", () => {
    const n = fsm(["S", "A", "B"], "S", ["A", "B"], [
      ["S", EPS, "A"],
      ["S", EPS, "B"],
      ["A", "a", "A"],
      ["B", "b", "B"]
    ], ["a", "b"]);
    const r = determinize(n);
    expect(r.value!.start).toBe("{A,B,S}");
    expect(r.steps.find((s) => s.title.key === "ops.det.step.title")!.detail!.params?.startExpr).toBe("E({S})");
    // a ∅ trap appears: and the notes about it
    expect(r.value!.states).toContain("∅");
    expect(r.diagnostics.some((x) => x.title.key === "ops.det.emptySet.title")).toBe(true);
  });

  it("gives a complete DFA of the same language for 500 random ε-NFAs, built only from reachable sets", () => {
    const next = rng(2161);
    for (let k = 0; k < 500; k++) {
      const n = randomNFA(next, { states: 1 + Math.floor(next() * 5), alphabet: ["a", "b"] });
      const d = determinize(n).value!;
      expect(analyzeFSM(d).isCompleteDFA, String(k)).toBe(true);
      expect(analyzeFSM(d).unreachableStates, String(k)).toEqual([]);
      expect(d.start).toBe(setName(epsilonClosure(n, [n.start])));
      for (const w of allWords(["a", "b"], 6)) expect(acceptsFSM(d, w), `${k} ${w}`).toBe(acceptsFSM(n, w));
      // every set is closed under ε: it is the closure of itself
      for (const s of d.states.filter((x) => x !== "∅")) {
        const members = s.slice(1, -1).split(",");
        expect(setName(epsilonClosure(n, members))).toBe(s);
      }
    }
  });
});

describe("operations that need a DFA offer det, ε-transitions or not", () => {
  const eps = fsm(["S", "A"], "S", ["A"], [
    ["S", EPS, "A"],
    ["A", "0", "A"],
    ["A", "1", "A"]
  ]);

  it("min, complement and the product suggest det(M)", () => {
    expect(minimize(eps).diagnostics[0].fix?.code).toBe("min(det(M))");
    expect(minimize(eps).diagnostics[0].detail?.params?.spots).toBe("S →ε A");
    expect(complement(eps).diagnostics[0].fix?.code).toBe("complement(det(M))");
    const other = { ...eps, name: "N" };
    expect(product(eps, other, "intersect").diagnostics[0].fix?.code).toBe("intersect(det(M), N)");
  });

  it("and the suggested chain works", () => {
    const m = minimize(determinize(eps).value!);
    expect(m.ok).toBe(true);
    for (const w of allWords(["0", "1"], 5)) expect(acceptsFSM(m.value!, w)).toBe(true);
  });
});
