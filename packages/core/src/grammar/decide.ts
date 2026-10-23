import { AlgoStep, err, failResult, okResult, OpResult, tx } from "../types";
import { showSymbols } from "../symbols";
import { EmptinessVerdict, FinitenessVerdict, pumpedWords, showWord, WORD_LIST_LIMIT } from "../verdict";
import { classify, Grammar, GrammarRule, removeEpsilonRules } from "./grammar";
import { removeUnitRules, removeUselessSymbols } from "./normalForm";

/**
 * The algorithmic questions of the lecture notes' chapter 8 for a context-free grammar:
 * emptiness (8.2) and finiteness (8.3).
 */

function needsContextFree(g: Grammar, op: string) {
  if (classify(g).contextFreeForm) return null;
  return err(tx("grammar.needsContextFree.title", { opKey: `opNames.${op}` }), tx("grammar.needsContextFree.detail"));
}

/** "{A, B}" in the order of the given symbol list. */
const setText = (order: string[], s: Set<string>) => {
  const members = order.filter((x) => s.has(x));
  return members.length === 0 ? "∅" : `{${members.join(", ")}}`;
};

/**
 * A shortest terminal word of each variable that derives one (the shortest in alphabetical
 * order among them): rule by rule until nothing gets shorter.
 */
export function shortestWords(g: Grammar): Map<string, string> {
  const nt = new Set(g.nonterminals);
  const best = new Map<string, string>();
  for (let changed = true; changed; ) {
    changed = false;
    for (const r of g.rules) {
      const parts = r.right.map((c) => (nt.has(c) ? best.get(c) : c));
      if (parts.some((p) => p === undefined)) continue;
      const w = parts.join("");
      const old = best.get(r.left[0]);
      if (old === undefined || w.length < old.length || (w.length === old.length && w < old)) {
        best.set(r.left[0], w);
        changed = true;
      }
    }
  }
  return best;
}

/* ------------------------------------------------------------------ */
/* Emptiness (8.2)                                                     */
/* ------------------------------------------------------------------ */

/**
 * L(G) = ∅ exactly when the start variable is useless (8.2): it derives no terminal word. The
 * variables that do are found round by round, as the removal of useless symbols (6.3.3) does:
 * B₀ = Σ, Bᵢ = Bᵢ₋₁ ∪ {A : A → α, α ∈ Bᵢ₋₁*}.
 */
export function decideEmptyGrammar(g: Grammar): OpResult<EmptinessVerdict> {
  const notCF = needsContextFree(g, "empty");
  if (notCF) return failResult([notCF]);
  const symbolOrder = [...g.nonterminals, ...g.terminals];
  let B = new Set(g.terminals);
  const rounds = [new Set(B)];
  while (true) {
    const next = new Set(B);
    for (const r of g.rules) if (r.right.every((c) => B.has(c))) next.add(r.left[0]);
    rounds.push(next);
    if (next.size === B.size) break;
    B = next;
  }
  const word = shortestWords(g).get(g.start);
  const round = rounds.findIndex((s) => s.has(g.start));
  const step: AlgoStep = {
    title: tx("decide.emptyGrammar.title"),
    detail:
      word === undefined
        ? tx("decide.emptyGrammar.detailNone", { start: g.start })
        : tx("decide.emptyGrammar.detailFound", { start: g.start, round, word: showWord(word) }),
    table: { headers: ["i", "Bᵢ"], rows: rounds.map((s, i) => [String(i), setText(symbolOrder, s)]) }
  };
  return okResult<EmptinessVerdict>(
    { kind: "verdict", question: "empty", name: "", subject: g.name, empty: word === undefined, word },
    [],
    [step]
  );
}

/* ------------------------------------------------------------------ */
/* Finiteness (8.3)                                                    */
/* ------------------------------------------------------------------ */

/** The most words kept for one variable while listing a finite language. */
const WORD_CAP = 5000;

