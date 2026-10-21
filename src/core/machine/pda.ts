import { AlgoStep, Diagnostic, EPS, err, failResult, I18nText, info, okResult, OpResult, StepTable, tx } from "../types";
import { freshVariable, Grammar, GrammarRule, primedLabel, removeEpsilonRules, symbolsKey } from "../grammar/grammar";
import { removeUselessSymbols, toCNF } from "../grammar/normalForm";
import { cyk } from "../grammar/cyk";
import { isBracketName, showSymbols } from "../symbols";
import { Machine, machineCaps, MachineTransition, StorageOp } from "./machine";

/**
 * Pushdown automata and context-free grammars, the constructions of the lecture notes'
 * chapter 7: acceptance by final state ↔ by empty stack (7.9), and the grammar of a
 * pushdown automaton (7.16) — with it a word's membership is decided exactly, by CYK (8.1).
 */

type StackOp = Extract<StorageOp, { type: "stack" }>;

const stackOf = (t: MachineTransition) => t.ops[0] as StackOp;

const move = (from: string, input: string, pop: string, push: string[], to: string): MachineTransition => ({
  from,
  input,
  to,
  ops: [{ type: "stack", pop, push }]
});

/** A transition as the notes write δ: (q, a, A) → (p, α). */
export function pdaTransitionText(t: MachineTransition): string {
  const op = stackOf(t);
  return `(${t.from}, ${t.input}, ${op.pop}) → (${t.to}, ${showSymbols(op.push)})`;
}

/** Γ: the stack alphabet, with every symbol the start content and the transitions use. */
function stackAlphabet(m: Machine): string[] {
  const out = [...m.storages[0].alphabet];
  const add = (x: string) => {
    if (x !== EPS && !out.includes(x)) out.push(x);
  };
  m.storages[0].init.forEach(add);
  for (const t of m.transitions) {
    add(stackOf(t).pop);
    stackOf(t).push.forEach(add);
  }
  return out;
}

function needsPda(m: Machine, op: string): Diagnostic | null {
  if (machineCaps(m).isPDALike) return null;
  return err(tx("pda.needsPda.title", { opKey: `opNames.${op}` }), tx("pda.needsPda.detail"));
}

/** The machine with a new start, stack alphabet and transitions; everything else is copied. */
function rebuilt(
  m: Machine,
  parts: Pick<Machine, "states" | "start" | "accept" | "acceptMode" | "transitions"> & { gamma: string[]; init: string[] }
): Machine {
  const { gamma, init, ...rest } = parts;
  return {
    ...m,
    alphabet: [...m.alphabet],
    ...rest,
    storages: [{ ...m.storages[0], alphabet: gamma, init }]
  };
}

/**
 * The new start of 7.9: a new state q′₀ puts a new symbol Z under the start symbol Z₀ —
 * (q′₀, ε, Z₀) → (q₀, Z₀Z). A stack that does not start with a single symbol starts with Z
 * alone instead, and (q′₀, ε, Z) → (q₀, αZ) writes the start content α above it.
 */
function bottomStart(m: Machine, used: Set<string>) {
  const gamma = stackAlphabet(m);
  const start = primedLabel(m.start, used);
  used.add(start);
  const z = freshVariable({ base: "Z", primes: 0, sub: "" }, new Set(gamma));
  const init = m.storages[0].init;
  const z0 = init.length === 1 ? init[0] : z;
  const first = move(start, EPS, z0, [...init, z], m.start);
  return { gamma: [...gamma, z], start, z, z0, first, params: { start, oldStart: m.start, z, first: pdaTransitionText(first) } };
}

/** The transitions a construction adds, in the order its explanation names them. */
const newTransitions = (ts: MachineTransition[]): StepTable => ({
  headers: [tx("pda.table.newTransition")],
  rows: ts.map((t) => [pdaTransitionText(t)])
});

interface Built {
  machine: Machine;
  step: AlgoStep;
}

/**
 * Final state → empty stack (7.9): the new bottom symbol Z keeps the stack from emptying
 * while M runs; from an accepting state q the machine may go to q_ε, which empties the stack.
 */
