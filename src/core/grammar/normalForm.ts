import { AlgoStep, Diagnostic, err, failResult, info, OpResult, okResult, tx, warn } from "../types";
import { classify, copyGrammar, freshVariable, Grammar, GrammarRule, ruleToString, symbolsKey } from "./grammar";
import { formatIdent, showSymbols, subscriptText } from "../symbols";

/**
 * Context-free grammar transformations of the lecture notes (6.3.2, 6.3.3, 6.4.1):
 * unit-rule elimination, removal of useless symbols and the Chomsky normal form.
 */

function needsContextFree(g: Grammar, op: string): Diagnostic | null {
  if (classify(g).contextFreeForm) return null;
  return err(tx("grammar.needsContextFree.title", { opKey: `opNames.${op}` }), tx("grammar.needsContextFree.detail"));
}

/** "{A, B}" in the order of the given symbol list. */
const setText = (order: string[], s: Set<string>) => `{${order.filter((x) => s.has(x)).join(", ")}}`;

/* ------------------------------------------------------------------ */
/* Unit rules (6.3.2)                                                  */
/* ------------------------------------------------------------------ */

/**
 * Removes the A → B rules: U(A) is the set of variables reachable from A in the graph
 * of unit rules (A included), and A gets every non-unit rule B → β of each B ∈ U(A).
 */
export function removeUnitRules(g: Grammar): OpResult<Grammar> {
  const notCF = needsContextFree(g, "unitfree");
  if (notCF) return failResult([notCF]);

  const nt = new Set(g.nonterminals);
  const isUnit = (r: GrammarRule) => r.right.length === 1 && nt.has(r.right[0]);
  const diags: Diagnostic[] = [];
  if (!classify(g).epsilonFree)
    diags.push(
      warn(tx("grammar.unitfree.epsilonFirst.title"), tx("grammar.unitfree.epsilonFirst.detail"), {
        label: tx("grammar.unitfree.epsilonFirst.fix"),
        code: `unitfree(epsfree(${g.name}))`
      })
    );

  if (!g.rules.some(isUnit)) {
    return okResult(copyGrammar(g), diags, [
      { title: tx("grammar.unitfree.step1.title"), detail: tx("grammar.unitfree.step1.detailNone") }
    ]);
  }

  // U(A): breadth-first search along the unit rules, A first
  const reach = new Map<string, string[]>();
  for (const A of g.nonterminals) {
    const order = [A];
    for (let i = 0; i < order.length; i++)
      for (const r of g.rules)
        if (r.left[0] === order[i] && isUnit(r) && !order.includes(r.right[0])) order.push(r.right[0]);
    reach.set(A, order);
  }

  const rules: GrammarRule[] = [];
  const seen = new Set<string>();
  const rows: string[][] = [];
  for (const A of g.nonterminals) {
    const rights: string[] = [];
    for (const B of reach.get(A)!)
      for (const r of g.rules) {
        const key = `${A}\u0002${symbolsKey(r.right)}`;
        if (r.left[0] === B && !isUnit(r) && !seen.has(key)) {
          seen.add(key);
          rules.push({ left: [A], right: [...r.right] });
          rights.push(showSymbols(r.right));
        }
      }
    rows.push([A, `{${reach.get(A)!.join(", ")}}`, rights.length ? `${A} → ${rights.join(" | ")}` : "—"]);
  }

  const steps: AlgoStep[] = [
    {
      title: tx("grammar.unitfree.step1.title"),
      detail: tx("grammar.unitfree.step1.detail", {
        edges: g.rules.filter(isUnit).map(ruleToString).join(", ")
      })
    },
    {
      title: tx("grammar.unitfree.step2.title"),
      detail: tx("grammar.unitfree.step2.detail"),
      table: { headers: [tx("grammar.table.variable"), "U(A)", tx("grammar.table.newRules")], rows }
    }
  ];
  return okResult({ ...copyGrammar(g), rules }, diags, steps);
}

/* ------------------------------------------------------------------ */
/* Useless symbols (6.3.3)                                             */
/* ------------------------------------------------------------------ */

/**
 * Removes the useless symbols in the order of the lecture notes: first the variables
 * that derive no terminal word, then the symbols that cannot be reached from the
 * start symbol (the other order may leave useless symbols behind, see 6.22).
 */
