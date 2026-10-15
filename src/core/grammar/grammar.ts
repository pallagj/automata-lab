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

/**
 * Generative grammar. An empty right-hand side "" stands for ε.
 * Symbols are single characters (nonterminals are typically upper-case).
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
  left: string;
  right: string; // "" = ε
}

export function ruleToString(r: GrammarRule): string {
  return `${r.left} → ${r.right === "" ? EPS : r.right}`;
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

  const isTerminalWord = (w: string) => [...w].every((c) => term.has(c));

  /* --- type 3: right-linear (A → uB | u, u a terminal word) or left-linear --- */
  const v3right: I18nText[] = [];
  const v3left: I18nText[] = [];
  for (const r of g.rules) {
    if (!nt.has(r.left) || r.left.length !== 1) {
      const violation = tx("grammar.classify.leftNotSingleNonterminal", { rule: ruleToString(r) });
      v3right.push(violation);
      v3left.push(violation);
      continue;
    }
    const w = r.right;
    if (w === "") continue; // ε-rule — handled by the ε-freeness check
    // right-linear: terminals, with at most one nonterminal at the end
    const rOk = isTerminalWord(w) || (isTerminalWord(w.slice(0, -1)) && nt.has(w[w.length - 1]));
    if (!rOk) v3right.push(tx("grammar.classify.notRightLinear", { rule: ruleToString(r) }));
    const lOk = isTerminalWord(w) || (nt.has(w[0]) && isTerminalWord(w.slice(1)));
    if (!lOk) v3left.push(tx("grammar.classify.notLeftLinear", { rule: ruleToString(r) }));
  }
  const type3right = v3right.length === 0;
  const type3left = v3left.length === 0;
  const type3 = type3right || type3left;

  /* --- type 2: context-free (A → α) --- */
  const v2: I18nText[] = [];
  for (const r of g.rules) {
    if (!nt.has(r.left) || r.left.length !== 1) {
      v2.push(tx("grammar.classify.leftNotSingleNonterminal", { rule: ruleToString(r) }));
    }
  }
  const type2 = v2.length === 0;

  /* --- type 1: context-sensitive / monotone (|α| ≤ |β|, except S → ε if S never occurs on a right-hand side) --- */
  const v1: I18nText[] = [];
  const startOnRight = g.rules.some((r) => r.right.includes(g.start));
  for (const r of g.rules) {
    if (r.right === "") {
      if (r.left === g.start) {
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
          left: r.left,
          leftLen: r.left.length,
          right: r.right,
          rightLen: r.right.length
        })
      );
    }
  }
  const type1 = v1.length === 0;

  /* --- ε-freeness --- */
  const epsilonIssues: I18nText[] = [];
  for (const r of g.rules) {
    if (r.right === "") {
      if (r.left !== g.start) epsilonIssues.push(tx("grammar.classify.epsilonNotOnStart", { rule: ruleToString(r) }));
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
  let frontier: { form: string; path: string[] }[] = [{ form: g.start, path: [g.start] }];
  let formCount = 1;
  let exhaustive = true;

  const countNT = (w: string) => [...w].filter((c) => nt.has(c)).length;

  while (frontier.length > 0 && words.length < maxCount && formCount < maxForms) {
    const next: { form: string; path: string[] }[] = [];
    for (const { form, path } of frontier) {
      // leftmost derivation: rewrite the first nonterminal
      const idx = [...form].findIndex((c) => nt.has(c));
      if (idx === -1) continue;
      const A = form[idx];
      for (const r of g.rules) {
        // for context-sensitive rules: the left-hand side may match anywhere
        if (r.left.length === 1 && nt.has(r.left)) {
          if (r.left !== A) continue;
          const newForm = form.slice(0, idx) + r.right + form.slice(idx + 1);
          consider(newForm, path);
        } else {
          // general rule: at every occurrence
          let from = 0;
          while (true) {
            const at = form.indexOf(r.left, from);
            if (at === -1) break;
            const newForm = form.slice(0, at) + r.right + form.slice(at + r.left.length);
            consider(newForm, path);
            from = at + 1;
          }
        }
      }

      function consider(newForm: string, path: string[]) {
        // prune: if the terminal part is already too long it cannot fit the limit
        const termLen = newForm.length - countNT(newForm);
        if (termLen > maxLength) return;
        if (newForm.length > maxLength + 4) return; // sentential form limit
        if (seenForms.has(newForm)) return;
        seenForms.add(newForm);
        formCount++;
        const newPath = [...path, newForm];
        if (countNT(newForm) === 0) {
          if (newForm.length <= maxLength && !seenWords.has(newForm)) {
            seenWords.add(newForm);
            words.push({ word: newForm, derivation: newPath });
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
  const steps: AlgoStep[] = [];
  const rows: string[][] = [];

  for (const r of g.rules) {
    if (r.right === "") {
      if (!accept.includes(r.left)) accept.push(r.left);
      rows.push([ruleToString(r), `${r.left} → ✓`]);
      continue;
    }
    const last = r.right[r.right.length - 1];
    const isNT = g.nonterminals.includes(last);
    const symbols = isNT ? r.right.slice(0, -1) : r.right;
    const target = isNT ? last : acceptState;
    // multi-character terminal part: intermediate states
    let from = r.left;
    for (let i = 0; i < symbols.length; i++) {
      const isLast = i === symbols.length - 1;
      let to: string;
      if (isLast) to = target;
      else {
        to = `${r.left}${rows.length}_${i}`;
        states.push(to);
      }
      transitions.push({ from, symbol: symbols[i], to });
      from = to;
    }
    if (symbols.length === 0 && isNT) {
      // chain rule of the form A → B: ε-transition
      transitions.push({ from: r.left, symbol: EPS, to: target });
    }
    rows.push([ruleToString(r), isNT ? `${r.left} —${symbols || EPS}→ ${target}` : `${r.left} —${symbols}→ ${acceptState}`]);
  }

  steps.push({
    title: tx("grammar.toFsm.step.title"),
    detail: tx("grammar.toFsm.step.detail"),
    table: { headers: [tx("grammar.table.rule"), tx("grammar.table.transition")], rows }
  });

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

/** NFA → right-linear grammar */
export function fsmToGrammar(f: FSM): OpResult<Grammar> {
  const diags: Diagnostic[] = [];
  // state → nonterminal letter mapping
  const letters = "SABCDEFGHIJKLMNOPQRTUVWXYZ";
  const mapName = new Map<string, string>();
  const order = [f.start, ...f.states.filter((s) => s !== f.start)];
  if (order.length > letters.length) {
    return failResult([
      err(
        tx("grammar.fsmToGrammar.tooManyStates.title"),
        tx("grammar.fsmToGrammar.tooManyStates.detail", { count: order.length, max: letters.length })
      )
    ]);
  }
  order.forEach((s, i) => mapName.set(s, letters[i]));

  const rules: GrammarRule[] = [];
  for (const t of f.transitions) {
    if (t.symbol === EPS) {
      rules.push({ left: mapName.get(t.from)!, right: mapName.get(t.to)! });
    } else {
      rules.push({ left: mapName.get(t.from)!, right: t.symbol + mapName.get(t.to)! });
    }
  }
  for (const a of f.accept) {
    rules.push({ left: mapName.get(a)!, right: "" });
  }

  const renames = order.filter((s) => s !== mapName.get(s));
  if (renames.length)
    diags.push(
      info(
        tx("grammar.fsmToGrammar.renamed.title"),
        tx("grammar.fsmToGrammar.renamed.detail", { mapping: order.map((s) => `${s} ↦ ${mapName.get(s)}`).join(", ") })
      )
    );

  const g: Grammar = {
    kind: "grammar",
    name: f.name,
    terminals: [...f.alphabet],
    nonterminals: order.map((s) => mapName.get(s)!),
    start: mapName.get(f.start)!,
    rules
  };
  return okResult(g, diags, [
    {
      title: tx("grammar.fsmToGrammar.step.title"),
      detail: tx("grammar.fsmToGrammar.step.detail")
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
    transitions.push({ from: q, input: EPS, to: q, ops: [{ type: "stack", pop: r.left, push: r.right }] });
  }
  // terminal on top of the stack: match it against the input
  for (const a of g.terminals) {
    transitions.push({ from: q, input: a, to: q, ops: [{ type: "stack", pop: a, push: "" }] });
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
    storages: [{ id: "stack", type: "stack", init: g.start }],
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
  const diags: Diagnostic[] = [];

  // 1. nullable nonterminals
  const nullable = new Set<string>();
  let changed = true;
  while (changed) {
    changed = false;
    for (const r of g.rules) {
      if (nullable.has(r.left)) continue;
      if (r.right === "" || [...r.right].every((c) => nullable.has(c))) {
        nullable.add(r.left);
        changed = true;
      }
    }
  }
  steps.push({
    title: tx("grammar.epsfree.step1.title"),
    detail:
      nullable.size === 0
        ? tx("grammar.epsfree.step1.detailNone")
        : tx("grammar.epsfree.step1.detailSome", { nullable: [...nullable].join(", ") })
  });

  if (nullable.size === 0) return okResult({ ...g, rules: g.rules.map((r) => ({ ...r })) }, diags, steps);

  // 2. extend the rules: drop every subset of nullable occurrences
  const newRules = new Set<string>();
  for (const r of g.rules) {
    if (r.right === "") continue;
    const positions = [...r.right].map((c, i) => ({ c, i })).filter((x) => nullable.has(x.c));
    const n = positions.length;
    for (let mask = 0; mask < 1 << n; mask++) {
      const drop = new Set<number>();
      for (let j = 0; j < n; j++) if (mask & (1 << j)) drop.add(positions[j].i);
      const right = [...r.right].filter((_, i) => !drop.has(i)).join("");
      if (right !== "") newRules.add(`${r.left}→${right}`);
    }
  }

  // 3. if ε was in the language: new start symbol S' → S | ε
  const generatesEps = nullable.has(g.start);
  let start = g.start;
  let nonterminals = [...g.nonterminals];
  if (generatesEps) {
    const candidates = "ZYXWVU".split("").filter((c) => !g.nonterminals.includes(c) && !g.terminals.includes(c));
    const s2 = candidates[0] ?? "Ş";
    nonterminals = [s2, ...nonterminals];
    newRules.add(`${s2}→${g.start}`);
    newRules.add(`${s2}→`);
    start = s2;
    steps.push({
      title: tx("grammar.epsfree.step3.title"),
      detail: tx("grammar.epsfree.step3.detail", { s2, start: g.start })
    });
  }

  const rules: GrammarRule[] = [...newRules].map((s) => {
    const [left, right] = s.split("→");
    return { left, right };
  });

  steps.splice(1, 0, {
    title: tx("grammar.epsfree.step2.title"),
    detail: tx("grammar.epsfree.step2.detail"),
    table: {
      headers: [tx("grammar.table.newRules")],
      rows: rules.slice(0, 30).map((r) => [ruleToString(r)])
    }
  });

  const out: Grammar = { kind: "grammar", name: g.name, terminals: [...g.terminals], nonterminals, start, rules };
  return okResult(out, diags, steps);
}

/** (Bounded) test of whether a word is derivable. */
export function grammarAccepts(
  g: Grammar,
  word: string,
  maxForms = 30000
): { verdict: "yes" | "no" | "unknown"; derivation?: string[] } {
  const nt = new Set(g.nonterminals);
  const target = word;
  const countNT = (w: string) => [...w].filter((c) => nt.has(c)).length;
  // actual monotonicity (not the course-convention class): only then can the
  // sentential form length be safely pruned to the target word length
  const monotone = g.rules.every((r) => r.right.length >= r.left.length);

  const seen = new Set<string>([g.start]);
  let frontier: { form: string; path: string[] }[] = [{ form: g.start, path: [g.start] }];
  let forms = 1;
  let truncated = false;

  if (g.start === target && countNT(target) === 0) return { verdict: "yes", derivation: [g.start] };

  while (frontier.length > 0 && forms < maxForms) {
    const next: { form: string; path: string[] }[] = [];
    for (const { form, path } of frontier) {
      for (const r of g.rules) {
        let from = 0;
        while (true) {
          const at = form.indexOf(r.left, from);
          if (at === -1) break;
          const newForm = form.slice(0, at) + r.right + form.slice(at + r.left.length);
          from = at + 1;
          const termLen = newForm.length - countNT(newForm);
          if (monotone && newForm.length > Math.max(target.length, 1)) continue;
          if (termLen > target.length) continue;
          if (newForm.length > target.length + 6) continue;
          if (seen.has(newForm)) continue;
          seen.add(newForm);
          forms++;
          const newPath = [...path, newForm];
          if (newForm === target) return { verdict: "yes", derivation: newPath };
          if (countNT(newForm) > 0) next.push({ form: newForm, path: newPath });
        }
      }
    }
    frontier = next;
  }
  if (forms >= maxForms || (!monotone && frontier.length > 0)) truncated = true;
  return { verdict: truncated ? "unknown" : "no" };
}

export { transMap };