function finalToEmpty(m: Machine): Built {
  const used = new Set(m.states);
  const b = bottomStart(m, used);
  const qe = freshVariable({ base: "q", primes: 0, sub: EPS }, used);
  const toEmptying = m.accept.flatMap((q) => b.gamma.map((A) => move(q, EPS, A, [], qe)));
  const emptying = b.gamma.map((A) => move(qe, EPS, A, [], qe));
  const machine = rebuilt(m, {
    states: [b.start, ...m.states, qe],
    start: b.start,
    accept: [],
    acceptMode: "emptyStorages",
    gamma: b.gamma,
    init: [b.z0],
    transitions: [b.first, ...m.transitions, ...toEmptying, ...emptying]
  });
  return {
    machine,
    step: {
      title: tx("pda.toEmptyStack.step.title"),
      detail: tx("pda.toEmptyStack.step.detail", { ...b.params, qe, accept: m.accept.length ? m.accept.join(", ") : "∅" }),
      table: newTransitions([b.first, ...toEmptying, ...emptying])
    }
  };
}

/**
 * Empty stack → final state (7.9): Z marks the bottom of the stack, and when only Z is
 * left — M′ has emptied its stack — the machine goes to the accepting state q_F from any
 * state of M′.
 */
function emptyToFinal(m: Machine): Built {
  const used = new Set(m.states);
  const b = bottomStart(m, used);
  const qf = freshVariable({ base: "q", primes: 0, sub: "F" }, used);
  const toAccept = m.states.map((q) => move(q, EPS, b.z, [b.z], qf));
  const machine = rebuilt(m, {
    states: [b.start, ...m.states, qf],
    start: b.start,
    accept: [qf],
    acceptMode: "finalState",
    gamma: b.gamma,
    init: [b.z0],
    transitions: [b.first, ...m.transitions, ...toAccept]
  });
  return {
    machine,
    step: {
      title: tx("pda.toFinalState.step.title"),
      detail: tx("pda.toFinalState.step.detail", { ...b.params, qf }),
      table: newTransitions([b.first, ...toAccept])
    }
  };
}

/**
 * An empty-stack machine whose stack never empties before the end: Z under the start
 * content, and only (q, ε, Z) → (q_ε, ε) takes it out — into q_ε, where nothing moves.
 * M′ empties its stack exactly when M's stack is empty and M stops there.
 */
function bottomMarked(m: Machine, detail: I18nText): Built {
  const used = new Set(m.states);
  const b = bottomStart(m, used);
  const qe = freshVariable({ base: "q", primes: 0, sub: EPS }, used);
  const out = m.states.map((q) => move(q, EPS, b.z, [], qe));
  const machine = rebuilt(m, {
    states: [b.start, ...m.states, qe],
    start: b.start,
    accept: [],
    acceptMode: "emptyStorages",
    gamma: b.gamma,
    init: [b.z0],
    transitions: [b.first, ...m.transitions, ...out]
  });
  const params = { ...detail.params, ...b.params, qe };
  return {
    machine,
    step: {
      title: tx("pda.toGrammar.bottom.title"),
      detail: tx(detail.key, params),
      table: newTransitions([b.first, ...out])
    }
  };
}

/** A pushdown automaton accepting the same language by empty stack (7.9). */
export function toEmptyStack(m: Machine): OpResult<Machine> {
  const bad = needsPda(m, "toEmptyStack");
  if (bad) return failResult([bad]);
  if (m.acceptMode === "emptyStorages")
    return okResult(m, [info(tx("pda.toEmptyStack.already.title"), tx("pda.toEmptyStack.already.detail"))]);
  const r = finalToEmpty(m);
  return okResult(r.machine, [], [r.step]);
}

/** A pushdown automaton accepting the same language by final state (7.9). */
export function toFinalState(m: Machine): OpResult<Machine> {
  const bad = needsPda(m, "toFinalState");
  if (bad) return failResult([bad]);
  if (m.acceptMode === "finalState")
    return okResult(m, [info(tx("pda.toFinalState.already.title"), tx("pda.toFinalState.already.detail"))]);
  const r = emptyToFinal(m);
  return okResult(r.machine, [], [r.step]);
}

/** Beyond this many rules the grammar is not built: every transition writing k symbols gives |Q|^k. */
export const MAX_PDA_GRAMMAR_RULES = 4000;

/** The states and stack symbols that cannot be written inside a variable [qAp] — the new ones of 7.9 can when these can. */
function unfitLabels(m: Machine): Diagnostic | null {
  const bad = [...m.states, ...stackAlphabet(m)].filter((x) => !isBracketName(`[${x}]`));
  return bad.length > 0 ? err(tx("pda.toGrammar.badLabel.title"), tx("pda.toGrammar.badLabel.detail", { labels: bad.join(", ") })) : null;
}

