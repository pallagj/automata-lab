import {
  AlgoStep,
  Diagnostic,
  EPS,
  err,
  failResult,
  I18nText,
  info,
  okResult,
  OpResult,
  tx
} from "../types";
import { FSM, makeFSM, transMap } from "../fsm/fsm";
import { Machine } from "../machine/machine";
import { canonicalName, formatIdent, Ident, parseIdent, showSymbols, subscriptText } from "../symbols";

/**
 * Generative grammar. Terminals are single characters; variables are names in the
 * sense of core/symbols.ts (S, A, X_a, C_1, S′). A rule's sides are lists of symbols —
 * an empty right-hand side stands for ε.
 */
export interface Grammar {
  kind: "grammar";
  name: string;
  terminals: string[];
  nonterminals: string[];
  start: string;
  rules: GrammarRule[];
}

export interface GrammarRule {
  /** a context-free rule has a single variable here */
  left: string[];
  /** [] = ε */
  right: string[];
}

export function ruleToString(r: GrammarRule): string {
  return `${showSymbols(r.left)} → ${showSymbols(r.right)}`;
}

/** Key of a symbol list for sets and maps. */
export const symbolsKey = (s: string[]) => s.join("\u0001");

/** A variable name not used yet: the base, then with more and more primes (S, S′, S′′, …). */
export function freshVariable(base: Ident, used: Set<string>): string {
  for (let primes = base.primes; ; primes++) {
    const name = formatIdent({ ...base, primes });
    if (!used.has(name)) {
      used.add(name);
      return name;
    }
  }
}

/* ------------------------------------------------------------------ */
/* Chomsky classification with detailed explanations                  */
/* ------------------------------------------------------------------ */

export interface Classification {
  /** the highest class of the lecture notes' definitions (4.12–4.15) that holds */
  type: 0 | 1 | 2 | 3;
  /** each class's condition and the rules that break it */
  reasons: {
    type3: { holds: boolean; violations: I18nText[] };
    type2: { holds: boolean; violations: I18nText[] };
    type1: { holds: boolean; violations: I18nText[] };
  };
  /**
   * every rule is A → α with α anything, ε too (6.3.1): the grammars the context-free
   * transformations work on — with ε-rules not of class 2 yet, but its language is
   * context-free (6.14)
   */
  contextFreeForm: boolean;
  /** every rule is A → uB, A → u or A → ε (u a terminal word): it becomes a finite automaton */
  rightLinear: boolean;
  /** every rule is A → Bu, A → u or A → ε — the left-regular grammars of 4.23 and more */
  leftLinear: boolean;
  /** no rule shortens, apart from the allowed S → ε (12.5): its language is context-sensitive (12.6) */
  nonContracting: boolean;
  /** whether it is ε-free (apart from the allowed S → ε) */
  epsilonFree: boolean;
  epsilonIssues: I18nText[];
}

/**
 * The Chomsky class of a grammar, with the lecture notes' definitions:
 *   3: A → aB or A → a                              (4.12)
 *   2: A → α with α ≠ ε                             (4.13)
 *   1: βAγ → βαγ with α ≠ ε                         (4.14)
 *   0: anything with a variable on the left         (4.15)
 * Each class also allows S → ε when S occurs on no right-hand side (4.14 says "left-hand
 * side" there, a slip: the condition is the same in all three). The classes are nested,
 * so the grammar's class is the highest one that holds.
 */
