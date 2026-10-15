import { EPS } from "../types";
import { FSM } from "../fsm/fsm";

/**
 * General machine model: finite control + configurable storages.
 *
 * A machine may have any number of storages (stack / queue / tape) and consumes
 * its input either with a one-way read head (input: "head" — FSM/PDA style) or
 * receives it written onto a storage at start-up (input: <storage id> — TM style).
 *
 * The classic machine classes are restricted cases:
 *   - finite automaton:   no storage, input: head
 *   - pushdown automaton: 1 stack, input: head
 *   - Turing machine:     1 tape, input: the tape
 */

export const TAPE_BLANK = "_";

export type StorageType = "stack" | "queue" | "tape";

export interface StorageSpec {
  id: string;
  type: StorageType;
  /** initial content of a stack/queue (stack: left end is the top; queue: left end is the front) */
  init: string;
}

/** An operation on one storage — its type follows the storage's type. */
export type StorageOp =
  | { type: "stack"; pop: string; push: string } // pop: EPS = does not inspect/pop
  | { type: "queue"; take: string; put: string } // take: EPS = does not read from the front
  | { type: "tape"; read: string; write: string; move: "L" | "R" | "S" };

export interface MachineTransition {
  from: string;
  to: string;
  /** symbol read or EPS — only meaningful with input: "head" */
  input: string;
  /** one operation per storage, in the order of storages */
  ops: StorageOp[];
}

export interface Machine {
  kind: "machine";
  name: string;
  alphabet: string[];
  states: string[];
  start: string;
  accept: string[];
  /** finalState: in an accepting state; emptyStorages: every stack/queue is empty */
  acceptMode: "finalState" | "emptyStorages";
  /** "head" = one-way read head, otherwise the id of a storage (the input is written there) */
  input: "head" | string;
  storages: StorageSpec[];
  transitions: MachineTransition[];
}

export interface TapeState {
  cells: Map<number, string>;
  head: number;
}

export type StorageState = string | TapeState;

export interface MachineConfig {
  state: string;
  /** position of the read head (with input: "head") */
  pos: number;
  /** current content per storage, in the order of storages */
  storages: StorageState[];
  steps: number;
}

export function hasInputHead(m: Machine): boolean {
  return m.input === "head";
}

/* ------------------------------------------------------------------ */
/* Configurations                                                      */
/* ------------------------------------------------------------------ */

function emptyTape(content: string): TapeState {
  const cells = new Map<number, string>();
  [...content].forEach((c, i) => {
    if (c !== TAPE_BLANK) cells.set(i, c);
  });
  return { cells, head: 0 };
}

export function initialMachineConfig(m: Machine, input: string): MachineConfig {
  const storages: StorageState[] = m.storages.map((s) => {
    const content = m.input === s.id ? input + s.init : s.init;
    return s.type === "tape" ? emptyTape(content) : content;
  });
  return { state: m.start, pos: 0, storages, steps: 0 };
}

export function readTapeCell(t: TapeState, pos: number): string {
  return t.cells.get(pos) ?? TAPE_BLANK;
}

export function machineConfigKey(c: MachineConfig): string {
  const parts = [c.state, String(c.pos)];
  for (const s of c.storages) {
    if (typeof s === "string") parts.push(s);
    else {
      const ks = [...s.cells.keys()].sort((a, b) => a - b);
      parts.push(`${s.head}@` + ks.map((k) => `${k}:${s.cells.get(k)}`).join(","));
    }
  }
  return parts.join("|");
}

/* ------------------------------------------------------------------ */
/* Step                                                                */
/* ------------------------------------------------------------------ */

