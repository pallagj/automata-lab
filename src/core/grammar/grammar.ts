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
  /** the highest class that holds */
  type: 0 | 1 | 2 | 3;
  /** the reasoning behind the classification, per level */
  reasons: {
    type3: { holds: boolean; violations: I18nText[] };
    type2: { holds: boolean; violations: I18nText[] };
    type1: { holds: boolean; violations: I18nText[] };
  };
  /** whether it is ε-free (apart from the allowed S → ε) */
  epsilonFree: boolean;
  epsilonIssues: I18nText[];
  direction?: "right" | "left";
}

export function classify(g: Grammar): Classification {
  const nt = new Set(g.nonterminals);
  const term = new Set(g.terminals);

  const allTerminals = (w: string[]) => w.every((c) => term.has(c));
  const singleVariable = (r: GrammarRule) => r.left.length === 1 && nt.has(r.left[0]);

  /* --- type 3: right-linear (A → uB | u, u a terminal word) or left-linear --- */
  const v3right: I18nText[] = [];
  const v3left: I18nText[] = [];
  for (const r of g.rules) {
    if (!singleVariable(r)) {
      const violation = tx("grammar.classify.leftNotSingleNonterminal", { rule: ruleToString(r) });
      v3right.push(violation);
      v3left.push(violation);
      continue;
    }
    const w = r.right;
    if (w.length === 0) continue; // ε-rule — handled by the ε-freeness check
    // right-linear: terminals, with at most one nonterminal at the end
    const rOk = allTerminals(w) || (allTerminals(w.slice(0, -1)) && nt.has(w[w.length - 1]));
    if (!rOk) v3right.push(tx("grammar.classify.notRightLinear", { rule: ruleToString(r) }));
    const lOk = allTerminals(w) || (nt.has(w[0]) && allTerminals(w.slice(1)));
    if (!lOk) v3left.push(tx("grammar.classify.notLeftLinear", { rule: ruleToString(r) }));
  }
  const type3right = v3right.length === 0;
  const type3left = v3left.length === 0;
  const type3 = type3right || type3left;

  /* --- type 2: context-free (A → α) --- */
  const v2: I18nText[] = [];
  for (const r of g.rules) {
    if (!singleVariable(r)) v2.push(tx("grammar.classify.leftNotSingleNonterminal", { rule: ruleToString(r) }));
  }
  const type2 = v2.length === 0;

  /* --- type 1: context-sensitive / monotone (|α| ≤ |β|, except S → ε if S never occurs on a right-hand side) --- */
  const v1: I18nText[] = [];
  const startOnRight = g.rules.some((r) => r.right.includes(g.start));
  const isStartEps = (r: GrammarRule) => r.right.length === 0 && r.left.length === 1 && r.left[0] === g.start;
  for (const r of g.rules) {
    if (r.right.length === 0) {
      if (isStartEps(r)) {
        if (startOnRight) v1.push(tx("grammar.classify.startEpsilonNotAllowed"));
      } else {
        v1.push(tx("grammar.classify.deletingRule", { rule: ruleToString(r) }));
      }
      continue;
    }
    if (r.left.length > r.right.length) {
      v1.push(
        tx("grammar.classify.shortens", {
          rule: ruleToString(r),
          left: showSymbols(r.left),
          leftLen: r.left.length,
          right: showSymbols(r.right),
          rightLen: r.right.length
        })
      );
    }
  }
  const type1 = v1.length === 0;

  /* --- ε-freeness --- */
  const epsilonIssues: I18nText[] = [];
  for (const r of g.rules) {
    if (r.right.length === 0) {
      if (!isStartEps(r)) epsilonIssues.push(tx("grammar.classify.epsilonNotOnStart", { rule: ruleToString(r) }));
      else if (startOnRight) epsilonIssues.push(tx("grammar.classify.startOnRightWithEpsilon"));
    }
  }
  const epsilonFree = epsilonIssues.length === 0;

  let type: 0 | 1 | 2 | 3 = 0;
  if (type1) type = 1;
  if (type2 && type1) type = 2;
  if (type3 && type2 && type1) type = 3;
  // note: the hierarchy is cumulative by definition; ε-rules on levels 2/3
  // follow the usual convention (S→ε is allowed).
  if (type2 && !type1) {
    // a CF grammar with ε-rules is type 2 by the usual course convention
    type = 2;
    if (type3) type = 3;
  }

  return {
    type,
    reasons: {
      type3: { holds: type3, violations: type3 ? [] : type3right ? [] : v3right.slice(0, 6) },
      type2: { holds: type2, violations: v2.slice(0, 6) },
      type1: { holds: type1, violations: v1.slice(0, 6) }
    },
    epsilonFree,
    epsilonIssues,
    direction: type3 ? (type3right ? "right" : "left") : undefined
  };
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

/** Type-3 (right-linear) grammar → NFA */
export function grammarToFSM(g: Grammar): OpResult<FSM> {
  const cls = classify(g);
  if (cls.type !== 3 || cls.direction !== "right") {
    return failResult([
      err(tx("grammar.toFsm.needsRightLinear.title"), tx("grammar.toFsm.needsRightLinear.detail"))
    ]);
  }

  const acceptState = "✓";
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
      rows.push([ruleToString(r), `${A} → ✓`]);
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
      detail: tx("grammar.toFsm.step.detail"),
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

/**
 * NFA → right-linear grammar (lecture notes, Theorem 4.20). Every state q gets a variable:
 * the state's own name when that is a valid variable name (S, A, q_0), otherwise A_q —
 * the state's label in the subscript (A_{00}, A_{A,B}).
 */
export function fsmToGrammar(f: FSM): OpResult<Grammar> {
  const diags: Diagnostic[] = [];
  const order = [f.start, ...f.states.filter((s) => s !== f.start)];
  const used = new Set<string>(f.alphabet);
  const mapName = new Map<string, string>();
  // the states whose names can stay first, so that renamed ones never take their names
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

  const rules: GrammarRule[] = [];
  for (const t of f.transitions) {
    rules.push({ left: [v(t.from)], right: t.symbol === EPS ? [v(t.to)] : [t.symbol, v(t.to)] });
  }
  for (const a of f.accept) rules.push({ left: [v(a)], right: [] });

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
  return okResult(g, diags, [
    {
      title: tx("grammar.fsmToGrammar.step.title"),
      detail: tx("grammar.fsmToGrammar.step.detail"),
      table: {
        headers: [tx("ops.table.state"), tx("grammar.table.variable")],
        rows: order.map((s) => [s, v(s)])
      }
    }
  ]);
}

/** Context-free grammar → pushdown automaton (top-down parser). */
export function grammarToPDA(g: Grammar): OpResult<Machine> {
  const cls = classify(g);
  if (!cls.reasons.type2.holds) {
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
    storages: [{ id: "stack", type: "stack", init: [g.start] }],
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

/** Eliminates ε-rules (for type 2–3 grammars). */
export function removeEpsilonRules(g: Grammar): OpResult<Grammar> {
  const cls = classify(g);
  if (!cls.reasons.type2.holds) {
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
