import { AlgoStep, EPS, okResult, OpResult, tx } from "../types";
import { DisjointnessVerdict, EmptinessVerdict, FinitenessVerdict, pumpedWords, showWord, WORD_LIST_LIMIT } from "../verdict";
import { analyzeFSM, epsilonClosure, FSM, reachableStates, stepStates, transMap, TransMap } from "./fsm";
import { complete, determinize, minimize } from "./ops";

/**
 * The algorithmic questions of the lecture notes' chapter 5 for a language given by a finite
 * automaton: emptiness (5.2), disjointness (5.4) and finiteness (5.5). A regular expression
 * or a regular grammar comes here as its automaton (3.20, 4.20), as 5.2 suggests.
 */

/** The most rows a search table shows: the first ones and the last. */
const MAX_ROWS = 60;

function clipRows(rows: string[][]): string[][] {
  if (rows.length <= MAX_ROWS) return rows;
  return [...rows.slice(0, MAX_ROWS - 1), rows[0].map((_, i) => (i === 0 ? "…" : "")), rows[rows.length - 1]];
}

/** "{q_0, q_1}" in the automaton's state order. */
const setText = (order: string[], s: { has(x: string): boolean }) => {
  const members = order.filter((x) => s.has(x));
  return members.length === 0 ? "∅" : `{${members.join(", ")}}`;
};

const mark = (b: boolean) => (b ? "✓" : "✗");

/**
 * A breadth-first search over a graph whose ε-edges read no letter (0-1 BFS): an ε-edge puts
 * its target at the front, so every node is reached first by a shortest word. Stops at the
 * first node where `goal` holds.
 */
function shortestWordSearch(
  start: string,
  edges: (node: string) => { symbol: string; to: string }[],
  goal: (node: string) => boolean
): { order: { node: string; word: string }[]; found: string | null } {
  const word = new Map<string, string>([[start, ""]]);
  const deque = [start];
  const done = new Set<string>();
  const order: { node: string; word: string }[] = [];
  while (deque.length > 0) {
    const node = deque.shift()!;
    if (done.has(node)) continue;
    done.add(node);
    const w = word.get(node)!;
    order.push({ node, word: w });
    if (goal(node)) return { order, found: node };
    for (const e of edges(node)) {
      if (done.has(e.to)) continue;
      const next = e.symbol === EPS ? w : w + e.symbol;
      const old = word.get(e.to);
      if (old !== undefined && old.length <= next.length) continue;
      word.set(e.to, next);
      if (e.symbol === EPS) deque.unshift(e.to);
      else deque.push(e.to);
    }
  }
  return { order, found: null };
}

/** The transitions leaving a state: ε first, then the letters in alphabet order. */
function edgesOf(f: FSM, tm: TransMap) {
  return (q: string) =>
    [EPS, ...f.alphabet].flatMap((symbol) => [...(tm.get(q)?.get(symbol) ?? [])].map((to) => ({ symbol, to })));
}

/* ------------------------------------------------------------------ */
/* Emptiness (5.2)                                                     */
/* ------------------------------------------------------------------ */

/**
 * L(M) = ∅ exactly when no accepting state can be reached from the start state (5.2). The
 * search goes breadth-first, so the labels along the path to the first accepting state make
 * a shortest word of the language.
 */
export function decideEmptyFSM(f: FSM): OpResult<EmptinessVerdict> {
  const tm = transMap(f);
  const accept = new Set(f.accept);
  const { order, found } = shortestWordSearch(f.start, edgesOf(f, tm), (q) => accept.has(q));
  const word = found === null ? undefined : order[order.length - 1].word;
  const step: AlgoStep = {
    title: tx("decide.empty.search.title"),
    detail:
      found === null
        ? tx("decide.empty.search.detailNone", { count: order.length })
        : tx("decide.empty.search.detailFound", { state: found, word: showWord(word!) }),
    table: {
      headers: [tx("decide.table.state"), tx("decide.table.word"), tx("decide.table.accepting")],
      rows: clipRows(order.map(({ node, word }) => [node, showWord(word), mark(accept.has(node))]))
    }
  };
  return okResult<EmptinessVerdict>(
    { kind: "verdict", question: "empty", name: "", subject: f.name, empty: found === null, word },
    [],
    [step]
  );
}

/* ------------------------------------------------------------------ */
/* Disjointness (5.4)                                                  */
/* ------------------------------------------------------------------ */