function applyOp(op: StorageOp, st: StorageState): StorageState | null {
  switch (op.type) {
    case "stack": {
      const s = st as string;
      if (op.pop === EPS) return op.push + s;
      if (s.length > 0 && s[0] === op.pop) return op.push + s.slice(1);
      return null;
    }
    case "queue": {
      const s = st as string;
      if (op.take === EPS) return s + op.put;
      if (s.length > 0 && s[0] === op.take) return s.slice(1) + op.put;
      return null;
    }
    case "tape": {
      const t = st as TapeState;
      if (readTapeCell(t, t.head) !== op.read) return null;
      const cells = new Map(t.cells);
      if (op.write === TAPE_BLANK) cells.delete(t.head);
      else cells.set(t.head, op.write);
      const head = t.head + (op.move === "R" ? 1 : op.move === "L" ? -1 : 0);
      return { cells, head };
    }
  }
}

/** Configurations reachable from a configuration in one step (with the transition applied). */
export function machineMoves(
  m: Machine,
  c: MachineConfig,
  input: string
): { config: MachineConfig; transition: MachineTransition }[] {
  const result: { config: MachineConfig; transition: MachineTransition }[] = [];
  const head = hasInputHead(m);
  const nextChar = head && c.pos < input.length ? input[c.pos] : null;

  outer: for (const t of m.transitions) {
    if (t.from !== c.state) continue;
    let newPos = c.pos;
    if (head) {
      if (t.input === EPS) {
        // does not read
      } else if (nextChar !== null && t.input === nextChar) {
        newPos = c.pos + 1;
      } else continue;
    }
    const storages: StorageState[] = [];
    for (let i = 0; i < m.storages.length; i++) {
      const next = applyOp(t.ops[i], c.storages[i]);
      if (next === null) continue outer;
      storages.push(next);
    }
    result.push({
      config: { state: t.to, pos: newPos, storages, steps: c.steps + 1 },
      transition: t
    });
  }
  return result;
}

/**
 * Is the configuration accepting?
 *  - read-head machine: the input is consumed AND (accepting state / every stack and queue empty)
 *  - tape-input machine: it has halted (no applicable transition) in an accepting state
 */
export function isAcceptingMachineConfig(m: Machine, c: MachineConfig, input: string): boolean {
  if (hasInputHead(m)) {
    if (c.pos !== input.length) return false;
    if (m.acceptMode === "emptyStorages")
      return c.storages.every((s, i) => m.storages[i].type === "tape" || (s as string).length === 0);
    return m.accept.includes(c.state);
  }
  if (!m.accept.includes(c.state)) return false;
  return machineMoves(m, c, input).length === 0;
}

/* ------------------------------------------------------------------ */
/* Running                                                             */
/* ------------------------------------------------------------------ */

export interface MachineRunResult {
  verdict: "accepted" | "rejected" | "limit";
  acceptingPath?: { config: MachineConfig; via?: MachineTransition }[];
  exploredConfigs: number;
}

/** Decides whether a word is accepted with a bounded BFS (guards against infinite ε-loops / runs). */
export function runMachine(
  m: Machine,
  input: string,
  maxConfigs = 20000,
  maxStorage = 400
): MachineRunResult {
  interface Item {
    config: MachineConfig;
    parent: Item | null;
    via?: MachineTransition;
  }
  const start: Item = { config: initialMachineConfig(m, input), parent: null };
  const seen = new Set<string>([machineConfigKey(start.config)]);
  let frontier: Item[] = [start];
  let explored = 1;

  const buildPath = (item: Item) => {
    const path: { config: MachineConfig; via?: MachineTransition }[] = [];
    let cur: Item | null = item;
    while (cur) {
      path.unshift({ config: cur.config, via: cur.via });
      cur = cur.parent;
    }
    return path;
  };

  const tooBig = (c: MachineConfig) =>
    c.storages.some((s, i) =>
      m.storages[i].type === "tape" ? false : (s as string).length > maxStorage
    );

  if (isAcceptingMachineConfig(m, start.config, input)) {
    return { verdict: "accepted", acceptingPath: buildPath(start), exploredConfigs: explored };
  }

  while (frontier.length > 0) {
    const next: Item[] = [];
    for (const item of frontier) {
      for (const { config, transition } of machineMoves(m, item.config, input)) {
        if (tooBig(config)) continue;
        const key = machineConfigKey(config);
        if (seen.has(key)) continue;
        seen.add(key);
        explored++;
        const newItem: Item = { config, parent: item, via: transition };
        if (isAcceptingMachineConfig(m, config, input)) {
          return { verdict: "accepted", acceptingPath: buildPath(newItem), exploredConfigs: explored };
        }
        if (explored >= maxConfigs) {
          return { verdict: "limit", exploredConfigs: explored };
        }
        next.push(newItem);
      }
    }
    frontier = next;
  }
  return { verdict: "rejected", exploredConfigs: explored };
}