/** The variable [qAp] of 7.16. */
const variable = (q: string, A: string, p: string) => `[${q}${A}${p}]`;

/** Every list of n states, in order. */
function stateTuples(states: string[], n: number): string[][] {
  let out: string[][] = [[]];
  for (let i = 0; i < n; i++) out = out.flatMap((t) => states.map((q) => [...t, q]));
  return out;
}

/**
 * The grammar of 7.16 for a machine accepting by empty stack with a single start symbol:
 * first the transitions that take nothing from the stack take every symbol and put it
 * back, then [qAp] → a[q₁B₁q₂]…[q_kB_kp] for every transition and choice of states.
 */
function construct(p: Machine): OpResult<Grammar> {
  const gamma = stackAlphabet(p);
  const Q = p.states;
  const z0 = p.storages[0].init[0];

  // the names [qAp] must be different symbols (see unfitLabels)
  const names = new Map<string, string>();
  for (const q of Q)
    for (const A of gamma)
      for (const r of Q) {
        const v = variable(q, A, r);
        const triple = `${q} · ${A} · ${r}`;
        const other = names.get(v);
        if (other !== undefined && other !== triple)
          return failResult([
            err(tx("pda.toGrammar.ambiguousNames.title", { name: v }), tx("pda.toGrammar.ambiguousNames.detail", { a: other, b: triple }))
          ]);
        names.set(v, triple);
      }

  const steps: AlgoStep[] = [];

  // 1. (q′, α) ∈ δ(q, a, ε) becomes (q′, αA) ∈ δ(q, a, A) for every A ∈ Γ
  const transitions: MachineTransition[] = [];
  const seen = new Set<string>();
  const keep = (t: MachineTransition) => {
    const k = `${t.from}\u0002${t.input}\u0002${stackOf(t).pop}\u0002${t.to}\u0002${symbolsKey(stackOf(t).push)}`;
    if (!seen.has(k)) {
      seen.add(k);
      transitions.push(t);
    }
  };
  const replacedRows: string[][] = [];
  for (const t of p.transitions) {
    const op = stackOf(t);
    if (op.pop !== EPS) {
      keep(t);
      continue;
    }
    const instead = gamma.map((A) => move(t.from, t.input, A, [...op.push, A], t.to));
    instead.forEach(keep);
    replacedRows.push([pdaTransitionText(t), instead.map(pdaTransitionText).join(", ")]);
  }
  steps.push({
    title: tx("pda.toGrammar.replace.title"),
    detail: tx(replacedRows.length ? "pda.toGrammar.replace.detail" : "pda.toGrammar.replace.detailNone"),
    table: replacedRows.length ? { headers: [tx("pda.table.transition"), tx("pda.table.instead")], rows: replacedRows } : undefined
  });

  const count = Q.length + transitions.reduce((n, t) => n + Q.length ** stackOf(t).push.length, 0);
  if (count > MAX_PDA_GRAMMAR_RULES)
    return failResult(
      [err(tx("pda.toGrammar.tooLarge.title", { count }), tx("pda.toGrammar.tooLarge.detail", { max: MAX_PDA_GRAMMAR_RULES }))],
      steps
    );

  // 2. the variables [qAp] and S, S → [q₀Z₀q] for every state q
  const start = "S";
  const nonterminals = [start, ...Q.flatMap((q) => gamma.flatMap((A) => Q.map((r) => variable(q, A, r))))];
  const rules: GrammarRule[] = Q.map((q) => ({ left: [start], right: [variable(p.start, z0, q)] }));
  steps.push({
    title: tx("pda.toGrammar.variables.title"),
    detail: tx("pda.toGrammar.variables.detail", {
      states: Q.length,
      symbols: gamma.length,
      count: nonterminals.length,
      example: variable(p.start, z0, Q[Q.length - 1]),
      q0: p.start,
      z0,
      startRules: `${start} → ${rules.map((r) => r.right[0]).join(" | ")}`
    })
  });

  // 3. the rules of the transitions
  const ruleRows: string[][] = [];
  const shown = 4;
  for (const t of transitions) {
    const op = stackOf(t);
    const a = t.input === EPS ? [] : [t.input];
    const made: GrammarRule[] = [];
    if (op.push.length === 0) made.push({ left: [variable(t.from, op.pop, t.to)], right: a });
    else
      for (const tuple of stateTuples(Q, op.push.length)) {
        // q₁ = q′, then q₂ … q_k and q_{k+1} = q″ run over every state
        const qs = [t.to, ...tuple];
        const right = [...a, ...op.push.map((B, i) => variable(qs[i], B, qs[i + 1]))];
        made.push({ left: [variable(t.from, op.pop, qs[qs.length - 1])], right });
      }
    rules.push(...made);
    const text = made.slice(0, shown).map((r) => `${r.left[0]} → ${showSymbols(r.right)}`);
    if (made.length > shown) text.push("…");
    ruleRows.push([pdaTransitionText(t), text.join(", "), String(made.length)]);
  }
  steps.push({
    title: tx("pda.toGrammar.rules.title"),
    detail: tx("pda.toGrammar.rules.detail", { count: rules.length }),
    table: { headers: [tx("pda.table.transition"), tx("pda.table.rules"), tx("pda.table.count")], rows: ruleRows }
  });

  const g: Grammar = { kind: "grammar", name: p.name, terminals: [...p.alphabet], nonterminals, start, rules };
  return okResult(g, [], steps);
}