/**
 * L(A) ∩ L(B) = ∅ is the emptiness of the intersection (5.4): the states of its automaton are
 * the pairs (p, q) of the product construction (3.4) — a letter moves both automata, an
 * ε-transition only its own — so nondeterministic automata need no determinization. Only the
 * pairs reachable from the start pair are made, breadth-first, until one accepts in both.
 */
export function decideDisjointFSM(a: FSM, b: FSM): OpResult<DisjointnessVerdict> {
  const ta = transMap(a);
  const tb = transMap(b);
  const pairs = new Map<string, [string, string]>();
  const key = (p: string, q: string) => {
    const k = `${p}\u0000${q}`;
    if (!pairs.has(k)) pairs.set(k, [p, q]);
    return k;
  };
  const targets = (tm: TransMap, s: string, c: string) => [...(tm.get(s)?.get(c) ?? [])];
  const letters = a.alphabet.filter((c) => b.alphabet.includes(c));
  const edges = (k: string) => {
    const [p, q] = pairs.get(k)!;
    return [
      ...targets(ta, p, EPS).map((p2) => ({ symbol: EPS, to: key(p2, q) })),
      ...targets(tb, q, EPS).map((q2) => ({ symbol: EPS, to: key(p, q2) })),
      ...letters.flatMap((c) =>
        targets(ta, p, c).flatMap((p2) => targets(tb, q, c).map((q2) => ({ symbol: c, to: key(p2, q2) })))
      )
    ];
  };
  const acceptA = new Set(a.accept);
  const acceptB = new Set(b.accept);
  const both = (k: string) => acceptA.has(pairs.get(k)![0]) && acceptB.has(pairs.get(k)![1]);
  const { order, found } = shortestWordSearch(key(a.start, b.start), edges, both);
  const common = found === null ? undefined : order[order.length - 1].word;
  const pairText = (k: string) => `(${pairs.get(k)![0]}, ${pairs.get(k)![1]})`;

  const step: AlgoStep = {
    title: tx("decide.disjoint.search.title"),
    detail:
      found === null
        ? tx("decide.disjoint.search.detailNone", { count: order.length })
        : tx("decide.disjoint.search.detailFound", { pair: pairText(found), word: showWord(common!) }),
    table: {
      headers: ["(p, q)", tx("decide.table.word"), `p ∈ F(${a.name})`, `q ∈ F(${b.name})`],
      rows: clipRows(
        order.map(({ node, word }) => [
          pairText(node),
          showWord(word),
          mark(acceptA.has(pairs.get(node)![0])),
          mark(acceptB.has(pairs.get(node)![1]))
        ])
      )
    }
  };
  return okResult<DisjointnessVerdict>(
    { kind: "verdict", question: "disjoint", name: "", machineA: a.name, machineB: b.name, disjoint: found === null, common },
    [],
    [step]
  );
}

/* ------------------------------------------------------------------ */
/* Finiteness (5.5)                                                    */
/* ------------------------------------------------------------------ */

/**
 * Finiteness by Theorem 5.3: with n the number of states of the minimal automaton, L is
 * infinite exactly when it has a word w with n ≤ |w| ≤ 2n. Instead of following each of those
 * words one by one, Rₖ — the set of states some word of length k leads to (R₀ = {q₀},
 * Rₖ₊₁ = δ(Rₖ, Σ)) — checks them all at once: L has a word of length k exactly when Rₖ meets
 * F. The first such k ≥ n is the length of a shortest word with |x| ≥ n, the word of the
 * theorem's proof; reading it repeats a state within its first n letters, which cuts it as
 * the pumping lemma (3.11) does. A finite language has every word shorter than n.
 */