/** Interactive simulation: one step of the current configuration set (every branch). */
export function stepMachineConfigs(
  m: Machine,
  configs: MachineConfig[],
  input: string,
  maxConfigs = 200
): MachineConfig[] {
  const out: MachineConfig[] = [];
  const seen = new Set<string>();
  for (const c of configs) {
    for (const { config } of machineMoves(m, c, input)) {
      const key = machineConfigKey(config);
      if (!seen.has(key)) {
        seen.add(key);
        out.push(config);
        if (out.length >= maxConfigs) return out;
      }
    }
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Analysis and capabilities                                          */
/* ------------------------------------------------------------------ */

export interface MachineAnalysis {
  /** static determinism: two transitions can never match at the same time */
  isDeterministic: boolean;
  /** pairs of transitions that are applicable in the same situation */
  nondeterministicAt: { state: string; detail: string }[];
  hasEpsilonInput: boolean;
}

/** Can two guards overlap (both match the same configuration)? */
function guardsOverlap(m: Machine, a: MachineTransition, b: MachineTransition): boolean {
  if (hasInputHead(m) && a.input !== EPS && b.input !== EPS && a.input !== b.input) return false;
  for (let i = 0; i < m.storages.length; i++) {
    const oa = a.ops[i];
    const ob = b.ops[i];
    if (oa.type === "stack" && ob.type === "stack") {
      if (oa.pop !== EPS && ob.pop !== EPS && oa.pop !== ob.pop) return false;
    } else if (oa.type === "queue" && ob.type === "queue") {
      if (oa.take !== EPS && ob.take !== EPS && oa.take !== ob.take) return false;
    } else if (oa.type === "tape" && ob.type === "tape") {
      if (oa.read !== ob.read) return false;
    }
  }
  return true;
}

export function analyzeMachine(m: Machine): MachineAnalysis {
  const nondeterministicAt: { state: string; detail: string }[] = [];
  const head = hasInputHead(m);
  const hasEpsilonInput = head && m.transitions.some((t) => t.input === EPS);

  const byState = new Map<string, MachineTransition[]>();
  for (const t of m.transitions) {
    if (!byState.has(t.from)) byState.set(t.from, []);
    byState.get(t.from)!.push(t);
  }
  for (const [state, ts] of byState) {
    let found = false;
    for (let i = 0; i < ts.length && !found; i++) {
      for (let j = i + 1; j < ts.length && !found; j++) {
        if (guardsOverlap(m, ts[i], ts[j])) {
          nondeterministicAt.push({
            state,
            detail: `${machineTransitionLabel(m, ts[i])}  ‖  ${machineTransitionLabel(m, ts[j])}`
          });
          found = true; // one example per state is enough
        }
      }
    }
  }
  return {
    isDeterministic: nondeterministicAt.length === 0,
    nondeterministicAt,
    hasEpsilonInput
  };
}

export interface MachineCaps {
  /** no storage, read head — can be treated as a finite automaton */
  isFSMLike: boolean;
  /** read head + exactly 1 stack */
  isPDALike: boolean;
  /** exactly 1 tape, holding the input */
  isTMLike: boolean;
  /** machine-kind identifier for the UI label (i18n key) */
  kind: "fsm" | "pda" | "tm" | "general";
  /** only for kind === "general": number of storages per type, to build the label */
  storageCounts?: Partial<Record<StorageType, number>>;
}

export function machineCaps(m: Machine): MachineCaps {
  const head = hasInputHead(m);
  const types = m.storages.map((s) => s.type);
  const isFSMLike = head && types.length === 0;
  const isPDALike = head && types.length === 1 && types[0] === "stack";
  const isTMLike = !head && types.length === 1 && types[0] === "tape" && m.input === m.storages[0].id;
  let kind: MachineCaps["kind"] = "general";
  let storageCounts: Partial<Record<StorageType, number>> | undefined;
  if (isFSMLike) kind = "fsm";
  else if (isPDALike) kind = "pda";
  else if (isTMLike) kind = "tm";
  else if (types.length > 0) {
    const cnt = (t: StorageType) => types.filter((x) => x === t).length;
    storageCounts = { stack: cnt("stack"), queue: cnt("queue"), tape: cnt("tape") };
  }
  return { isFSMLike, isPDALike, isTMLike, kind, storageCounts };
}

/** Converts a storage-free machine into input for the finite-automaton algorithms. */
export function machineToFSM(m: Machine): FSM | null {
  if (!machineCaps(m).isFSMLike) return null;
  return {
    kind: "fsm",
    name: m.name,
    alphabet: [...m.alphabet],
    states: [...m.states],
    start: m.start,
    accept: [...m.accept],
    transitions: m.transitions.map((t) => ({ from: t.from, symbol: t.input, to: t.to }))
  };
}

/** Converts the result of the finite-automaton algorithms back into the unified machine model. */
export function fsmToMachine(f: FSM): Machine {
  return {
    kind: "machine",
    name: f.name,
    alphabet: [...f.alphabet],
    states: [...f.states],
    start: f.start,
    accept: [...f.accept],
    acceptMode: "finalState",
    input: "head",
    storages: [],
    transitions: f.transitions.map((t) => ({ from: t.from, to: t.to, input: t.symbol, ops: [] }))
  };
}

/* ------------------------------------------------------------------ */
/* Labels                                                              */
/* ------------------------------------------------------------------ */

const showEps = (s: string) => (s === "" ? EPS : s);

export function storageOpLabel(op: StorageOp): string {
  switch (op.type) {
    case "stack":
      return `${op.pop} / ${showEps(op.push)}`;
    case "queue":
      return `${op.take} / ${showEps(op.put)}`;
    case "tape": {
      const r = op.read === TAPE_BLANK ? "␣" : op.read;
      const w = op.write === TAPE_BLANK ? "␣" : op.write;
      const mv = op.move === "R" ? "→" : op.move === "L" ? "←" : "·";
      return r === w ? `${r}, ${mv}` : `${r} → ${w}, ${mv}`;
    }
  }
}

/** Edge label for the graph: the textbook form for preset machines, segments otherwise. */
export function machineTransitionLabel(m: Machine, t: MachineTransition): string {
  const caps = machineCaps(m);
  if (caps.isFSMLike) return t.input;
  if (caps.isPDALike) return `${t.input}, ${storageOpLabel(t.ops[0])}`;
  if (caps.isTMLike) return storageOpLabel(t.ops[0]);
  const parts: string[] = [];
  if (hasInputHead(m)) parts.push(t.input);
  parts.push(...t.ops.map(storageOpLabel));
  return parts.join(" ‖ ");
}

/** The visible slice of the tape + the head's relative position (for display). */
export function tapeWindow(
  t: TapeState,
  radius = 10
): { cells: string[]; headIndex: number; startPos: number } {
  let min = t.head;
  let max = t.head;
  for (const k of t.cells.keys()) {
    if (k < min) min = k;
    if (k > max) max = k;
  }
  min = Math.max(min, t.head - radius);
  max = Math.min(max, t.head + radius);
  const cells: string[] = [];
  for (let i = min; i <= max; i++) cells.push(readTapeCell(t, i));
  return { cells, headIndex: t.head - min, startPos: min };
}
