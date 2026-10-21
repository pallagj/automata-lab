import { describe, expect, it } from "vitest";
import { EPS } from "../types";
import { Grammar, grammarToPDA } from "../grammar/grammar";
import { removeUselessSymbols } from "../grammar/normalForm";
import { evaluateExpression, ExprValue } from "../expr/expression";
import { parseDefinition, parseGrammar, parseMachine } from "../parse/definitionParser";
import { serializeDefinition } from "../parse/serialize";
import { allWords, cfgWordsUpTo, rng, sorted } from "../testing";
import {
  initialMachineConfig,
  isAcceptingMachineConfig,
  Machine,
  machineConfigKey,
  machineMoves,
  machineTransitionLabel,
  runMachine
} from "./machine";
import { MAX_PDA_GRAMMAR_RULES, pdaDecider, pdaToGrammar, toEmptyStack, toFinalState } from "./pda";

/**
 * Whether the machine accepts the word: a breadth-first search over its configurations,
 * the stack cut at `bound` symbols — independent of the grammar constructions.
 */
function searchAccepts(m: Machine, w: string, bound = 12): boolean {
  const start = initialMachineConfig(m, w);
  const seen = new Set([machineConfigKey(start)]);
  const queue = [start];
  for (let i = 0; i < queue.length; i++) {
    if (isAcceptingMachineConfig(m, queue[i], w)) return true;
    for (const { config } of machineMoves(m, queue[i], w)) {
      if ((config.storages[0] as string[]).length > bound) continue;
      const key = machineConfigKey(config);
      if (!seen.has(key)) {
        seen.add(key);
        queue.push(config);
      }
    }
  }
  return false;
}

const acceptedUpTo = (m: Machine, length: number) => sorted(allWords(m.alphabet, length).filter((w) => searchAccepts(m, w)));
const generatedUpTo = (m: Machine, length: number) => sorted(cfgWordsUpTo(pdaToGrammar(m).value!, length));

/** A random pushdown automaton over a, b with stack symbols Z, A — either way of accepting, any start content. */
function randomPDA(random: () => number): Machine {
  const states = Array.from({ length: 1 + Math.floor(random() * 3) }, (_, i) => `q_${i}`);
  const gamma = ["Z", "A"];
  const pick = <T,>(xs: T[]) => xs[Math.floor(random() * xs.length)];
  const transitions: Machine["transitions"] = [];
  for (const from of states)
    for (const input of ["a", "b", EPS])
      for (const pop of [...gamma, EPS]) {
        const p = input === EPS && pop === EPS ? 0.08 : input === EPS || pop === EPS ? 0.15 : 0.3;
        if (random() >= p) continue;
        const push = Array.from({ length: Math.floor(random() * (pop === EPS ? 2 : 3)) }, () => pick(gamma));
        transitions.push({ from, input, to: pick(states), ops: [{ type: "stack", pop, push }] });
      }
  const r = random();
  return {
    kind: "machine",
    name: "P",
    alphabet: ["a", "b"],
    states,
    start: states[0],
    accept: states.filter(() => random() < 0.4),
    acceptMode: random() < 0.5 ? "finalState" : "emptyStorages",
    input: "head",
    storages: [{ id: "stack", type: "stack", alphabet: [...gamma], init: r < 0.8 ? ["Z"] : r < 0.9 ? [] : ["A", "Z"] }],
    transitions
  };
}

// 7.5: L = {0ⁿ1ⁿ : n ≥ 0}, accepted by final state
const M75 = parseMachine(`Machine:
  name: M
  charset: 0, 1
  states: q_0, q_1, q_2, q_3
  init: q_0
  accept: q_0, q_3
  storages:
    stack: stack
  transitions:
    - (q_0, 0, Z) -> (q_1, 0Z)
    - (q_1, 0, ε) -> (q_1, 0)
    - (q_1, 1, 0) -> (q_2, ε)
    - (q_2, 1, 0) -> (q_2, ε)
    - (q_2, ε, Z) -> (q_3, Z)`).value!;