export function decideFiniteFSM(f: FSM): OpResult<FinitenessVerdict> {
  const a = analyzeFSM(f);
  const dfa = !a.isDeterministic ? determinize(f).value! : !a.isComplete ? complete(f).value! : f;
  const how = !a.isDeterministic ? "detMin" : !a.isComplete ? "completeMin" : "min";
  const m = minimize(dfa).value!;
  const n = m.states.length;
  const tm = transMap(m);
  const delta = (q: string, c: string) => [...(tm.get(q)!.get(c)!)][0];
  const accept = new Set(m.accept);

  const steps: AlgoStep[] = [
    {
      title: tx("decide.finite.min.title"),
      detail: tx(`decide.finite.min.${how}`, { n }),
      table: {
        headers: [tx("decide.table.state"), ...m.alphabet],
        rows: m.states.map((q) => [
          `${q === m.start ? "→ " : ""}${q}${accept.has(q) ? " ✓" : ""}`,
          ...m.alphabet.map((c) => delta(q, c))
        ])
      }
    }
  ];

  // levels[k]: state → the state and letter it is first reached from, among words of length k
  const levels: Map<string, { from: string; letter: string } | null>[] = [new Map([[m.start, null]])];
  const rows: string[][] = [];
  let hit: { k: number; state: string } | null = null;
  for (let k = 0; ; k++) {
    const R = levels[k];
    const meet = m.states.filter((q) => R.has(q) && accept.has(q));
    rows.push([String(k), setText(m.states, R), setText(m.states, new Set(meet))]);
    if (k >= n && meet.length > 0) {
      hit = { k, state: meet[0] };
      break;
    }
    if (k === 2 * n) break;
    const next = new Map<string, { from: string; letter: string }>();
    for (const q of m.states)
      if (R.has(q))
        for (const c of m.alphabet) {
          const p = delta(q, c);
          if (!next.has(p)) next.set(p, { from: q, letter: c });
        }
    levels.push(next);
  }

  if (hit === null) {
    steps.push({
      title: tx("decide.finite.lengths.title"),
      detail: tx("decide.finite.lengths.detailNone", { n, twoN: 2 * n }),
      table: { headers: ["k", "Rₖ", "Rₖ ∩ F"], rows: clipRows(rows) }
    });
    const count = countDfaWords(m, n - 1);
    const words = shortlexWords(m, WORD_LIST_LIMIT, n - 1);
    steps.push({
      title: tx("decide.finite.words.title"),
      detail: tx(count === 0n ? "decide.finite.words.detailEmpty" : "decide.finite.words.detail", { n, count: count.toString() })
    });
    return okResult<FinitenessVerdict>(
      { kind: "verdict", question: "finite", name: "", subject: f.name, finite: true, words, count: count.toString(), countExact: true },
      [],
      steps
    );
  }

  // the word: back from the accepting state, level by level
  let word = "";
  let state = hit.state;
  for (let k = hit.k; k > 0; k--) {
    const { from, letter } = levels[k].get(state)!;
    word = letter + word;
    state = from;
  }
  steps.push({
    title: tx("decide.finite.lengths.title"),
    detail: tx("decide.finite.lengths.detailFound", { n, twoN: 2 * n, k: hit.k, word }),
    table: { headers: ["k", "Rₖ", "Rₖ ∩ F"], rows: clipRows(rows) }
  });

  // the run on the word repeats a state within its first n letters: x = uvw with |uv| ≤ n
  const run = [m.start];
  for (const c of word) run.push(delta(run[run.length - 1], c));
  let i = 0;
  let j = 1;
  search: for (j = 1; j <= n; j++)
    for (i = 0; i < j; i++) if (run[i] === run[j]) break search;
  const pumping = { kind: "regular" as const, u: word.slice(0, i), v: word.slice(i, j), w: word.slice(j), state: run[i] };
  steps.push({
    title: tx("decide.finite.pump.title"),
    detail: tx("decide.finite.pump.detail", {
      word,
      state: run[i],
      u: showWord(pumping.u),
      v: pumping.v,
      w: showWord(pumping.w),
      words: pumpedWords(pumping).map(showWord).join(", ")
    })
  });
  return okResult<FinitenessVerdict>(
    { kind: "verdict", question: "finite", name: "", subject: f.name, finite: false, pumping },
    [],
    steps
  );
}

/** The number of words of length at most `maxLength` a DFA accepts: its paths, counted level by level. */
function countDfaWords(m: FSM, maxLength: number): bigint {
  const tm = transMap(m);
  let level = new Map<string, bigint>([[m.start, 1n]]);
  let total = 0n;
  for (let k = 0; k <= maxLength; k++) {
    for (const q of m.accept) total += level.get(q) ?? 0n;
    const next = new Map<string, bigint>();
    for (const [q, c] of level)
      for (const a of m.alphabet)
        for (const p of tm.get(q)?.get(a) ?? []) next.set(p, (next.get(p) ?? 0n) + c);
    level = next;
  }
  return total;
}

/* ------------------------------------------------------------------ */
/* Words of the language, and its size by the graph                    */
/* ------------------------------------------------------------------ */

/**
 * The first `maxCount` words of L(M) in shortlex order (by length, then letter by letter in
 * the alphabet's order) among those at most `maxLength` long. A prefix is followed only while
 * some accepting state can still be reached with exactly the letters left, so every branch
 * ends in a word and a long word costs no more than its own length.
 */