export function removeUselessSymbols(g: Grammar): OpResult<Grammar> {
  const notCF = needsContextFree(g, "trim");
  if (notCF) return failResult([notCF]);
  const steps: AlgoStep[] = [];
  const diags: Diagnostic[] = [];
  const symbolOrder = [...g.nonterminals, ...g.terminals];

  // 1. terminating: B0 = Σ, Bi = B(i−1) ∪ {A : A → α, α ∈ B(i−1)*}
  let B = new Set(g.terminals);
  const bRounds = [new Set(B)];
  while (true) {
    const next = new Set(B);
    for (const r of g.rules) if (r.right.every((c) => B.has(c))) next.add(r.left[0]);
    bRounds.push(next);
    if (next.size === B.size) break;
    B = next;
  }
  const nonTerminating = g.nonterminals.filter((A) => !B.has(A));
  const rules1 = g.rules.filter((r) => B.has(r.left[0]) && r.right.every((c) => B.has(c)));
  steps.push({
    title: tx("grammar.trim.step1.title"),
    detail:
      nonTerminating.length === 0
        ? tx("grammar.trim.step1.detailNone")
        : tx("grammar.trim.step1.detail", { removed: nonTerminating.join(", ") }),
    table: { headers: ["i", "Bᵢ"], rows: bRounds.map((s, i) => [String(i), setText(symbolOrder, s)]) }
  });

  if (!B.has(g.start)) {
    diags.push(info(tx("grammar.trim.emptyLanguage.title"), tx("grammar.trim.emptyLanguage.detail", { start: g.start })));
    const out: Grammar = { ...g, terminals: [...g.terminals], nonterminals: [g.start], rules: [] };
    return okResult(out, diags, steps);
  }

  // 2. reachable: T0 = {S}, Ti = T(i−1) ∪ {Z : A → α, A ∈ T(i−1), Z occurs in α}
  let T = new Set([g.start]);
  const tRounds = [new Set(T)];
  while (true) {
    const next = new Set(T);
    for (const r of rules1) if (T.has(r.left[0])) for (const c of r.right) next.add(c);
    tRounds.push(next);
    if (next.size === T.size) break;
    T = next;
  }
  const unreachable = symbolOrder.filter((x) => B.has(x) && !T.has(x));
  steps.push({
    title: tx("grammar.trim.step2.title"),
    detail:
      unreachable.length === 0
        ? tx("grammar.trim.step2.detailNone")
        : tx("grammar.trim.step2.detail", { removed: unreachable.join(", ") }),
    table: { headers: ["i", "Tᵢ"], rows: tRounds.map((s, i) => [String(i), setText(symbolOrder, s)]) }
  });

  const rules = rules1.filter((r) => T.has(r.left[0]));
  const removedRules = g.rules.filter((r) => !rules.includes(r));
  if (removedRules.length > 0)
    steps.push({
      title: tx("grammar.trim.step3.title"),
      detail: tx("grammar.trim.step3.detail", { rules: removedRules.map(ruleToString).join(", ") })
    });

  const out: Grammar = {
    ...g,
    terminals: g.terminals.filter((a) => T.has(a)),
    nonterminals: g.nonterminals.filter((A) => T.has(A)),
    rules: rules.map((r) => ({ left: [...r.left], right: [...r.right] }))
  };
  return okResult(out, diags, steps);
}

/* ------------------------------------------------------------------ */
/* Chomsky normal form (6.4.1)                                         */
/* ------------------------------------------------------------------ */

/** Every rule is A → a or A → BC (no ε at all). */
export function isCNF(g: Grammar): boolean {
  const nt = new Set(g.nonterminals);
  const term = new Set(g.terminals);
  return g.rules.every(
    (r) =>
      r.left.length === 1 &&
      nt.has(r.left[0]) &&
      ((r.right.length === 1 && term.has(r.right[0])) ||
        (r.right.length === 2 && nt.has(r.right[0]) && nt.has(r.right[1])))
  );
}

/**
 * Chomsky normal form, as in the lecture notes (Theorem 6.25): unit rules out, S → ε
 * dropped, the terminals of long right-hand sides replaced by new variables X_a → a,
 * and the right-hand sides longer than two broken into a chain of new variables C_1,
 * C_2, … The input must be ε-free (epsfree first) — then L(cnf(G)) = L(G) \ {ε}.
 */