const zeroOne = (length: number) =>
  sorted(allWords(["0", "1"], length).filter((w) => /^0*1*$/.test(w) && w.split("0").length - 1 === w.split("1").length - 1));

describe("acceptance by final state ↔ by empty stack (lecture notes 7.9)", () => {
  it("7.10: the machine of 7.5 accepting by empty stack, as the figure draws it", () => {
    const r = toEmptyStack(M75);
    const p = r.value!;
    expect(p.acceptMode).toBe("emptyStorages");
    expect(p.states).toEqual(["q′_0", "q_0", "q_1", "q_2", "q_3", "q_ε"]);
    expect(p.start).toBe("q′_0");
    expect(p.storages[0].init).toEqual(["Z"]);
    expect(p.storages[0].alphabet).toEqual(["Z", "0", "Z′"]);
    expect(p.transitions.map((t) => `${t.from} → ${t.to}: ${machineTransitionLabel(p, t)}`)).toEqual([
      "q′_0 → q_0: ε; Z → ZZ′",
      "q_0 → q_1: 0; Z → 0Z",
      "q_1 → q_1: 0; ε → 0",
      "q_1 → q_2: 1; 0 → ε",
      "q_2 → q_2: 1; 0 → ε",
      "q_2 → q_3: ε; Z → Z",
      // from the accepting q_0 and q_3, with any symbol on top, into q_ε
      "q_0 → q_ε: ε; Z → ε",
      "q_0 → q_ε: ε; 0 → ε",
      "q_0 → q_ε: ε; Z′ → ε",
      "q_3 → q_ε: ε; Z → ε",
      "q_3 → q_ε: ε; 0 → ε",
      "q_3 → q_ε: ε; Z′ → ε",
      // q_ε empties the stack
      "q_ε → q_ε: ε; Z → ε",
      "q_ε → q_ε: ε; 0 → ε",
      "q_ε → q_ε: ε; Z′ → ε"
    ]);
    expect(r.steps[0].title.key).toBe("pda.toEmptyStack.step.title");
    expect(acceptedUpTo(p, 8)).toEqual(zeroOne(8));
  });

  it("back to a final state: q_F is the only accepting state, entered when only the bottom symbol is left", () => {
    const p = toFinalState(toEmptyStack(M75).value!).value!;
    expect(p.acceptMode).toBe("finalState");
    expect(p.accept).toEqual(["q_F"]);
    expect(p.start).toBe("q′′_0");
    expect(p.storages[0].init).toEqual(["Z"]);
    // the new bottom symbol is the next free Z: Z and Z′ are taken
    expect(p.storages[0].alphabet).toEqual(["Z", "0", "Z′", "Z′′"]);
    expect(machineTransitionLabel(p, p.transitions[0])).toBe("ε; Z → ZZ′′");
    const intoF = p.transitions.filter((t) => t.to === "q_F");
    expect(intoF.map((t) => t.from)).toEqual(["q′_0", "q_0", "q_1", "q_2", "q_3", "q_ε"]);
    expect(intoF.every((t) => machineTransitionLabel(p, t) === "ε; Z′′ → Z′′")).toBe(true);
    expect(acceptedUpTo(p, 8)).toEqual(zeroOne(8));
  });

  it("a machine that already accepts that way is left as it is", () => {
    const r = toFinalState(M75);
    expect(r.value).toBe(M75);
    expect(r.diagnostics[0].title.key).toBe("pda.toFinalState.already.title");
    const p = toEmptyStack(M75).value!;
    expect(toEmptyStack(p).value).toBe(p);
  });

  it("a stack that starts with several symbols, or with none, starts with the new bottom symbol alone", () => {
    for (const init of [[], ["A", "Z"]]) {
      const m: Machine = { ...M75, storages: [{ ...M75.storages[0], alphabet: ["Z", "0", "A"], init }] };
      const p = toEmptyStack(m).value!;
      expect(p.storages[0].init).toEqual(["Z′"]);
      expect(machineTransitionLabel(p, p.transitions[0])).toBe(`ε; Z′ → ${[...init, "Z′"].join("")}`);
      const q = toFinalState(m.acceptMode === "finalState" ? p : m).value!;
      for (const w of allWords(["0", "1"], 6)) {
        expect(searchAccepts(p, w)).toBe(searchAccepts(m, w));
        expect(searchAccepts(q, w)).toBe(searchAccepts(m, w));
      }
    }
  });

  it("random pushdown automata accept the same words both ways", () => {
    const random = rng(79);
    for (let i = 0; i < 120; i++) {
      const m = randomPDA(random);
      const other = m.acceptMode === "finalState" ? toEmptyStack(m).value! : toFinalState(m).value!;
      const back = m.acceptMode === "finalState" ? toFinalState(other).value! : toEmptyStack(other).value!;
      expect(other.acceptMode).not.toBe(m.acceptMode);
      for (const w of allWords(["a", "b"], 4)) {
        const expected = searchAccepts(m, w);
        expect(searchAccepts(other, w), `${JSON.stringify(m.transitions)} ${w}`).toBe(expected);
        expect(searchAccepts(back, w)).toBe(expected);
      }
    }
  });

  it("only a pushdown automaton", () => {
    const tm = parseMachine(`Machine:
  charset: a
  states: s
  init: s
  accept: s
  input: tape
  storages:
    tape: tape
  transitions:
    - (s, a) -> (s, a, R)`).value!;
    for (const r of [toEmptyStack(tm), toFinalState(tm), pdaToGrammar(tm)]) {
      expect(r.ok).toBe(false);
      expect(r.diagnostics[0].title.key).toBe("pda.needsPda.title");
    }
  });
});

