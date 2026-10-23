import { describe, expect, it } from "vitest";
import { acceptsFSM, FSM, makeFSM, reachableStates, transMap } from "./fsm/fsm";
import { determinize, minimize } from "./fsm/ops";
import { allWords, randomNFA, rng } from "./testing";

/** 2.30: the DFA of the words ending in 01 that remembers the last two letters. */
function lastTwo(): FSM {
  const states = ["S", "0", "1", "00", "01", "10", "11"];
  const transitions = states.flatMap((s) =>
    ["0", "1"].map((c) => ({ from: s, symbol: c, to: ((s === "S" ? "" : s) + c).slice(-2) }))
  );
  return makeFSM({ name: "M", alphabet: ["0", "1"], states, start: "S", accept: ["01"], transitions });
}

/**
 * The minimal DFA's size by the other method of the notes, the table of 2.4.2: a pair is
 * marked when one accepts and the other not, then when a letter leads to a marked pair.
 */
function classCount(f: FSM): number {
  const tm = transMap(f);
  const states = [...reachableStates(f)];
  const d = (s: string, c: string) => [...tm.get(s)!.get(c)!][0];
  const key = (p: string, q: string) => (p < q ? `${p}|${q}` : `${q}|${p}`);
  const marked = new Set<string>();
  for (const p of states) for (const q of states) if (f.accept.includes(p) !== f.accept.includes(q)) marked.add(key(p, q));
  for (let changed = true; changed; ) {
    changed = false;
    for (const p of states)
      for (const q of states)
        if (p !== q && !marked.has(key(p, q)) && f.alphabet.some((c) => marked.has(key(d(p, c), d(q, c))))) {
          marked.add(key(p, q));
          changed = true;
        }
  }
  // one class per state not equivalent to an earlier one
  return states.filter((p, i) => states.slice(0, i).every((q) => marked.has(key(p, q)))).length;
}

describe("minimization (lecture notes 2.4.1, 2.29)", () => {
  it("2.30: the groups of the notes, round by round", () => {
    const r = minimize(lastTwo());
    const [initial, round1, round2, build] = r.steps;
    expect(initial.title.key).toBe("ops.min.step1.title");
    // A₁ = Q − F, A₂ = F
    expect(initial.detail!.params!.partition).toBe("A_1 = {S, 0, 1, 00, 10, 11}, A_2 = {01}");
    expect(round1.title).toEqual({ key: "ops.min.refine.title", params: { round: 1 } });
    // 1 takes S, 1, 11 into A₁ but 0, 00, 10 into A₂: A₁ splits, the second part is A₃
    expect(round1.detail!.params!.splits).toBe("A_1 ⇒ {S, 1, 11}: 0 → A_1, 1 → A_1; {0, 00, 10}: 0 → A_1, 1 → A_2");
    expect(round1.detail!.params!.partition).toBe("A_1 = {S, 1, 11}, A_2 = {01}, A_3 = {0, 00, 10}");
    expect(round1.table!.rows[0]).toEqual(["A_1", "S", "0 ∈ A_1", "1 ∈ A_1"]);
    expect(round2.title).toEqual({ key: "ops.min.fixpoint.title", params: { round: 2 } });
    expect(build.title.key).toBe("ops.min.build.title");
    expect(build.table!.rows).toEqual([
      ["{1,11,S}", "{S, 1, 11}", "{0,00,10}", "{1,11,S}"],
      ["01", "{01}", "{0,00,10}", "{1,11,S}"],
      ["{0,00,10}", "{0, 00, 10}", "{0,00,10}", "01"]
    ]);
    const m = r.value!;
    expect(m.states).toHaveLength(3);
    expect(m.start).toBe("{1,11,S}");
    expect(m.accept).toEqual(["01"]);
    for (const w of allWords(["0", "1"], 7)) expect(acceptsFSM(m, w), w).toBe(w.endsWith("01"));
  });

  it("an automaton with nothing to merge: one round, already minimal", () => {
    const r = minimize(minimize(lastTwo()).value!);
    expect(r.steps.map((s) => s.title.key)).toEqual(["ops.min.step1.title", "ops.min.refine.title", "ops.min.fixpoint.title", "ops.min.build.title"]);
    expect(r.diagnostics.some((d) => d.title.key === "ops.min.alreadyMinimal.title")).toBe(true);
  });

  it("no accepting state, or only accepting ones: a single group from the start", () => {
    const none = { ...lastTwo(), accept: [] };
    const r = minimize(none);
    expect(r.steps[0].detail!.params!.partition).toBe("A_1 = {S, 0, 1, 00, 01, 10, 11}");
    expect(r.value!.states).toHaveLength(1);
  });

  it("matches the number of distinguishable classes and keeps the language for 400 random DFAs", () => {
    const next = rng(2304);
    for (let k = 0; k < 400; k++) {
      const n = randomNFA(next, { states: 1 + Math.floor(next() * 5), alphabet: ["a", "b"] });
      const d = determinize(n).value!;
      const m = minimize(d).value!;
      expect(m.states.length, String(k)).toBe(classCount(d));
      for (const w of allWords(["a", "b"], 6)) expect(acceptsFSM(m, w), `${k} ${w}`).toBe(acceptsFSM(n, w));
      // the rounds end in a fixpoint, then the build step
      const keys = minimize(d).steps.map((s) => s.title.key);
      expect(keys.at(-1)).toBe("ops.min.build.title");
      expect(keys.at(-2)).toBe("ops.min.fixpoint.title");
    }
  });
});
