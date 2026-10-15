import { EPS, setEquals, setName, setUnion } from "../types";

/** Finite automaton (may be an NFA, ε-NFA or DFA — analyze() decides). */
export interface FSM {
  kind: "fsm";
  name: string;
  alphabet: string[];
  states: string[];
  start: string;
  accept: string[];
  transitions: FSMTransition[];
}

export interface FSMTransition {
  from: string;
  /** input symbol or EPS */
  symbol: string;
  to: string;
}

export function makeFSM(f: Omit<FSM, "kind">): FSM {
  return { kind: "fsm", ...f };
}

export function cloneFSM(f: FSM, name?: string): FSM {
  return {
    kind: "fsm",
    name: name ?? f.name,
    alphabet: [...f.alphabet],
    states: [...f.states],
    start: f.start,
    accept: [...f.accept],
    transitions: f.transitions.map((t) => ({ ...t }))
  };
}

/** from → symbol → Set<to> */
export type TransMap = Map<string, Map<string, Set<string>>>;

export function transMap(f: FSM): TransMap {
  const m: TransMap = new Map();
  for (const t of f.transitions) {
    if (!m.has(t.from)) m.set(t.from, new Map());
    const inner = m.get(t.from)!;
    if (!inner.has(t.symbol)) inner.set(t.symbol, new Set());
    inner.get(t.symbol)!.add(t.to);
  }
  return m;
}

export function addTransition(f: FSM, from: string, symbol: string, to: string) {
  if (!f.transitions.some((t) => t.from === from && t.symbol === symbol && t.to === to)) {
    f.transitions.push({ from, symbol, to });
  }
}

export interface FSMAnalysis {
  hasEpsilon: boolean;
  /** at most 1 transition for every (state, symbol) pair and no ε */
  isDeterministic: boolean;
  /** at least 1 transition for every (state, symbol) pair */
  isComplete: boolean;
  /** deterministic AND complete */
  isCompleteDFA: boolean;
  unreachableStates: string[];
  /** (state, symbol) pairs with no transition */
  missing: { state: string; symbol: string }[];
  /** (state, symbol) pairs with several transitions */
  nondeterministicAt: { state: string; symbol: string; targets: string[] }[];
  epsilonTransitions: FSMTransition[];
}

export function analyzeFSM(f: FSM): FSMAnalysis {
  const tm = transMap(f);
  const epsilonTransitions = f.transitions.filter((t) => t.symbol === EPS);
  const hasEpsilon = epsilonTransitions.length > 0;

  const missing: { state: string; symbol: string }[] = [];
  const nondeterministicAt: { state: string; symbol: string; targets: string[] }[] = [];

  for (const s of f.states) {
    for (const a of f.alphabet) {
      const targets = tm.get(s)?.get(a);
      if (!targets || targets.size === 0) missing.push({ state: s, symbol: a });
      else if (targets.size > 1)
        nondeterministicAt.push({ state: s, symbol: a, targets: [...targets].sort() });
    }
  }

  const reachable = reachableStates(f);
  const unreachableStates = f.states.filter((s) => !reachable.has(s));

  const isDeterministic = !hasEpsilon && nondeterministicAt.length === 0;
  const isComplete = missing.length === 0;

  return {
    hasEpsilon,
    isDeterministic,
    isComplete,
    isCompleteDFA: isDeterministic && isComplete,
    unreachableStates,
    missing,
    nondeterministicAt,
    epsilonTransitions
  };
}

export function reachableStates(f: FSM): Set<string> {
  const tm = transMap(f);
  const visited = new Set<string>();
  const queue = [f.start];
  while (queue.length) {
    const s = queue.shift()!;
    if (visited.has(s)) continue;
    visited.add(s);
    const inner = tm.get(s);
    if (inner) for (const targets of inner.values()) for (const t of targets) queue.push(t);
  }
  return visited;
}