describe("pushdown automaton → context-free grammar (lecture notes 7.16)", () => {
  it("7.5: the grammar generates 0ⁿ1ⁿ — 6²·3 + 1 variables, S → [q′₀Zq] for each state", () => {
    const r = pdaToGrammar(M75);
    const g = r.value!;
    expect(g.start).toBe("S");
    expect(g.nonterminals.length).toBe(6 * 6 * 3 + 1);
    expect(g.nonterminals.slice(0, 4)).toEqual(["S", "[q′_0Zq′_0]", "[q′_0Zq_0]", "[q′_0Zq_1]"]);
    expect(g.rules.slice(0, 6).map((x) => `${x.left[0]} → ${x.right.join("")}`)).toEqual([
      "S → [q′_0Zq′_0]",
      "S → [q′_0Zq_0]",
      "S → [q′_0Zq_1]",
      "S → [q′_0Zq_2]",
      "S → [q′_0Zq_3]",
      "S → [q′_0Zq_ε]"
    ]);
    expect(r.steps.map((s) => s.title.key)).toEqual([
      "pda.toEmptyStack.step.title",
      "pda.toGrammar.replace.title",
      "pda.toGrammar.variables.title",
      "pda.toGrammar.rules.title"
    ]);
    expect(sorted(cfgWordsUpTo(g, 8))).toEqual(zeroOne(8));
    // the notes' grammar is right but large: the useless symbols are pointed out
    expect(r.diagnostics[0].title.key).toBe("pda.toGrammar.useless.title");
    expect(r.diagnostics[0].fix!.code).toBe("trim(toGrammar(M))");
    expect(sorted(cfgWordsUpTo(removeUselessSymbols(g).value!, 8))).toEqual(zeroOne(8));
  });

  it("step 1: (q₁, 0, ε) → (q₁, 0) takes every symbol and puts it back", () => {
    const step = pdaToGrammar(M75).steps[1];
    expect(step.table!.rows).toEqual([
      ["(q_1, 0, ε) → (q_1, 0)", "(q_1, 0, Z) → (q_1, 0Z), (q_1, 0, 0) → (q_1, 00), (q_1, 0, Z′) → (q_1, 0Z′)"]
    ]);
  });

  it("the rules of one transition: [qAq′] → a for a pop, |Q|^k rules for k symbols written", () => {
    const g = pdaToGrammar(M75).value!;
    const of = (left: string) => g.rules.filter((x) => x.left[0] === left).map((x) => x.right.join(""));
    // (q₁, 1, 0) → (q₂, ε) — besides the rules of (q₁, 0, 0) → (q₁, 00), which step 1 made
    expect(of("[q_10q_2]")).toEqual([
      ...["q′_0", "q_0", "q_1", "q_2", "q_3", "q_ε"].map((q) => `0[q_10${q}][${q}0q_2]`),
      "1"
    ]);
    // (q₂, ε, Z) → (q₃, Z): [q₂Zq″] → [q₃Zq″]
    expect(of("[q_2Zq_ε]")).toEqual(["[q_3Zq_ε]"]);
    // (q₀, 0, Z) → (q₁, 0Z): [q₀Zq″] → 0[q₁0q₂][q₂Zq″] for all q₂ — six rules for q″ = q_ε
    expect(of("[q_0Zq_ε]")).toEqual([
      ...["q′_0", "q_0", "q_1", "q_2", "q_3", "q_ε"].map((q) => `0[q_10${q}][${q}Zq_ε]`),
      "" // q₀ accepts: (q₀, ε, Z) → (q_ε, ε)
    ]);
  });

  it("7.14–7.15: the grammar of toPda(G) generates L(G), abbaaa included, with no step to replace", () => {
    const g = parseGrammar(`Grammar:
  name: G
  charset: a, b
  variables: A
  init: A
  rules:
    - A -> a | aA | bAA | AAb | AbA`).value!;
    const p = grammarToPDA(g).value!;
    const r = pdaToGrammar(p);
    const h = r.value!;
    expect(r.steps[0].detail!.key).toBe("pda.toGrammar.replace.detailNone");
    // one state q: [qXq] for every stack symbol X, and S → [qZ₀q]
    expect(h.nonterminals).toEqual(["S", "[qAq]", "[qaq]", "[qbq]", "[qZ_0q]", "[qZ_1q]"]);
    expect(h.rules.map((x) => `${x.left[0]} → ${x.right.join("")}`)).toEqual([
      "S → [qZ_0q]",
      "[qZ_0q] → [qAq][qZ_1q]",
      "[qAq] → [qaq]",
      "[qAq] → [qaq][qAq]",
      "[qAq] → [qbq][qAq][qAq]",
      "[qAq] → [qAq][qAq][qbq]",
      "[qAq] → [qAq][qbq][qAq]",
      "[qaq] → a",
      "[qbq] → b",
      "[qZ_1q] → "
    ]);
    expect(sorted(cfgWordsUpTo(h, 7))).toEqual(sorted(cfgWordsUpTo(g, 7)));
    expect(cfgWordsUpTo(h, 6).has("abbaaa")).toBe(true);
  });

  it("a stack that empties before the end, where a step takes nothing from it: a bottom symbol first", () => {
    // by empty stack: b and c are brackets on the stack (b puts X on, taking nothing), and the
    // one a takes Z out — so after a the stack is empty, yet b still moves: abc, bca, abcbc, …
    const m = parseMachine(`Machine:
  name: P
  charset: a, b, c
  states: q
  init: q
  acceptMode: emptyStorages
  storages:
    stack: stack
  transitions:
    - (q, a, Z) -> (q, ε)
    - (q, b, ε) -> (q, X)
    - (q, c, X) -> (q, ε)`).value!;
    const r = pdaToGrammar(m);
    expect(r.steps[0].title.key).toBe("pda.toGrammar.bottom.title");
    expect(r.steps[0].detail!.key).toBe("pda.toGrammar.bottom.detailEmptied");
    expect(r.steps[0].detail!.params!.state).toBe("q");
    const balancedAroundA = (w: string) => {
      let depth = 0;
      for (const c of w) {
        if (c === "a" && depth !== 0) return false;
        depth += c === "b" ? 1 : c === "c" ? -1 : 0;
        if (depth < 0) return false;
      }
      return depth === 0 && w.split("a").length === 2;
    };
    const expected = sorted(allWords(["a", "b", "c"], 7).filter(balancedAroundA));
    expect(expected.slice(0, 4)).toEqual(["a", "abc", "bca", "abbcc"]);
    expect(acceptedUpTo(m, 7)).toEqual(expected);
    expect(generatedUpTo(m, 7)).toEqual(expected);
  });

  it("a step that takes nothing, but never with an empty stack: the notes' construction as it is", () => {
    // 7.5 by empty stack: (q₁, 0, ε) moves only while 0s or Z are on the stack
    const m: Machine = { ...M75, acceptMode: "emptyStorages", accept: [] };
    const withPop: Machine = {
      ...m,
      transitions: [...m.transitions, { from: "q_3", input: EPS, to: "q_3", ops: [{ type: "stack", pop: "Z", push: [] }] }]
    };
    const r = pdaToGrammar(withPop);
    expect(r.steps[0].title.key).toBe("pda.toGrammar.replace.title");
    expect(r.value!.nonterminals.length).toBe(4 * 4 * 2 + 1);
    expect(generatedUpTo(withPop, 8)).toEqual(acceptedUpTo(withPop, 8));
    expect(generatedUpTo(withPop, 8)).toEqual(zeroOne(8).filter((w) => w !== ""));
  });

  it("a stack that starts with several symbols or with none", () => {
    const base = parseMachine(`Machine:
  name: P
  charset: a, b
  states: q
  init: q
  acceptMode: emptyStorages
  storages:
    stack:
      type: stack
      charset: A, B
      init: AB
  transitions:
    - (q, a, A) -> (q, ε)
    - (q, b, B) -> (q, ε)
    - (q, a, ε) -> (q, A)`).value!;
    for (const init of [["A", "B"], []]) {
      const m: Machine = { ...base, storages: [{ ...base.storages[0], init }] };
      const r = pdaToGrammar(m);
      expect(r.steps[0].detail!.key).toBe("pda.toGrammar.bottom.detailInit");
      expect(generatedUpTo(m, 6)).toEqual(acceptedUpTo(m, 6));
    }
    // AB: a takes A, b takes B — and a with nothing taken puts an A on, for another a to take
    expect(generatedUpTo(base, 4)).toEqual(["ab", "aaab", "abaa"]);
  });

  it("random pushdown automata: the grammar generates exactly the accepted words", () => {
    const random = rng(716);
    for (let i = 0; i < 150; i++) {
      const m = randomPDA(random);
      expect(generatedUpTo(m, 4), JSON.stringify(m)).toEqual(acceptedUpTo(m, 4));
    }
  });

  it("too many rules: the grammar is not built", () => {
    const states = Array.from({ length: 8 }, (_, i) => `q_${i}`);
    const m: Machine = {
      ...M75,
      states,
      start: "q_0",
      accept: [],
      acceptMode: "emptyStorages",
      transitions: [{ from: "q_0", input: "0", to: "q_1", ops: [{ type: "stack", pop: "Z", push: ["Z", "Z", "Z", "Z"] }] }]
    };
    const r = pdaToGrammar(m);
    expect(r.ok).toBe(false);
    expect(r.diagnostics[0].title).toEqual({ key: "pda.toGrammar.tooLarge.title", params: { count: 8 + 8 ** 4 } });
    expect(8 + 8 ** 4).toBeGreaterThan(MAX_PDA_GRAMMAR_RULES);
  });

  it("states that cannot stand inside [qAp] are named", () => {
    const m: Machine = { ...M75, states: ["a b", ...M75.states.slice(1)], start: "a b" };
    const r = pdaToGrammar(m);
    expect(r.ok).toBe(false);
    expect(r.diagnostics[0].title.key).toBe("pda.toGrammar.badLabel.title");
    expect(r.diagnostics[0].detail!.params!.labels).toBe("a b");
  });

  it("two triples written the same are caught", () => {
    // q·Z·Zq and qZ·Z·q are both qZZq
    const m = parseMachine(`Machine:
  charset: a
  states: q, qZ, Zq
  init: q
  acceptMode: emptyStorages
  storages:
    stack: stack
  transitions:
    - (q, a, Z) -> (qZ, ε)`).value!;
    const r = pdaToGrammar(m);
    expect(r.ok).toBe(false);
    expect(r.diagnostics[0].title).toEqual({ key: "pda.toGrammar.ambiguousNames.title", params: { name: "[qZZq]" } });
  });

  it("the grammar can be expanded into a definition and read back", () => {
    const g = pdaToGrammar(M75).value!;
    const text = serializeDefinition(g);
    expect(text).toContain(`    - '[q_0Zq_0] -> `);
    const back = parseDefinition(text)!.value! as Grammar;
    const rules = (h: Grammar) => h.rules.map((x) => `${x.left.join("")} → ${x.right.join(" ")}`).sort();
    expect(back.nonterminals).toEqual(g.nonterminals);
    expect(back.start).toBe(g.start);
    expect(rules(back)).toEqual(rules(g));
  });
});

