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

  it("accepts exactly the grammar's words for 150 random grammars", () => {
    const next = rng(712);
    for (let k = 0; k < 150; k++) {
      const r = randomCFG(next);
      const p = grammarToPDA(r).value!;
      const words = cfgWordsUpTo(r, 5);
      for (const w of allWords(["a", "b"], 5)) {
        const v = runMachine(p, w).verdict;
        // a left-recursive grammar can grow the stack without bound: then the search may stop at its limit
        if (v !== "limit") expect(v === "accepted", `${k} ${w}`).toBe(words.has(w));
        else expect(words.has(w), `${k} ${w}`).toBe(false);
      }
    }
  });
});
