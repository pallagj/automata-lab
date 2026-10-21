import { describe, expect, it } from "vitest";
import { classify, fsmToGrammar, Grammar } from "./grammar/grammar";
import { acceptsFSM, FSM, makeFSM } from "./fsm/fsm";
import { allWords, cfgWordsUpTo, randomNFA, rng, sorted } from "./testing";
import { EPS } from "./types";

const fsm = (states: string[], start: string, accept: string[], t: [string, string, string][], alphabet = ["a", "b"]) =>
  makeFSM({ name: "M", alphabet, states, start, accept, transitions: t.map(([from, symbol, to]) => ({ from, symbol, to })) });

/** The rules per left-hand side, as the notes write them: A → aB | a. */
const rulesText = (g: Grammar) => {
  const by = new Map<string, string[]>();
  for (const r of g.rules) {
    const left = r.left.join("");
    if (!by.has(left)) by.set(left, []);
    by.get(left)!.push(r.right.join("") || "ε");
  }
  return [...by].map(([l, rs]) => `${l} → ${rs.join(" | ")}`);
};

const automatonWords = (f: FSM, n: number) => sorted(allWords(f.alphabet, n).filter((w) => acceptsFSM(f, w)));

describe("finite automaton → regular grammar (lecture notes 4.19, 4.20)", () => {
  it("2.5: the words ending in 0 — A_q → aA_p for every transition, A_q → a into an accepting state", () => {
    const f = fsm(["A", "B"], "A", ["B"], [
      ["A", "0", "B"],
      ["A", "1", "A"],
      ["B", "0", "B"],
      ["B", "1", "A"]
    ], ["0", "1"]);
    const r = fsmToGrammar(f);
    const g = r.value!;
    expect(rulesText(g)).toEqual(["A → 0B | 0 | 1A", "B → 0B | 0 | 1A"]);
    expect(g.start).toBe("A");
    expect(classify(g).type).toBe(3);
    // the start state does not accept: no 4.19, no S → ε
    expect(r.steps.map((s) => s.title.key)).toEqual(["grammar.fsmToGrammar.step.title", "grammar.fsmToGrammar.rules.title"]);
  });

  it("an accepting start state with transitions into it gets a copy first (4.19), so S → ε stays allowed", () => {
    // the words with an even number of a's
    const f = fsm(["E", "O"], "E", ["E"], [
      ["E", "a", "O"],
      ["O", "a", "E"],
      ["E", "b", "E"],
      ["O", "b", "O"]
    ]);
    const r = fsmToGrammar(f);
    const g = r.value!;
    expect(rulesText(g)).toEqual(["E → aO | bE′ | b | ε", "O → aE′ | a | bO", "E′ → aO | bE′ | b"]);
    expect(g.nonterminals).toEqual(["E", "O", "E′"]);
    expect(classify(g).type).toBe(3);
    expect(g.rules.some((x) => x.right.includes("E"))).toBe(false);
    expect(r.steps[0].title.key).toBe("grammar.fsmToGrammar.newStart.title");
    expect(r.steps[0].table!.rows).toEqual([
      ["δ(O, a) = E", "δ(O, a) = E′"],
      ["δ(E, b) = E", "δ(E, b) = E′"],
      ["", "δ(E′, a) = O"],
      ["", "δ(E′, b) = E′"]
    ]);
    expect(sorted(cfgWordsUpTo(g, 6))).toEqual(automatonWords(f, 6));
  });

  it("a loop on the start state goes to the copy too: no transition leads back into it", () => {
    const f = fsm(["q_0"], "q_0", ["q_0"], [["q_0", "a", "q_0"]], ["a"]);
    const g = fsmToGrammar(f).value!;
    expect(rulesText(g)).toEqual(["q_0 → aq′_0 | a | ε", "q′_0 → aq′_0 | a"]);
    expect(classify(g).type).toBe(3);
  });

  it("an accepting start state no transition leads into needs no copy: S → ε right away", () => {
    const f = fsm(["S", "A"], "S", ["S", "A"], [
      ["S", "a", "A"],
      ["A", "a", "A"]
    ]);
    const r = fsmToGrammar(f);
    expect(rulesText(r.value!)).toEqual(["S → aA | a | ε", "A → aA | a"]);
    expect(r.steps.some((s) => s.title.key === "grammar.fsmToGrammar.newStart.title")).toBe(false);
  });

  it("no accepting state: no rule ends a derivation, the language is empty", () => {
    const g = fsmToGrammar(fsm(["S"], "S", [], [["S", "a", "S"]])).value!;
    expect(rulesText(g)).toEqual(["S → aS"]);
    expect(cfgWordsUpTo(g, 6).size).toBe(0);
  });

  it("an ε-transition has no such rule: it asks for ε-removal first", () => {
    const r = fsmToGrammar(fsm(["S", "A"], "S", ["A"], [["S", EPS, "A"]]));
    expect(r.ok).toBe(false);
    expect(r.diagnostics[0].title.key).toBe("grammar.fsmToGrammar.needsEpsilonFree.title");
    expect(r.diagnostics[0].fix?.code).toBe("toGrammar(epsfree(M))");
  });

  it("gives a type-3 grammar of the same language for 400 random automata", () => {
    const next = rng(2020);
    let copies = 0;
    for (let k = 0; k < 400; k++) {
      const f = randomNFA(next, { states: 1 + Math.floor(next() * 5), alphabet: ["a", "b"], epsDensity: 0, acceptRate: 0.45 });
      const r = fsmToGrammar(f);
      const g = r.value!;
      expect(classify(g).type, String(k)).toBe(3);
      expect(sorted(cfgWordsUpTo(g, 6)), String(k)).toEqual(automatonWords(f, 6));
      if (r.steps.some((s) => s.title.key === "grammar.fsmToGrammar.newStart.title")) copies++;
    }
    expect(copies).toBeGreaterThan(20);
  });
});
