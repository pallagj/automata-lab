import { describe, expect, it } from "vitest";
import { acceptsFSM, analyzeFSM, makeFSM } from "./fsm/fsm";
import { product } from "./fsm/ops";
import { allWords } from "./testing";

// complete DFAs over different alphabets: M over {a, b} (even number of a's), N over {b, c} (ends in c)
const M = makeFSM({
  name: "M",
  alphabet: ["a", "b"],
  states: ["E", "O"],
  start: "E",
  accept: ["E"],
  transitions: [
    { from: "E", symbol: "a", to: "O" },
    { from: "O", symbol: "a", to: "E" },
    { from: "E", symbol: "b", to: "E" },
    { from: "O", symbol: "b", to: "O" }
  ]
});
const N = makeFSM({
  name: "N",
  alphabet: ["b", "c"],
  states: ["X", "Y"],
  start: "X",
  accept: ["Y"],
  transitions: [
    { from: "X", symbol: "b", to: "X" },
    { from: "Y", symbol: "b", to: "X" },
    { from: "X", symbol: "c", to: "Y" },
    { from: "Y", symbol: "c", to: "Y" }
  ]
});

/** L(M) over {a, b, c}: a word with a c is not in it. */
const inM = (w: string) => !w.includes("c") && [...w].filter((x) => x === "a").length % 2 === 0;
const inN = (w: string) => !w.includes("a") && w.endsWith("c");

describe("the product over different alphabets (lecture notes 3.4)", () => {
  for (const [mode, expected] of [
    ["union", (w: string) => inM(w) || inN(w)],
    ["intersect", (w: string) => inM(w) && inN(w)],
    ["difference", (w: string) => inM(w) && !inN(w)]
  ] as const) {
    it(`${mode}: both are completed over Σ = {a, b, c} first, and the language is right`, () => {
      const r = product(M, N, mode);
      expect(r.ok).toBe(true);
      const p = r.value!;
      expect(p.alphabet.sort()).toEqual(["a", "b", "c"]);
      expect(analyzeFSM(p).isCompleteDFA).toBe(true);
      for (const w of allWords(["a", "b", "c"], 6)) expect(acceptsFSM(p, w), w).toBe(expected(w));
      // one step per extended automaton, then the product
      expect(r.steps.map((s) => s.title.key)).toEqual(["ops.product.extend.title", "ops.product.extend.title", "ops.product.step.title"]);
      expect(r.steps[0].detail!.params).toMatchObject({ name: "M", missing: "c", trap: "T" });
      expect(r.steps[1].detail!.params).toMatchObject({ name: "N", missing: "a", trap: "T" });
    });
  }

  it("the same alphabet: no extension step", () => {
    const r = product(M, { ...M, name: "M2" }, "intersect");
    expect(r.steps.map((s) => s.title.key)).toEqual(["ops.product.step.title"]);
  });
});