export function toCNF(g: Grammar): OpResult<Grammar> {
  const notCF = needsContextFree(g, "cnf");
  if (notCF) return failResult([notCF]);
  if (!classify(g).epsilonFree) {
    return failResult([
      err(tx("grammar.cnf.needsEpsilonFree.title"), tx("grammar.cnf.needsEpsilonFree.detail"), {
        label: tx("grammar.cnf.needsEpsilonFree.fix"),
        code: `cnf(epsfree(${g.name}))`
      })
    ]);
  }

  const diags: Diagnostic[] = [];
  const steps: AlgoStep[] = [];

  // 1. unit rules
  const unit = removeUnitRules(g);
  const g1 = unit.value!;
  steps.push(...unit.steps);

  // 2. S → ε
  let rules = g1.rules.filter((r) => r.right.length > 0);
  if (rules.length < g1.rules.length) {
    diags.push(info(tx("grammar.cnf.epsilonDropped.title"), tx("grammar.cnf.epsilonDropped.detail", { start: g.start })));
    steps.push({ title: tx("grammar.cnf.step2.title"), detail: tx("grammar.cnf.step2.detail", { start: g.start }) });
  }

  const used = new Set([...g.nonterminals, ...g.terminals]);
  const nonterminals = [...g1.nonterminals];
  const terminals = new Set(g.terminals);

  // 3. a terminal in a right-hand side of length ≥ 2 → a new variable X_a → a
  const proxy = new Map<string, string>();
  for (const r of rules)
    if (r.right.length >= 2)
      for (const c of r.right)
        if (terminals.has(c) && !proxy.has(c)) {
          const sub = subscriptText(c) || String(g.terminals.indexOf(c) + 1);
          proxy.set(c, freshVariable({ base: "X", primes: 0, sub }, used));
        }
  if (proxy.size > 0) {
    const ordered = g.terminals.filter((a) => proxy.has(a));
    rules = rules.map((r) => (r.right.length >= 2 ? { left: r.left, right: r.right.map((c) => proxy.get(c) ?? c) } : r));
    for (const a of ordered) {
      nonterminals.push(proxy.get(a)!);
      rules.push({ left: [proxy.get(a)!], right: [a] });
    }
    steps.push({
      title: tx("grammar.cnf.step3.title"),
      detail: tx("grammar.cnf.step3.detail"),
      table: {
        headers: [tx("grammar.table.terminal"), tx("grammar.table.newRules")],
        rows: ordered.map((a) => [a, `${proxy.get(a)} → ${a}`])
      }
    });
  }

  // 4. A → B1 B2 … Bk (k > 2) → A → B1 C1, C1 → B2 C2, …, C(k−2) → B(k−1) Bk
  let counter = 0;
  const freshChain = () => {
    let name: string;
    do name = formatIdent({ base: "C", primes: 0, sub: String(++counter) });
    while (used.has(name));
    used.add(name);
    return name;
  };
  const out: GrammarRule[] = [];
  const rows: string[][] = [];
  for (const r of rules) {
    if (r.right.length <= 2) {
      out.push(r);
      continue;
    }
    const chain: GrammarRule[] = [];
    let left = r.left;
    for (let i = 0; i < r.right.length - 2; i++) {
      const c = freshChain();
      nonterminals.push(c);
      chain.push({ left, right: [r.right[i], c] });
      left = [c];
    }
    chain.push({ left, right: r.right.slice(-2) });
    out.push(...chain);
    rows.push([ruleToString(r), chain.map(ruleToString).join(", ")]);
  }
  if (rows.length > 0)
    steps.push({
      title: tx("grammar.cnf.step4.title"),
      detail: tx("grammar.cnf.step4.detail"),
      table: { headers: [tx("grammar.table.rule"), tx("grammar.table.newRules")], rows }
    });

  const result: Grammar = { ...g1, terminals: [...g.terminals], nonterminals, rules: out };
  if (isCNF(g)) diags.push(info(tx("grammar.cnf.already.title"), tx("grammar.cnf.already.detail")));
  return okResult(result, [...unit.diagnostics, ...diags], steps);
}
