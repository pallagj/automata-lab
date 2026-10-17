/**
 * Helpers for the algorithm tests: a seeded random generator, random automata and
 * grammars, and brute-force language oracles that are independent of the algorithms
 * under test.
 */
import { EPS } from "./types";
import { FSM, makeFSM } from "./fsm/fsm";
import { Grammar } from "./grammar/grammar";

/** Deterministic PRNG (mulberry32) — the same seed gives the same test cases. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Every word over the alphabet up to the given length, ε ("") included. */
export function allWords(alphabet: string[], maxLength: number): string[] {
  const out = [""];
  let level = [""];
  for (let len = 1; len <= maxLength; len++) {
    level = level.flatMap((w) => alphabet.map((c) => w + c));
    out.push(...level);
  }
  return out;
}

/** A random (ε-)NFA: every (state, symbol) pair gets random targets. */
export function randomNFA(
  random: () => number,
  opts: { states: number; alphabet: string[]; density?: number; epsDensity?: number; acceptRate?: number }
): FSM {
  const { states: n, alphabet, density = 0.3, epsDensity = 0.12, acceptRate = 0.35 } = opts;
  const states = Array.from({ length: n }, (_, i) => `q${i}`);
  const transitions: FSM["transitions"] = [];
  for (const from of states)
    for (const symbol of [...alphabet, EPS])
      for (const to of states)
        if (random() < (symbol === EPS ? epsDensity : density)) transitions.push({ from, symbol, to });
  return makeFSM({
    name: "R",
    alphabet,
    states,
    start: states[0],
    accept: states.filter(() => random() < acceptRate),
    transitions
  });
}

/** A random context-free grammar over nonterminals S, A, B, C and terminals a, b, with ε-rules. */
export function randomCFG(random: () => number): Grammar {
  const nonterminals = ["S", "A", "B", "C"].slice(0, 2 + Math.floor(random() * 3));
  const terminals = ["a", "b"];
  const symbols = [...nonterminals, ...terminals];
  const rules: Grammar["rules"] = [];
  for (const left of nonterminals) {
    const count = 1 + Math.floor(random() * 3);
    for (let i = 0; i < count; i++) {
      const len = random() < 0.25 ? 0 : 1 + Math.floor(random() * 3);
      const right: string[] = [];
      for (let j = 0; j < len; j++) right.push(symbols[Math.floor(random() * symbols.length)]);
      if (!rules.some((r) => r.left[0] === left && r.right.join(" ") === right.join(" "))) rules.push({ left: [left], right });
    }
  }
  return { kind: "grammar", name: "G", terminals, nonterminals, start: "S", rules };
}

/**
 * The words of a context-free grammar up to the given length, as the least fixpoint
 * of its language equations cut at that length. Exact: a word of length ≤ L only ever
 * uses subwords of length ≤ L.
 */
export function cfgWordsUpTo(g: Grammar, maxLength: number): Set<string> {
  const words = new Map(g.nonterminals.map((A) => [A, new Set<string>()]));
  let changed = true;
  while (changed) {
    changed = false;
    for (const r of g.rules) {
      let acc = new Set([""]);
      for (const c of r.right) {
        const options = words.get(c) ?? new Set([c]);
        const next = new Set<string>();
        for (const x of acc) for (const y of options) if (x.length + y.length <= maxLength) next.add(x + y);
        acc = next;
        if (acc.size === 0) break;
      }
      const target = words.get(r.left[0])!;
      for (const w of acc)
        if (!target.has(w)) {
          target.add(w);
          changed = true;
        }
    }
  }
  return words.get(g.start)!;
}

export const sorted = (s: Iterable<string>) => [...s].sort((a, b) => a.length - b.length || a.localeCompare(b));