describe("exact membership of a pushdown automaton (7.16 and CYK)", () => {
  it("decides what the bounded search cannot: the pushdown automaton of a left-recursive grammar", () => {
    const g = parseGrammar(`Grammar:
  name: G
  charset: a, b
  variables: S
  init: S
  rules:
    - S -> SS | aSb | ε`).value!;
    const p = grammarToPDA(g).value!;
    const decide = pdaDecider(p)!;
    const inL = cfgWordsUpTo(g, 8);
    for (const w of allWords(["a", "b"], 8)) expect(decide(w), w).toBe(inL.has(w));
    // the search drowns in the ever longer stacks of S → SS
    expect(runMachine(p, "aab").verdict).toBe("limit");
    expect(decide("aab")).toBe(false);
  });

  it("the machine of 7.5, by final state", () => {
    const decide = pdaDecider(M75)!;
    expect(sorted(allWords(["0", "1"], 8).filter(decide))).toEqual(zeroOne(8));
  });

  it("random pushdown automata", () => {
    const random = rng(81);
    for (let i = 0; i < 100; i++) {
      const m = randomPDA(random);
      const decide = pdaDecider(m)!;
      for (const w of allWords(["a", "b"], 4)) expect(decide(w), `${JSON.stringify(m)} ${w}`).toBe(searchAccepts(m, w));
    }
  });

  it("no decision for a machine that is no pushdown automaton", () => {
    expect(pdaDecider({ ...M75, storages: [], transitions: [] })).toBeNull();
  });
});

describe("in the expression language", () => {
  const env = new Map<string, ExprValue>([["M", M75]]);

  it("toGrammar(M) of a pushdown automaton is its grammar; toEmptyStack, toFinalState convert", () => {
    const g = evaluateExpression("toGrammar(M)", env).value!;
    expect(g.value.kind).toBe("grammar");
    expect(g.stepGroups[0].operation).toBe("toGrammar(M)");
    const e = evaluateExpression("toEmptyStack(M)", env).value!.value as Machine;
    expect(e.acceptMode).toBe("emptyStorages");
    const f = evaluateExpression("toFinalState(toEmptyStack(M))", env).value!.value as Machine;
    expect(f.acceptMode).toBe("finalState");
  });

  it("toEmptyStack of a grammar is an error", () => {
    const g = parseGrammar(`Grammar:
  charset: a
  variables: S
  init: S
  rules:
    - S -> a`).value!;
    const r = evaluateExpression("toEmptyStack(G)", new Map<string, ExprValue>([["G", g]]));
    expect(r.ok).toBe(false);
    expect(r.diagnostics[0].detail!.key).toBe("expression.error.needsPda");
  });
});