export function classify(g: Grammar): Classification {
  const nt = new Set(g.nonterminals);
  const term = new Set(g.terminals);

  const allTerminals = (w: string[]) => w.every((c) => term.has(c));
  const singleVariable = (r: GrammarRule) => r.left.length === 1 && nt.has(r.left[0]);
  const startOnRight = g.rules.some((r) => r.right.includes(g.start));
  const isStartEps = (r: GrammarRule) => r.right.length === 0 && r.left.length === 1 && r.left[0] === g.start;

  /** the ε-rules every class allows only as S → ε with S on no right-hand side */
  const epsViolation = (r: GrammarRule): I18nText | null => {
    if (r.right.length > 0) return null;
    if (!isStartEps(r)) return tx("grammar.classify.deletingRule", { rule: ruleToString(r) });
    return startOnRight ? tx("grammar.classify.startEpsilonNotAllowed", { start: g.start }) : null;
  };
  const check = (form: (r: GrammarRule) => boolean, key: string) => {
    const out: I18nText[] = [];
    for (const r of g.rules) {
      const v = r.right.length === 0 ? epsViolation(r) : form(r) ? null : tx(key, { rule: ruleToString(r) });
      if (v && !out.some((x) => x.key === v.key && x.params?.rule === v.params?.rule)) out.push(v);
    }
    return out;
  };

  /* --- class 3: A → aB | a --- */
  const v3 = check(
    (r) =>
      singleVariable(r) &&
      term.has(r.right[0]) &&
      (r.right.length === 1 || (r.right.length === 2 && nt.has(r.right[1]))),
    "grammar.classify.notRegularRule"
  );
  /* --- class 2: A → α, α ≠ ε --- */
  const v2 = check(singleVariable, "grammar.classify.leftNotSingleVariable");
  /* --- class 1: βAγ → βαγ, α ≠ ε --- */
  const v1 = check((r) => isContextSensitiveRule(r, nt), "grammar.classify.notContextSensitive");

  const epsilonIssues: I18nText[] = [];
  for (const r of g.rules) {
    if (r.right.length === 0) {
      if (!isStartEps(r)) epsilonIssues.push(tx("grammar.classify.epsilonNotOnStart", { rule: ruleToString(r) }));
      else if (startOnRight) epsilonIssues.push(tx("grammar.classify.startOnRightWithEpsilon", { start: g.start }));
    }
  }

  const type3 = v3.length === 0;
  const type2 = v2.length === 0;
  const type1 = v1.length === 0;
  const type: Classification["type"] = type3 ? 3 : type2 ? 2 : type1 ? 1 : 0;

  const linear = (r: GrammarRule, varAt: "end" | "start") => {
    if (!singleVariable(r)) return false;
    const w = r.right;
    if (allTerminals(w)) return true;
    return varAt === "end"
      ? nt.has(w[w.length - 1]) && allTerminals(w.slice(0, -1))
      : nt.has(w[0]) && allTerminals(w.slice(1));
  };

  return {
    type,
    reasons: {
      type3: { holds: type3, violations: v3.slice(0, 6) },
      type2: { holds: type2, violations: v2.slice(0, 6) },
      type1: { holds: type1, violations: v1.slice(0, 6) }
    },
    contextFreeForm: g.rules.every(singleVariable),
    rightLinear: g.rules.every((r) => linear(r, "end")),
    leftLinear: g.rules.every((r) => linear(r, "start")),
    nonContracting: g.rules.every((r) => (r.right.length === 0 ? epsViolation(r) === null : r.right.length >= r.left.length)),
    epsilonFree: epsilonIssues.length === 0,
    epsilonIssues
  };
}

/** βAγ → βαγ with a variable A and α ≠ ε: some variable of the left side is replaced, in place. */
function isContextSensitiveRule(r: GrammarRule, nt: Set<string>): boolean {
  const L = r.left;
  const R = r.right;
  for (let i = 0; i < L.length; i++) {
    if (!nt.has(L[i])) continue;
    const beta = L.slice(0, i);
    const gamma = L.slice(i + 1);
    if (R.length - beta.length - gamma.length < 1) continue;
    if (beta.every((c, k) => R[k] === c) && gamma.every((c, k) => R[R.length - gamma.length + k] === c)) return true;
  }
  return false;
}

/* ------------------------------------------------------------------ */
/* Sentential forms                                                    */
/* ------------------------------------------------------------------ */

/** Where `part` occurs in `form` from position `from` on (-1: nowhere). */
function indexOfSymbols(form: string[], part: string[], from: number): number {
  outer: for (let i = from; i + part.length <= form.length; i++) {
    for (let j = 0; j < part.length; j++) if (form[i + j] !== part[j]) continue outer;
    return i;
  }
  return -1;
}