/**
 * Finiteness (8.3). By Theorem 8.2, L is infinite exactly when it has a word w with
 * p ≤ |w| ≤ 2p, p the pumping length — and the proof of the pumping lemma (6.32) shows what
 * such a word means in the grammar: on a path of its derivation tree a variable repeats,
 * S ⇒* uAy ⇒* uvAxy ⇒* uvwxy. So the grammar is first made as that proof takes it — ε-free,
 * without unit rules, and without useless symbols, so every variable takes part in some word —
 * and then L is infinite exactly when some variable derives a sentential form with itself in
 * it, A ⇒⁺ αAβ: then vx ≠ ε, and uvᵏwxᵏy ∈ L for every k. Otherwise no variable repeats on
 * any path, every derivation tree is at most as high as the number of variables, and the
 * words are finitely many — computed variable by variable, from the ones that use no other.
 */
export function decideFiniteGrammar(g: Grammar): OpResult<FinitenessVerdict> {
  const notCF = needsContextFree(g, "finite");
  if (notCF) return failResult([notCF]);
  const prepared = removeUselessSymbols(removeUnitRules(removeEpsilonRules(g).value!).value!).value!;
  const rulesOf = (A: string) => prepared.rules.filter((r) => r.left[0] === A);
  const steps: AlgoStep[] = [
    {
      title: tx("decide.finiteGrammar.prepare.title"),
      detail: tx(prepared.rules.length === 0 ? "decide.finiteGrammar.prepare.detailEmpty" : "decide.finiteGrammar.prepare.detail"),
      table:
        prepared.rules.length === 0
          ? undefined
          : {
              headers: [tx("grammar.table.variable"), tx("decide.table.rules")],
              rows: prepared.nonterminals.map((A) => [A, rulesOf(A).map((r) => showSymbols(r.right)).join(" | ")])
            }
    }
  ];
  const verdict = (v: Omit<FinitenessVerdict, "kind" | "question" | "name" | "subject">) =>
    okResult<FinitenessVerdict>({ kind: "verdict", question: "finite", name: "", subject: g.name, ...v }, [], steps);
  if (prepared.rules.length === 0) return verdict({ finite: true, words: [], count: "0", countExact: true });

  // the variables on the right-hand sides of each variable's rules, and what they lead to
  const nt = prepared.nonterminals;
  const ntSet = new Set(nt);
  const direct = new Map(nt.map((A) => [A, nt.filter((B) => rulesOf(A).some((r) => r.right.includes(B)))]));
  const leadsTo = new Map(
    nt.map((A) => {
      const seen = new Set<string>();
      const todo = [...direct.get(A)!];
      while (todo.length > 0) {
        const B = todo.pop()!;
        if (seen.has(B)) continue;
        seen.add(B);
        todo.push(...direct.get(B)!);
      }
      return [A, seen];
    })
  );
  const repeating = nt.find((A) => leadsTo.get(A)!.has(A));
  steps.push({
    title: tx("decide.finiteGrammar.repeat.title"),
    detail:
      repeating === undefined
        ? tx("decide.finiteGrammar.repeat.detailNone", { m: nt.length })
        : tx("decide.finiteGrammar.repeat.detailFound", {
            variable: repeating,
            variables: nt.filter((A) => leadsTo.get(A)!.has(A)).join(", ")
          }),
    table: {
      headers: [tx("grammar.table.variable"), tx("decide.table.onRight"), tx("decide.table.leadsTo")],
      rows: nt.map((A) => [A, direct.get(A)!.join(", ") || "—", setText(nt, leadsTo.get(A)!)])
    }
  });

  const best = shortestWords(prepared);
  if (repeating !== undefined) {
    const A = repeating;
    const form = (from: string, to: string, atLeastOneStep: boolean) => derive(prepared, from, to, atLeastOneStep);
    const outer = form(prepared.start, A, false);
    const inner = form(A, A, true);
    const wordOf = (symbols: string[]) => symbols.map((c) => (ntSet.has(c) ? best.get(c)! : c)).join("");
    const pumping = {
      kind: "contextFree" as const,
      u: wordOf(outer.before),
      v: wordOf(inner.before),
      w: best.get(A)!,
      x: wordOf(inner.after),
      y: wordOf(outer.after),
      variable: A
    };
    steps.push({
      title: tx("decide.finiteGrammar.pump.title"),
      detail: tx("decide.finiteGrammar.pump.detail", {
        start: prepared.start,
        outer: showSymbols([...outer.before, A, ...outer.after]),
        variable: A,
        inner: showSymbols([...inner.before, A, ...inner.after]),
        u: showWord(pumping.u),
        v: showWord(pumping.v),
        w: pumping.w,
        x: showWord(pumping.x),
        y: showWord(pumping.y),
        words: pumpedWords(pumping).map(showWord).join(", ")
      })
    });
    return verdict({ finite: false, pumping });
  }

  // no variable repeats: the words of each variable, from the ones that use no other
  const words = new Map<string, Set<string>>();
  let capped = false;
  const wordsOf = (A: string): Set<string> => {
    if (words.has(A)) return words.get(A)!;
    const out = new Set<string>();
    for (const r of rulesOf(A)) {
      let acc = [""];
      for (const c of r.right) {
        const options = ntSet.has(c) ? [...wordsOf(c)] : [c];
        const next: string[] = [];
        for (const x of acc) for (const y of options) if (next.length < WORD_CAP) next.push(x + y);
        if (acc.length * options.length > WORD_CAP) capped = true;
        acc = next;
      }
      for (const w of acc) {
        if (out.size < WORD_CAP) out.add(w);
        else if (!out.has(w)) capped = true;
      }
    }
    words.set(A, out);
    return out;
  };
  const all = [...wordsOf(prepared.start)].sort((x, y) => x.length - y.length || (x < y ? -1 : x > y ? 1 : 0));
  steps.push({
    title: tx("decide.finiteGrammar.words.title"),
    detail: tx(capped ? "decide.finiteGrammar.words.detailCapped" : "decide.finiteGrammar.words.detail", { count: all.length })
  });
  return verdict({ finite: true, words: all.slice(0, WORD_LIST_LIMIT), count: String(all.length), countExact: !capped });
}

