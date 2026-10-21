import { describe, expect, it } from "vitest";
import { acceptsFSM, makeFSM } from "./fsm/fsm";
import { checkEquivalence, minimize, determinize } from "./fsm/ops";
import { allWords, randomNFA, rng } from "./testing";
import { EPS } from "./types";

describe("equivalence (lecture notes 5.3)", () => {
  const ends01 = makeFSM({
    name: "N",
    alphabet: ["0", "1"],
    states: ["A", "B", "C"],
    start: "A",
    accept: ["C"],
    transitions: [
      { from: "A", symbol: "0", to: "A" },
      { from: "A", symbol: "1", to: "A" },
      { from: "A", symbol: "0", to: "B" },
      { from: "B", symbol: "1", to: "C" }
    ]
  });

  it("an NFA and its minimal DFA: determinized first, then every product pair agrees", () => {
    const m = minimize(determinize(ends01).value!).value!;
    const r = checkEquivalence(ends01, { ...m, name: "M" });
    expect(r.value!.equal).toBe(true);
    expect(r.steps.map((s) => s.title.key)).toEqual(["ops.equal.det.title", "ops.equal.search.title", "ops.equal.proof.title"]);
    const table = r.steps[1].table!;
    expect(table.rows[0]).toEqual(["({A}, {A})", EPS, "✗", "✗"]);
    // every pair agrees
    for (const row of table.rows) expect(row[2]).toBe(row[3]);
  });

  it("a counterexample: the search table ends at the pair where exactly one accepts", () => {
    const other = { ...ends01, name: "K", accept: ["B"] };
    const r = checkEquivalence(ends01, other);
    expect(r.value!.counterexample!.word).toBe("0");
    const last = r.steps.find((s) => s.title.key === "ops.equal.search.title")!.table!.rows.at(-1)!;
    expect(last[1]).toBe("0");
    expect(last[2]).not.toBe(last[3]);
  });

  it("different alphabets: the missing letters lead into a trap", () => {
    const onlyA = makeFSM({ name: "P", alphabet: ["a"], states: ["s"], start: "s", accept: ["s"], transitions: [{ from: "s", symbol: "a", to: "s" }] });
    const ab = makeFSM({
      name: "Q",
      alphabet: ["a", "b"],
      states: ["s", "t"],
      start: "s",
      accept: ["s"],
      transitions: [
        { from: "s", symbol: "a", to: "s" },
        { from: "s", symbol: "b", to: "t" },
        { from: "t", symbol: "a", to: "t" },
        { from: "t", symbol: "b", to: "t" }
      ]
    });
    const r = checkEquivalence(onlyA, ab);
    expect(r.value!.equal).toBe(true);
    expect(r.steps[0].title.key).toBe("ops.equal.extend.title");
  });

  it("agrees with brute force on 400 random pairs, and a counterexample is a shortest one", () => {
    const next = rng(53);
    for (let k = 0; k < 400; k++) {
      const a = randomNFA(next, { states: 1 + Math.floor(next() * 4), alphabet: ["a", "b"] });
      const b = randomNFA(next, { states: 1 + Math.floor(next() * 4), alphabet: ["a", "b"] });
      const differ = allWords(["a", "b"], 8).filter((w) => acceptsFSM(a, w) !== acceptsFSM(b, w));
      const r = checkEquivalence(a, { ...b, name: "S" }).value!;
      expect(r.equal, String(k)).toBe(differ.length === 0);
      if (!r.equal) {
        const w = r.counterexample!.word === EPS ? "" : r.counterexample!.word;
        expect(w.length).toBe(differ[0].length);
        expect(acceptsFSM(a, w)).not.toBe(acceptsFSM(b, w));
      }
    }
  });
});
