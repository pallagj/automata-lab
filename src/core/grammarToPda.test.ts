import { describe, expect, it } from "vitest";
import { grammarToPDA } from "./grammar/grammar";
import { machineTransitionLabel, runMachine } from "./machine/machine";
import { parseGrammar } from "./parse/definitionParser";
import { allWords, cfgWordsUpTo, randomCFG, rng } from "./testing";

describe("CF grammar → pushdown automaton (lecture notes 7.12)", () => {
  // 7.14: A → a | aA | bAA | AAb | AbA
  const g = parseGrammar(`Grammar:
  name: G
  charset: a, b
  variables: A
  init: A
  rules:
    - A -> a | aA | bAA | AAb | AbA`).value!;

  it("7.14: Z₀ → AZ₁ first, a step per rule, a match per letter, Z₁ → ε last", () => {
    const p = grammarToPDA(g).value!;
    expect(p.storages[0].init).toEqual(["Z_0"]);
    expect(p.acceptMode).toBe("emptyStorages");
    expect(p.transitions.map((t) => machineTransitionLabel(p, t))).toEqual([
      "ε; Z_0 → AZ_1",
      "ε; A → a",
      "ε; A → aA",
      "ε; A → bAA",
      "ε; A → AAb",
      "ε; A → AbA",
      "a; a → ε",
      "b; b → ε",
      "ε; Z_1 → ε"
    ]);
  });

  it("7.15: abbaaa is accepted, through the computation of the notes", () => {
    const p = grammarToPDA(g).value!;
    const r = runMachine(p, "abbaaa");
    expect(r.verdict).toBe("accepted");
    // the stack contents along the way end with Z₁ alone, then empty
    const stacks = r.acceptingPath!.map((x) => (x.config.storages[0] as string[]).join(""));
    expect(stacks[0]).toBe("Z_0");
    expect(stacks[1]).toBe("AZ_1");
    expect(stacks.at(-2)).toBe("Z_1");
    expect(stacks.at(-1)).toBe("");
  });

  it("Z₀ and Z₁ never clash with the grammar's own symbols", () => {
    const clash = parseGrammar(`Grammar:
  charset: a
  variables: S, Z_0, Z_1
  init: S
  rules:
    - S -> Z_0 Z_1
    - Z_0 -> a
    - Z_1 -> a`).value!;
    const p = grammarToPDA(clash).value!;
    expect(p.storages[0].init).toEqual(["Z′_0"]);
    expect(runMachine(p, "aa").verdict).toBe("accepted");
    expect(runMachine(p, "a").verdict).toBe("rejected");
  });

  it("never decides wrong on 100 random grammars: accepted words are the grammar's, rejected ones are not", () => {
    const next = rng(712);
    let limits = 0;
    let total = 0;
    for (let k = 0; k < 100; k++) {
      const r = randomCFG(next);
      const p = grammarToPDA(r).value!;
      const words = cfgWordsUpTo(r, 4);
      for (const w of allWords(["a", "b"], 4)) {
        // words of length ≤ 4 of these small grammars need a short stack: a tight bound keeps the search quick
        const v = runMachine(p, w, 2000, 32).verdict;
        total++;
        // a search that runs out of its budget decides nothing — a left-recursive grammar may do that
        if (v === "limit") limits++;
        else expect(v === "accepted", `${k} ${w}`).toBe(words.has(w));
      }
    }
    // most words are decided; a left-recursive grammar may leave a non-member undecided
    expect(limits / total).toBeLessThan(0.3);
  });
});