/**
 * Pushdown automaton → context-free grammar, the construction of the lecture notes (7.16):
 * the variable [qAp] derives exactly the words x with (q, x, A) ⇒* (p, ε, ε), and S → [q₀Z₀p]
 * for every state p. A machine accepting by final state is first made to accept by empty
 * stack (7.9). The first step of 7.16 — a transition that takes nothing from the stack takes
 * every symbol and puts it back — keeps the language only while the machine cannot move once
 * its stack is empty; where it can, a new bottom symbol keeps the stack from emptying first.
 */
export function pdaToGrammar(m: Machine): OpResult<Grammar> {
  const bad = needsPda(m, "toGrammar") ?? unfitLabels(m);
  if (bad) return failResult([bad]);
  const steps: AlgoStep[] = [];
  let p = m;
  if (m.acceptMode === "finalState") {
    const r = finalToEmpty(m);
    p = r.machine;
    steps.push(r.step);
  } else if (m.storages[0].init.length !== 1) {
    const r = bottomMarked(m, tx("pda.toGrammar.bottom.detailInit", { init: showSymbols(m.storages[0].init) }));
    p = r.machine;
    steps.push(r.step);
  }

  let built = construct(p);
  if (!built.ok) return failResult(built.diagnostics, [...steps, ...built.steps]);

  // a state where the stack can empty first, with a move that takes nothing from the stack:
  // [q₀Z₀p] derives a word exactly when the stack can empty first in p
  let useful = new Set(removeUselessSymbols(built.value!).value!.nonterminals);
  if (p === m) {
    const z0 = m.storages[0].init[0];
    const hazard = m.transitions.find((t) => stackOf(t).pop === EPS && useful.has(variable(m.start, z0, t.from)));
    if (hazard) {
      const r = bottomMarked(m, tx("pda.toGrammar.bottom.detailEmptied", { state: hazard.from, transition: pdaTransitionText(hazard) }));
      p = r.machine;
      steps.push(r.step);
      built = construct(p);
      if (!built.ok) return failResult(built.diagnostics, [...steps, ...built.steps]);
      useful = new Set(removeUselessSymbols(built.value!).value!.nonterminals);
    }
  }

  const g = built.value!;
  const diags: Diagnostic[] = [];
  const uselessCount = g.nonterminals.length - g.nonterminals.filter((v) => useful.has(v)).length;
  if (uselessCount > 0)
    diags.push(
      info(
        tx("pda.toGrammar.useless.title", { useless: uselessCount, count: g.nonterminals.length }),
        tx("pda.toGrammar.useless.detail"),
        { label: tx("pda.toGrammar.useless.fix"), code: `trim(toGrammar(${m.name}))` }
      )
    );
  return okResult(g, diags, [...steps, ...built.steps]);
}

/**
 * An exact decision of membership for a pushdown automaton: the grammar of 7.16 without its
 * useless symbols, ε-free and in Chomsky normal form, and CYK (8.1) on it. Null when the
 * machine is no pushdown automaton or its grammar would be too large.
 */
export function pdaDecider(m: Machine): ((word: string) => boolean) | null {
  const g = pdaToGrammar(m);
  if (!g.ok) return null;
  const epsFree = removeEpsilonRules(removeUselessSymbols(g.value!).value!).value!;
  const acceptsEmpty = epsFree.rules.some((r) => r.left[0] === epsFree.start && r.right.length === 0);
  const cnf = toCNF(epsFree).value!;
  return (word) => (word === "" ? acceptsEmpty : cyk(cnf, word).value!.accepted);
}