/** ε-closure: every state reachable from the given set via ε-transitions. */
export function epsilonClosure(f: FSM, states: Iterable<string>, tm?: TransMap): Set<string> {
  const map = tm ?? transMap(f);
  const closure = new Set<string>(states);
  const stack = [...closure];
  while (stack.length) {
    const s = stack.pop()!;
    const epsTargets = map.get(s)?.get(EPS);
    if (epsTargets)
      for (const t of epsTargets)
        if (!closure.has(t)) {
          closure.add(t);
          stack.push(t);
        }
  }
  return closure;
}

/** One step: where reading `symbol` takes the current state set (with ε-closure). */
export function stepStates(f: FSM, current: Set<string>, symbol: string, tm?: TransMap): Set<string> {
  const map = tm ?? transMap(f);
  let next = new Set<string>();
  for (const s of epsilonClosure(f, current, map)) {
    const targets = map.get(s)?.get(symbol);
    if (targets) next = setUnion(next, targets);
  }
  return epsilonClosure(f, next, map);
}

export function initialStates(f: FSM): Set<string> {
  return epsilonClosure(f, [f.start]);
}

export function acceptsFSM(f: FSM, word: string): boolean {
  const tm = transMap(f);
  let current = epsilonClosure(f, [f.start], tm);
  for (const c of word) {
    current = stepStates(f, current, c, tm);
    if (current.size === 0) return false;
  }
  return [...current].some((s) => f.accept.includes(s));
}

/** Enumerates accepted words by length (BFS), with limits. */
export function enumerateWords(
  f: FSM,
  maxLength = 8,
  maxCount = 30
): { words: string[]; exhaustive: boolean } {
  const tm = transMap(f);
  const words: string[] = [];
  const acceptSet = new Set(f.accept);
  // level: (state-set key → one representative word)
  let frontier = new Map<string, { states: Set<string>; word: string }>();
  const start = epsilonClosure(f, [f.start], tm);
  frontier.set(setName(start), { states: start, word: "" });

  const isAccepting = (states: Set<string>) => [...states].some((s) => acceptSet.has(s));

  if (isAccepting(start)) words.push(EPS);

  let exhaustive = true;
  for (let len = 1; len <= maxLength && words.length < maxCount; len++) {
    const next = new Map<string, { states: Set<string>; word: string }>();
    for (const { states, word } of frontier.values()) {
      for (const a of f.alphabet) {
        const ns = stepStates(f, states, a, tm);
        if (ns.size === 0) continue;
        const w = word + a;
        if (isAccepting(ns) && words.length < maxCount) words.push(w);
        const key = setName(ns) + "|" + w; // every word is tracked separately for a complete enumeration
        if (!next.has(key)) next.set(key, { states: ns, word: w });
      }
    }
    frontier = next;
    if (words.length >= maxCount) exhaustive = false;
  }
  if (frontier.size > 0) exhaustive = false;
  return { words: words.slice(0, maxCount), exhaustive };
}

/** A fresh, not yet used state name. */
export function freshStateName(existing: Iterable<string>, preferred = "T"): string {
  const used = new Set(existing);
  if (!used.has(preferred)) return preferred;
  let i = 1;
  while (used.has(`${preferred}${i}`)) i++;
  return `${preferred}${i}`;
}

/** Renames states to avoid clashes (renames m2's states if needed). */
export function disjointStates(a: FSM, b: FSM): FSM {
  const used = new Set([...a.states, ...b.states]);
  const renames = new Map<string, string>();
  for (const s of b.states) {
    if (a.states.includes(s)) {
      const fresh = freshStateName(used, `${s}′`);
      renames.set(s, fresh);
      used.add(fresh);
    }
  }
  if (renames.size === 0) return b;
  const rn = (s: string) => renames.get(s) ?? s;
  return {
    kind: "fsm",
    name: b.name,
    alphabet: [...b.alphabet],
    states: b.states.map(rn),
    start: rn(b.start),
    accept: b.accept.map(rn),
    transitions: b.transitions.map((t) => ({ from: rn(t.from), symbol: t.symbol, to: rn(t.to) }))
  };
}

export { setEquals };