/**
 * A derivation from the variable `from` to a sentential form with `to` in it, along a
 * shortest chain of rules (at least one rule when asked): the symbols before and after that
 * occurrence of `to`.
 */
function derive(g: Grammar, from: string, to: string, atLeastOneStep: boolean): { before: string[]; after: string[] } {
  if (from === to && !atLeastOneStep) return { before: [], after: [] };
  // breadth-first over the variables; each is reached by a rule and a position in it
  const via = new Map<string, { parent: string; rule: GrammarRule; at: number }>();
  const queue = [from];
  const reached = new Set<string>();
  while (queue.length > 0) {
    const B = queue.shift()!;
    for (const r of g.rules) {
      if (r.left[0] !== B) continue;
      r.right.forEach((c, at) => {
        if (!g.nonterminals.includes(c) || reached.has(c)) return;
        reached.add(c);
        via.set(c, { parent: B, rule: r, at });
        queue.push(c);
      });
    }
    if (reached.has(to)) break;
  }
  // the chain of rules, from `from` to `to`
  const chain: { rule: GrammarRule; at: number }[] = [];
  for (let C = to; ; ) {
    const v = via.get(C)!;
    chain.unshift({ rule: v.rule, at: v.at });
    C = v.parent;
    if (C === from) break;
  }
  let before: string[] = [];
  let after: string[] = [];
  for (const { rule, at } of chain) {
    before = [...before, ...rule.right.slice(0, at)];
    after = [...rule.right.slice(at + 1), ...after];
  }
  return { before, after };
}