export function shortlexWords(f: FSM, maxCount: number, maxLength: number): string[] {
  const tm = transMap(f);
  const accept = new Set(f.accept);
  const closure = new Map(f.states.map((q) => [q, epsilonClosure(f, [q], tm)]));
  // finish[r]: the states from which exactly r more letters can end in an accepting state
  const finish: Set<string>[] = [new Set(f.states.filter((q) => [...closure.get(q)!].some((p) => accept.has(p))))];
  for (let r = 1; r <= maxLength; r++) {
    const prev = finish[r - 1];
    const can = (p: string) => f.alphabet.some((c) => [...(tm.get(p)?.get(c) ?? [])].some((t) => prev.has(t)));
    finish.push(new Set(f.states.filter((q) => [...closure.get(q)!].some(can))));
    if (finish[r].size === 0) break; // and so are all the longer ones
  }

  const out: string[] = [];
  const start = epsilonClosure(f, [f.start], tm);
  const visit = (states: Set<string>, word: string, left: number) => {
    if (out.length >= maxCount || !finish[left] || ![...states].some((q) => finish[left].has(q))) return;
    if (left === 0) {
      out.push(word);
      return;
    }
    for (const c of f.alphabet) visit(stepStates(f, states, c, tm), word + c, left - 1);
  };
  for (let len = 0; len < finish.length && out.length < maxCount; len++) visit(start, "", len);
  return out;
}

/**
 * Whether L(M) is empty, and whether it is finite, read off the graph: the useful states are
 * reachable from the start and lead to an accepting state; the language is infinite exactly
 * when a cycle through useful states reads a letter. (A second method beside 5.2 and 5.3, for
 * the views; the tests check the two against each other.)
 */
export function languageFacts(f: FSM): { empty: boolean; finite: boolean } {
  const reach = reachableStates(f);
  const back = new Map<string, string[]>();
  for (const t of f.transitions) back.set(t.to, [...(back.get(t.to) ?? []), t.from]);
  const coReach = new Set(f.accept);
  const stack = [...coReach];
  while (stack.length > 0)
    for (const p of back.get(stack.pop()!) ?? [])
      if (!coReach.has(p)) {
        coReach.add(p);
        stack.push(p);
      }
  if (!coReach.has(f.start)) return { empty: true, finite: true };

  const useful = (q: string) => reach.has(q) && coReach.has(q);
  const out = new Map<string, string[]>();
  for (const t of f.transitions)
    if (useful(t.from) && useful(t.to)) out.set(t.from, [...(out.get(t.from) ?? []), t.to]);
  const reachedFrom = new Map<string, Set<string>>();
  const reachableFrom = (q: string) => {
    if (!reachedFrom.has(q)) {
      const seen = new Set([q]);
      const todo = [q];
      while (todo.length > 0)
        for (const p of out.get(todo.pop()!) ?? [])
          if (!seen.has(p)) {
            seen.add(p);
            todo.push(p);
          }
      reachedFrom.set(q, seen);
    }
    return reachedFrom.get(q)!;
  };
  const infinite = f.transitions.some(
    (t) => t.symbol !== EPS && useful(t.from) && useful(t.to) && reachableFrom(t.to).has(t.from)
  );
  return { empty: false, finite: !infinite };
}

/** The most words a summary counts one by one. */
const COUNT_CAP = 1000;

/** What a view shows of a language: its first words, and exactly whether it is empty, finite, and how large. */
export interface LanguageSummary {
  /** the first words in shortlex order ("" = ε) */
  words: string[];
  empty: boolean;
  finite: boolean;
  /** finite: the number of words — at least this many when !countExact */
  count?: number;
  countExact?: boolean;
}

/**
 * The first `shown` words of L(M) with the exact facts about it. A finite language has no
 * word as long as the automaton has states (that word would pump), so its words are counted
 * up to that length.
 */
export function languageSummary(f: FSM, shown: number): LanguageSummary {
  const facts = languageFacts(f);
  if (facts.empty) return { words: [], empty: true, finite: true, count: 0, countExact: true };
  if (!facts.finite) return { words: shortlexWords(f, shown, 64), empty: false, finite: false };
  const all = shortlexWords(f, COUNT_CAP + 1, f.states.length);
  return {
    words: all.slice(0, shown),
    empty: false,
    finite: true,
    count: Math.min(all.length, COUNT_CAP),
    countExact: all.length <= COUNT_CAP
  };
}