/** Every form one rule application away (CF rules at the leftmost variable, other rules anywhere). */
function successors(g: Grammar, nt: Set<string>, form: string[], leftmostOnly: boolean): string[][] {
  const out: string[][] = [];
  const first = form.findIndex((c) => nt.has(c));
  if (first === -1) return out;
  for (const r of g.rules) {
    if (leftmostOnly && r.left.length === 1 && nt.has(r.left[0])) {
      if (r.left[0] === form[first]) out.push([...form.slice(0, first), ...r.right, ...form.slice(first + 1)]);
      continue;
    }
    for (let at = indexOfSymbols(form, r.left, 0); at !== -1; at = indexOfSymbols(form, r.left, at + 1))
      out.push([...form.slice(0, at), ...r.right, ...form.slice(at + r.left.length)]);
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Word generation with derivations                                   */
/* ------------------------------------------------------------------ */

export interface GeneratedWord {
  word: string; // "" = ε
  derivation: string[]; // sequence of sentential forms from S to the word
}

export function generateWords(
  g: Grammar,
  maxLength = 8,
  maxCount = 40,
  maxForms = 6000
): { words: GeneratedWord[]; exhaustive: boolean } {
  const nt = new Set(g.nonterminals);
  const words: GeneratedWord[] = [];
  const seenWords = new Set<string>();
  const seenForms = new Set<string>([g.start]);
  let frontier: { form: string[]; path: string[] }[] = [{ form: [g.start], path: [g.start] }];
  let formCount = 1;
  let exhaustive = true;

  const countNT = (w: string[]) => w.filter((c) => nt.has(c)).length;

  while (frontier.length > 0 && words.length < maxCount && formCount < maxForms) {
    const next: { form: string[]; path: string[] }[] = [];
    for (const { form, path } of frontier) {
      // leftmost derivation for context-free rules; other rules may match anywhere
      for (const newForm of successors(g, nt, form, true)) {
        // prune: if the terminal part is already too long it cannot fit the limit
        if (newForm.length - countNT(newForm) > maxLength) continue;
        if (newForm.length > maxLength + 4) continue; // sentential form limit
        const key = symbolsKey(newForm);
        if (seenForms.has(key)) continue;
        seenForms.add(key);
        formCount++;
        const newPath = [...path, newForm.join("")];
        if (countNT(newForm) === 0) {
          const word = newForm.join("");
          if (!seenWords.has(word)) {
            seenWords.add(word);
            words.push({ word, derivation: newPath });
          }
        } else {
          next.push({ form: newForm, path: newPath });
        }
      }
    }
    frontier = next;
  }
  if (frontier.length > 0 || formCount >= maxForms || words.length >= maxCount) exhaustive = false;
  words.sort((a, b) => a.word.length - b.word.length || a.word.localeCompare(b.word));
  return { words: words.slice(0, maxCount), exhaustive };
}

/* ------------------------------------------------------------------ */
/* Conversions                                                         */
/* ------------------------------------------------------------------ */

/**
 * Right-linear grammar → NFA, the construction of the lecture notes (4.20): every variable
 * is a state, A → aB is the transition A →a B, A → a a transition into the new accepting
 * state E. Beyond the class-3 rules it also takes A → uB and A → u with a terminal word u
 * (through new states), A → B (an ε-transition) and A → ε (A accepts).
 */
export function grammarToFSM(g: Grammar): OpResult<FSM> {
  if (!classify(g).rightLinear) {
    return failResult([
      err(tx("grammar.toFsm.needsRightLinear.title"), tx("grammar.toFsm.needsRightLinear.detail"))
    ]);
  }

  const acceptState = freshVariable({ base: "E", primes: 0, sub: "" }, new Set(g.nonterminals));
  const states = [...g.nonterminals, acceptState];
  const accept = [acceptState];
  const transitions: { from: string; symbol: string; to: string }[] = [];
  const rows: string[][] = [];
  // intermediate states for rules with several terminals: q_1, q_2, … not taken yet
  let counter = 0;
  const freshState = () => {
    let name: string;
    do name = formatIdent({ base: "q", primes: 0, sub: String(++counter) });
    while (states.includes(name));
    states.push(name);
    return name;
  };

  for (const r of g.rules) {
    const A = r.left[0];
    if (r.right.length === 0) {
      if (!accept.includes(A)) accept.push(A);
      rows.push([ruleToString(r), `${A} ∈ F`]);
      continue;
    }
    const last = r.right[r.right.length - 1];
    const isNT = g.nonterminals.includes(last);
    const symbols = isNT ? r.right.slice(0, -1) : r.right;
    const target = isNT ? last : acceptState;
    let from = A;
    symbols.forEach((a, i) => {
      const to = i === symbols.length - 1 ? target : freshState();
      transitions.push({ from, symbol: a, to });
      from = to;
    });
    // chain rule of the form A → B: ε-transition
    if (symbols.length === 0) transitions.push({ from: A, symbol: EPS, to: target });
    rows.push([ruleToString(r), `${A} —${showSymbols(symbols)}→ ${target}`]);
  }

  const steps: AlgoStep[] = [
    {
      title: tx("grammar.toFsm.step.title"),
      detail: tx("grammar.toFsm.step.detail", { end: acceptState }),
      table: { headers: [tx("grammar.table.rule"), tx("grammar.table.transition")], rows }
    }
  ];

  const fsm = makeFSM({
    name: g.name,
    alphabet: [...g.terminals],
    states,
    start: g.start,
    accept,
    transitions
  });
  return okResult(fsm, [], steps);
}

/** A state label not used yet, with one more prime: q₀ → q′₀, {A,B} → {A,B}′. */
function primedLabel(label: string, used: Set<string>): string {
  const id = parseIdent(label, false);
  for (let primes = 1; ; primes++) {
    const name = id ? formatIdent({ ...id, primes: id.primes + primes }) : label + "′".repeat(primes);
    if (!used.has(name)) return name;
  }
}

/**
 * Finite automaton → regular grammar, the construction of the lecture notes (4.20): every
 * state q gets a variable A_q (the state's own name when that is a valid variable name), a
 * transition δ(q, a) = p gives A_q → aA_p — and A_q → a too when p accepts — and S → ε
 * comes when the start state accepts. That S → ε needs S on no right-hand side, so first
 * no transition may lead into the start state (4.19): a copy q′₀ of it takes them over.
 * The result is of class 3. An ε-transition has no such rule: it must be removed first.
 */
export function fsmToGrammar(f: FSM): OpResult<Grammar> {
  const eps = f.transitions.filter((t) => t.symbol === EPS);
  if (eps.length > 0)
    return failResult([
      err(
        tx("grammar.fsmToGrammar.needsEpsilonFree.title"),
        tx("grammar.fsmToGrammar.needsEpsilonFree.detail", {
          list: eps.slice(0, 4).map((t) => `${t.from} →ε ${t.to}`).join(", ") + (eps.length > 4 ? ", …" : "")
        }),
        { label: tx("ops.fix.insertEpsfree"), code: `toGrammar(epsfree(${f.name}))` }
      )
    ]);

  const diags: Diagnostic[] = [];
  const steps: AlgoStep[] = [];
  let states = [...f.states];
  let accept = [...f.accept];
  let transitions = f.transitions.map((t) => ({ ...t }));

  // 4.19: the start state accepts (S → ε) but transitions lead into it — a copy takes them over
  const intoStart = f.transitions.filter((t) => t.to === f.start);
  if (f.accept.includes(f.start) && intoStart.length > 0) {
    const copy = primedLabel(f.start, new Set(f.states));
    const redirect = (s: string) => (s === f.start ? copy : s);
    transitions = [
      ...f.transitions.map((t) => ({ ...t, to: redirect(t.to) })),
      ...f.transitions.filter((t) => t.from === f.start).map((t) => ({ from: copy, symbol: t.symbol, to: redirect(t.to) }))
    ];
    states = [...f.states, copy];
    accept = [...f.accept, copy];
    steps.push({
      title: tx("grammar.fsmToGrammar.newStart.title"),
      detail: tx("grammar.fsmToGrammar.newStart.detail", { start: f.start, copy }),
      table: {
        headers: [tx("grammar.table.transition"), tx("grammar.fsmToGrammar.table.instead")],
        rows: [
          ...intoStart.map((t) => [`δ(${t.from}, ${t.symbol}) = ${t.to}`, `δ(${t.from}, ${t.symbol}) = ${copy}`]),
          ...f.transitions
            .filter((t) => t.from === f.start)
            .map((t) => ["", `δ(${copy}, ${t.symbol}) = ${redirect(t.to)}`])
        ]
      }
    });
  }

  // the variables: the states whose names can stay first, so that renamed ones never take their names
  const order = [f.start, ...states.filter((s) => s !== f.start)];
  const used = new Set<string>(f.alphabet);
  const mapName = new Map<string, string>();
  for (const s of order) {
    const own = canonicalName(s);
    if (own !== null && !used.has(own) && parseIdent(s, false) !== null) {
      used.add(own);
      mapName.set(s, own);
    }
  }
  for (const s of order) {
    if (mapName.has(s)) continue;
    const sub = subscriptText(s) || String(order.indexOf(s) + 1);
    mapName.set(s, freshVariable({ base: "A", primes: 0, sub }, used));
  }
  const v = (s: string) => mapName.get(s)!;
  steps.push({
    title: tx("grammar.fsmToGrammar.step.title"),
    detail: tx("grammar.fsmToGrammar.step.detail"),
    table: { headers: [tx("ops.table.state"), tx("grammar.table.variable")], rows: order.map((s) => [s, v(s)]) }
  });

  // the rules, state by state
  const rules: GrammarRule[] = [];
  const seen = new Set<string>();
  const add = (left: string, right: string[]) => {
    const key = `${left}\u0002${symbolsKey(right)}`;
    if (seen.has(key)) return;
    seen.add(key);
    rules.push({ left: [left], right });
  };
  const rows: string[][] = [];
  const symbolOrder = (c: string) => f.alphabet.indexOf(c);
  for (const q of order) {
    const out = transitions
      .filter((t) => t.from === q)
      .sort((a, b) => symbolOrder(a.symbol) - symbolOrder(b.symbol) || order.indexOf(a.to) - order.indexOf(b.to));
    for (const t of out) {
      const made = [[t.symbol, v(t.to)]];
      if (accept.includes(t.to)) made.push([t.symbol]);
      made.forEach((r) => add(v(q), r));
      rows.push([`δ(${q}, ${t.symbol}) = ${t.to}`, `${v(q)} → ${made.map(showSymbols).join(" | ")}`]);
    }
  }
  if (accept.includes(f.start)) {
    add(v(f.start), []);
    rows.push([`${f.start} ∈ F`, `${v(f.start)} → ε`]);
  }
  steps.push({
    title: tx("grammar.fsmToGrammar.rules.title"),
    detail: tx("grammar.fsmToGrammar.rules.detail"),
    table: { headers: [tx("grammar.table.transition"), tx("grammar.table.newRules")], rows }
  });

  const renamed = order.filter((s) => s !== v(s));
  if (renamed.length)
    diags.push(
      info(
        tx("grammar.fsmToGrammar.renamed.title"),
        tx("grammar.fsmToGrammar.renamed.detail", { mapping: renamed.map((s) => `${s} ↦ ${v(s)}`).join(", ") })
      )
    );

  const g: Grammar = {
    kind: "grammar",
    name: f.name,
    terminals: [...f.alphabet],
    nonterminals: order.map(v),
    start: v(f.start),
    rules
  };
  return okResult(g, diags, steps);
}

/** Context-free grammar → pushdown automaton (top-down parser). */
export function grammarToPDA(g: Grammar): OpResult<Machine> {
  if (!classify(g).contextFreeForm) {
    return failResult([
      err(tx("grammar.toPda.needsContextFree.title"), tx("grammar.toPda.needsContextFree.detail"))
    ]);
  }

  const q = "q";
  const transitions: Machine["transitions"] = [];
  // nonterminal on top of the stack: apply a rule
  for (const r of g.rules) {
    transitions.push({ from: q, input: EPS, to: q, ops: [{ type: "stack", pop: r.left[0], push: [...r.right] }] });
  }
  // terminal on top of the stack: match it against the input
  for (const a of g.terminals) {
    transitions.push({ from: q, input: a, to: q, ops: [{ type: "stack", pop: a, push: [] }] });
  }

  const pda: Machine = {
    kind: "machine",
    name: g.name,
    alphabet: [...g.terminals],
    states: [q],
    start: q,
    accept: [],
    acceptMode: "emptyStorages",
    input: "head",
    // the stack holds the sentential form's rest: variables and terminals
    storages: [{ id: "stack", type: "stack", alphabet: [...g.nonterminals, ...g.terminals], init: [g.start] }],
    transitions
  };

  return okResult(pda, [
    info(tx("grammar.toPda.emptyStackInfo.title"), tx("grammar.toPda.emptyStackInfo.detail"))
  ], [
    {
      title: tx("grammar.toPda.step.title"),
      detail: tx("grammar.toPda.step.detail", { q, start: g.start, ruleCount: g.rules.length, terminalCount: g.terminals.length })
    }
  ]);
}

/** Eliminates ε-rules from a grammar of A → α rules (6.3.1): the result is of class 2 (6.14). */
export function removeEpsilonRules(g: Grammar): OpResult<Grammar> {
  if (!classify(g).contextFreeForm) {
    return failResult([
      err(tx("grammar.epsfree.needsContextFree.title"), tx("grammar.epsfree.needsContextFree.detail"))
    ]);
  }
  const steps: AlgoStep[] = [];
  const setText = (s: Set<string>) => `{${g.nonterminals.filter((x) => s.has(x)).join(", ")}}`;

  // 1. nullable nonterminals, round by round:
  //    N1 = {A : A → ε},  N(i+1) = N(i) ∪ {A : A → α, every symbol of α is in N(i)}
  let nullable = new Set(g.rules.filter((r) => r.right.length === 0).map((r) => r.left[0]));
  const rounds = [new Set(nullable)];
  while (true) {
    const next = new Set(nullable);
    for (const r of g.rules) if (r.right.every((c) => nullable.has(c))) next.add(r.left[0]);
    rounds.push(next);
    if (next.size === nullable.size) break;
    nullable = next;
  }
  steps.push({
    title: tx("grammar.epsfree.step1.title"),
    detail:
      nullable.size === 0
        ? tx("grammar.epsfree.step1.detailNone")
        : tx("grammar.epsfree.step1.detailSome", { nullable: setText(nullable), rounds: rounds.length }),
    table:
      nullable.size === 0
        ? undefined
        : { headers: ["i", "Nᵢ"], rows: rounds.map((s, i) => [String(i + 1), setText(s)]) }
  });

  if (nullable.size === 0) return okResult(copyGrammar(g), [], steps);

  // 2. every variant of each rule with some of its nullable occurrences dropped — by the
  //    number of dropped symbols, then by position — except ε itself and A → A
  const rules: GrammarRule[] = [];
  const seen = new Set<string>();
  const rows: string[][] = [];
  for (const r of g.rules) {
    if (r.right.length === 0) {
      rows.push([ruleToString(r), "—"]);
      continue;
    }
    const A = r.left[0];
    const positions = r.right.flatMap((c, i) => (nullable.has(c) ? [i] : []));
    const variants: string[][] = [];
    for (const drop of subsetsBySize(positions)) {
      const right = r.right.filter((_, i) => !drop.includes(i));
      if (right.length === 0 || (right.length === 1 && right[0] === A)) continue;
      if (variants.some((v) => symbolsKey(v) === symbolsKey(right))) continue;
      variants.push(right);
      const key = `${A}\u0002${symbolsKey(right)}`;
      if (!seen.has(key)) {
        seen.add(key);
        rules.push({ left: [A], right });
      }
    }
    rows.push([ruleToString(r), variants.length ? `${A} → ${variants.map(showSymbols).join(" | ")}` : "—"]);
  }
  steps.push({
    title: tx("grammar.epsfree.step2.title"),
    detail: tx("grammar.epsfree.step2.detail"),
    table: { headers: [tx("grammar.table.rule"), tx("grammar.table.newRules")], rows }
  });

  // 3. if ε was in the language: a new start symbol S′ → S | ε
  let start = g.start;
  let nonterminals = [...g.nonterminals];
  if (nullable.has(g.start)) {
    const used = new Set([...g.nonterminals, ...g.terminals]);
    const base = parseIdent(g.start) ?? { base: "S", primes: 0, sub: "" };
    const s2 = freshVariable({ ...base, primes: base.primes + 1 }, used);
    nonterminals = [s2, ...nonterminals];
    rules.unshift({ left: [s2], right: [g.start] }, { left: [s2], right: [] });
    start = s2;
    steps.push({
      title: tx("grammar.epsfree.step3.title"),
      detail: tx("grammar.epsfree.step3.detail", { s2, start: g.start })
    });
  }

  const out: Grammar = { kind: "grammar", name: g.name, terminals: [...g.terminals], nonterminals, start, rules };
  return okResult(out, [], steps);
}

export function copyGrammar(g: Grammar): Grammar {
  return {
    ...g,
    terminals: [...g.terminals],
    nonterminals: [...g.nonterminals],
    rules: g.rules.map((r) => ({ left: [...r.left], right: [...r.right] }))
  };
}

/** Every subset of the items: by size, and lexicographically by position within a size. */
function subsetsBySize<T>(items: T[]): T[][] {
  const out: T[][] = [];
  const pick = (from: number, size: number, acc: T[]) => {
    if (acc.length === size) {
      out.push(acc);
      return;
    }
    for (let i = from; i < items.length; i++) pick(i + 1, size, [...acc, items[i]]);
  };
  for (let size = 0; size <= items.length; size++) pick(0, size, []);
  return out;
}

/** (Bounded) test of whether a word is derivable. */
export function grammarAccepts(
  g: Grammar,
  word: string,
  maxForms = 30000
): { verdict: "yes" | "no" | "unknown"; derivation?: string[] } {
  const nt = new Set(g.nonterminals);
  const target = [...word];
  const targetKey = symbolsKey(target);
  const countNT = (w: string[]) => w.filter((c) => nt.has(c)).length;
  // actual monotonicity (not the course-convention class): only then can the
  // sentential form length be safely pruned to the target word length
  const monotone = g.rules.every((r) => r.right.length >= r.left.length);

  const seen = new Set<string>([g.start]);
  let frontier: { form: string[]; path: string[] }[] = [{ form: [g.start], path: [g.start] }];
  let forms = 1;
  let truncated = false;

  while (frontier.length > 0 && forms < maxForms) {
    const next: { form: string[]; path: string[] }[] = [];
    for (const { form, path } of frontier) {
      for (const newForm of successors(g, nt, form, false)) {
        const termLen = newForm.length - countNT(newForm);
        if (monotone && newForm.length > Math.max(target.length, 1)) continue;
        if (termLen > target.length) continue;
        if (newForm.length > target.length + 6) continue;
        const key = symbolsKey(newForm);
        if (seen.has(key)) continue;
        seen.add(key);
        forms++;
        const newPath = [...path, newForm.join("")];
        if (key === targetKey && countNT(newForm) === 0) return { verdict: "yes", derivation: newPath };
        if (countNT(newForm) > 0) next.push({ form: newForm, path: newPath });
      }
    }
    frontier = next;
  }
  if (forms >= maxForms || (!monotone && frontier.length > 0)) truncated = true;
  return { verdict: truncated ? "unknown" : "no" };
}

export { transMap };
