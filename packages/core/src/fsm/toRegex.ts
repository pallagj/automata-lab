import { AlgoStep, EPS, err, failResult, OpResult, tx } from "../types";
import { AnimFrame, AnimTable } from "./animation";
import { FSM } from "./fsm";
import { RegexDef, regexValue } from "./regex";

/**
 * Finite automaton → regular expression with the r(p, q, t) dynamic programming
 * (Kleene's construction). The states are numbered 1…n, the start state is 1, and
 * r(p, q, t) describes the words leading from p to q whose intermediate states are
 * all among 1…t:
 *
 *   r(p, q, 0) = the letters on the p → q edges (+ ε if p = q), ∅ if there are none
 *   r(p, q, t) = r(p, q, t−1) + r(p, t, t−1) r(t, t, t−1)* r(t, q, t−1)
 *
 * and the language is the sum of r(1, q, n) over the accepting states q. It works
 * for NFAs and ε-NFAs as well: an ε-edge contributes ε to r(p, q, 0).
 *
 * The expressions are simplified along the way with identities that always hold
 * (∅ + r = r, r∅ = ∅, εr = r, (a + ε)* = a*, (a + ε)a* = a*, b + a*b = a*b, …) —
 * without them the result would grow exponentially.
 */

type RNode =
  | { t: "empty"; key: string; nullable: boolean }
  | { t: "eps"; key: string; nullable: boolean }
  | { t: "lit"; c: string; key: string; nullable: boolean }
  | { t: "cat"; items: RNode[]; key: string; nullable: boolean }
  | { t: "alt"; items: RNode[]; key: string; nullable: boolean }
  | { t: "star"; a: RNode; key: string; nullable: boolean };

const EMPTY: RNode = { t: "empty", key: "∅", nullable: false };
const EPSILON: RNode = { t: "eps", key: EPS, nullable: true };

/** Characters the regex parser would read as syntax — written with a backslash. */
const SPECIAL = new Set(["(", ")", "|", "+", "*", "?", "ε", "∅", "\\"]);

/** Longest intermediate expression we are willing to build. */
const MAX_LENGTH = 3000;

/** Beyond this many states the r(p, q, t) table is too big to follow on screen: no animation. */
const ANIMATION_LIMIT = 6;

function lit(c: string): RNode {
  return { t: "lit", c, key: SPECIAL.has(c) ? `\\${c}` : c, nullable: false };
}

/** The node's factors as a concatenation (a non-concatenation is a single factor). */
const factors = (n: RNode): RNode[] => (n.t === "cat" ? n.items : [n]);

/**
 * Smart constructors with simplification. Every rewrite keeps the language exactly;
 * `contains` only answers "yes" when the inclusion really holds (it may miss some).
 */
class RegexAlgebra {
  private memo = new Map<string, boolean>();

  /** L(t) ⊆ L(s)? Sound but incomplete. */
  contains(s: RNode, t: RNode): boolean {
    if (t.t === "empty" || s.key === t.key) return true;
    if (t.t === "eps") return s.nullable;
    if (s.t === "empty" || s.t === "eps") return false;
    const k = `${s.key}\u0000${t.key}`;
    const hit = this.memo.get(k);
    if (hit !== undefined) return hit;
    const r = this.containsUncached(s, t);
    this.memo.set(k, r);
    return r;
  }

  private containsUncached(s: RNode, t: RNode): boolean {
    if (t.t === "alt") return t.items.every((x) => this.contains(s, x));
    if (s.t === "alt" && s.items.some((x) => this.contains(x, t))) return true;
    if (s.t === "star") {
      if (this.contains(s.a, t)) return true;
      // v* ⊆ u* when v ⊆ u*;  t1…tk ⊆ u* when every ti ⊆ u*
      if (t.t === "star" && this.contains(s, t.a)) return true;
      if (t.t === "cat" && t.items.every((x) => this.contains(s, x))) return true;
    }
    if (s.t === "cat" || t.t === "cat") return this.seqContains(factors(s), factors(t));
    return false;
  }

  /**
   * t1…tm ⊆ s1…sk if the t factors can be matched in order to s factors containing
   * them, every unmatched s factor is nullable, and a starred s factor may take
   * several consecutive t factors.
   */
  private seqContains(S: RNode[], T: RNode[]): boolean {
    const memo = new Map<number, boolean>();
    const go = (i: number, j: number): boolean => {
      if (j === S.length) return i === T.length;
      const k = i * (S.length + 1) + j;
      const hit = memo.get(k);
      if (hit !== undefined) return hit;
      let r = S[j].nullable && go(i, j + 1);
      if (!r && i < T.length && this.contains(S[j], T[i])) {
        r = go(i + 1, j + 1) || (S[j].t === "star" && go(i + 1, j));
      }
      memo.set(k, r);
      return r;
    };
    return go(0, 0);
  }

  alt(xs: RNode[]): RNode {
    const flat: RNode[] = [];
    for (const x of xs) {
      if (x.t === "alt") flat.push(...x.items);
      else if (x.t !== "empty") flat.push(x);
    }
    const items: RNode[] = [];
    for (const x of flat) if (!items.some((y) => y.key === x.key)) items.push(x);
    // drop every term contained in another one (one at a time, so one of two equal languages stays)
    for (let i = 0; i < items.length; ) {
      if (items.some((s, j) => j !== i && this.contains(s, items[i]))) items.splice(i, 1);
      else i++;
    }
    // ε goes last, as in "a + b + ε"
    items.sort((a, b) => Number(a.t === "eps") - Number(b.t === "eps"));
    if (items.length === 0) return EMPTY;
    if (items.length === 1) return items[0];
    return {
      t: "alt",
      items,
      key: items.map((x) => x.key).join("+"),
      nullable: items.some((x) => x.nullable)
    };
  }

  cat(xs: RNode[]): RNode {
    const items: RNode[] = [];
    for (const x of xs) {
      if (x.t === "empty") return EMPTY;
      if (x.t === "cat") items.push(...x.items);
      else if (x.t !== "eps") items.push(x);
    }
    // x y* = y* when ε ∈ x and x ⊆ y* (e.g. (a + ε)a* = a*, a*a* = a*); symmetrically y* x = y*
    let changed = true;
    while (changed) {
      changed = false;
      for (let i = 0; i + 1 < items.length; i++) {
        const [x, y] = [items[i], items[i + 1]];
        if (y.t === "star" && x.nullable && this.contains(y, x)) {
          items.splice(i, 2, y);
          changed = true;
          break;
        }
        if (x.t === "star" && y.nullable && this.contains(x, y)) {
          items.splice(i, 2, x);
          changed = true;
          break;
        }
      }
    }
    if (items.length === 0) return EPSILON;
    if (items.length === 1) return items[0];
    return {
      t: "cat",
      items,
      key: items.map((x) => (x.t === "alt" ? `(${x.key})` : x.key)).join(""),
      nullable: items.every((x) => x.nullable)
    };
  }

  star(a: RNode): RNode {
    if (a.t === "empty" || a.t === "eps") return EPSILON;
    if (a.t === "star") return a;
    // (x1…xk)* = (x1 + … + xk)* when every xi is nullable
    if (a.t === "cat" && a.nullable) return this.star(this.alt(a.items));
    if (a.t === "alt") {
      // (ε + r)* = r*,  (u* + r)* = (u + r)*,  (xy + r)* = (x + y + r)* for nullable x, y
      const inner = this.alt(
        a.items
          .filter((x) => x.t !== "eps")
          .map((x) => (x.t === "star" ? x.a : x.t === "cat" && x.nullable ? this.alt(x.items) : x))
      );
      if (inner.key !== a.key) return this.star(inner);
    }
    const atomic = a.t === "lit";
    return { t: "star", a, key: atomic ? `${a.key}*` : `(${a.key})*`, nullable: true };
  }
}

/**
 * The regex as the parser reads it back: "eps" written by letters e, p, s must not
 * turn into ε, so its first letter is escaped.
 */
const show = (n: RNode): string => n.key.replace(/eps/g, "\\eps");

/** a part of r(p, q, t−1) + r(p, t, t−1) r(t, t, t−1)* r(t, q, t−1) as the formula writes it, before simplifying */
const factor = (n: RNode): string => (n.t === "alt" ? `(${show(n)})` : show(n));
const starred = (n: RNode): string =>
  n.t === "lit" || n.t === "eps" || n.t === "empty" ? `${show(n)}*` : `(${show(n)})*`;

export function fsmToRegex(f: FSM): OpResult<RegexDef> {
  const long = f.alphabet.find((c) => [...c].length !== 1);
  if (long !== undefined) {
    return failResult([
      err(tx("ops.toRegex.multiCharSymbol.title", { symbol: long }), tx("ops.toRegex.multiCharSymbol.detail"))
    ]);
  }

  const alg = new RegexAlgebra();
  const order = [f.start, ...f.states.filter((s) => s !== f.start)];
  const n = order.length;
  const index = new Map(order.map((s, i) => [s, i]));
  const label = (i: number) => (order[i] === String(i + 1) ? String(i + 1) : `${i + 1} (${order[i]})`);
  const steps: AlgoStep[] = [];

  steps.push({
    title: tx("ops.toRegex.numbering.title"),
    detail: tx("ops.toRegex.numbering.detail", { n, start: f.start }),
    table: {
      headers: [tx("ops.toRegex.table.number"), tx("ops.table.state")],
      rows: order.map((s, i) => [String(i + 1), s])
    }
  });

  const symbolOrder = (c: string) => {
    const i = f.alphabet.indexOf(c);
    return i === -1 ? f.alphabet.length : i;
  };

  // r(p, q, 0)
  let r: RNode[][] = order.map((p, i) =>
    order.map((_, j) => {
      const edges = f.transitions.filter((t) => index.get(t.from) === i && index.get(t.to) === j);
      const letters = [...new Set(edges.filter((t) => t.symbol !== EPS).map((t) => t.symbol))].sort(
        (a, b) => symbolOrder(a) - symbolOrder(b) || a.localeCompare(b)
      );
      const terms = letters.map(lit);
      if (i === j || edges.some((t) => t.symbol === EPS)) terms.push(EPSILON);
      return alg.alt(terms);
    })
  );

  const tableOf = (m: RNode[][]) => ({
    headers: ["p \\ q", ...order.map((_, j) => label(j))],
    rows: m.map((row, i) => [label(i), ...row.map(show)])
  });

  steps.push({
    title: tx("ops.toRegex.base.title"),
    detail: tx("ops.toRegex.base.detail"),
    table: tableOf(r)
  });

  // the rounds played on the automaton: its states tagged with their numbers, the ones that may be
  // passed through coloured, the table of r(p, q, t) beside it (cell (p, q) is rows[p][q + 1])
  const animate = n <= ANIMATION_LIMIT;
  const frames: AnimFrame[] = [];
  const tags = Object.fromEntries(order.map((s, i) => [s, String(i + 1)]));
  const numbered = (m: RNode[][], t: number, extra: Partial<AnimTable> = {}): AnimTable => ({
    headers: [`r(p, q, ${t})`, ...order.map((_, j) => String(j + 1))],
    rows: m.map((row, i) => [String(i + 1), ...row.map(show)]),
    ...extra
  });
  /** states 1…t may be passed through; state `next` is the one just allowed */
  const passed = (t: number, next?: number) =>
    Object.fromEntries(order.flatMap((s, i) => (i < t ? [[s, 0]] : i === next ? [[s, 1]] : [])));
  if (animate) {
    frames.push({ graph: f, caption: tx("ops.toRegex.numbering.detail", { n, start: f.start }), tags });
    frames.push({ graph: f, caption: tx("ops.toRegex.base.detail"), tags, table: numbered(r, 0) });
  }

  for (let t = 0; t < n; t++) {
    const prev = r;
    const loop = alg.star(prev[t][t]);
    r = prev.map((row, p) =>
      row.map((direct, q) => alg.alt([direct, alg.cat([prev[p][t], loop, prev[t][q]])]))
    );
    if (animate) {
      const all = order.map((_, i) => i);
      const changed = all.flatMap((p) => all.filter((q) => r[p][q].key !== prev[p][q].key).map((q) => [p, q]));
      const classes = passed(t, t);
      frames.push({
        graph: f,
        caption: tx("ops.toRegex.anim.round", { t: t + 1, prev: t, state: label(t) }),
        tags,
        classes,
        focus: [order[t]],
        table: numbered(prev, t, {
          marked: all.flatMap((i) => [[t, i + 1] as [number, number], [i, t + 1] as [number, number]])
        })
      });
      for (const [p, q] of changed) {
        const formula = `${factor(prev[p][q])} + ${factor(prev[p][t])}${starred(prev[t][t])}${factor(prev[t][q])}`;
        frames.push({
          graph: f,
          caption: tx("ops.toRegex.anim.cell", { p: p + 1, q: q + 1, t: t + 1, prev: t, formula, value: show(r[p][q]) }),
          tags,
          classes,
          focus: [order[p], order[q]],
          table: numbered(prev, t, {
            focus: [[p, q + 1]],
            marked: [
              [p, t + 1],
              [t, t + 1],
              [t, q + 1]
            ]
          })
        });
      }
      frames.push({
        graph: f,
        caption: tx(changed.length > 0 ? "ops.toRegex.anim.roundDone" : "ops.toRegex.anim.roundSame", {
          t: t + 1,
          count: changed.length
        }),
        tags,
        classes: passed(t + 1),
        table: numbered(r, t + 1, { focus: changed.map(([p, q]) => [p, q + 1] as [number, number]) })
      });
    }
    const longest = Math.max(...r.flat().map((x) => x.key.length));
    if (longest > MAX_LENGTH) {
      return failResult(
        [
          err(
            tx("ops.toRegex.tooLarge.title"),
            tx("ops.toRegex.tooLarge.detail", { limit: MAX_LENGTH, t: t + 1, n })
          )
        ],
        steps
      );
    }
    steps.push({
      title: tx("ops.toRegex.round.title", { t: t + 1, state: label(t) }),
      detail: tx("ops.toRegex.round.detail", { t: t + 1, prev: t }),
      table: tableOf(r)
    });
  }

  const accepting = order.map((_, i) => i).filter((i) => f.accept.includes(order[i]));
  const result = alg.alt(accepting.map((q) => r[0][q]));
  const pattern = show(result);
  steps.push({
    title: tx("ops.toRegex.result.title"),
    detail:
      accepting.length === 0
        ? tx("ops.toRegex.result.detailNone")
        : tx("ops.toRegex.result.detail", {
            n,
            terms: accepting.map((q) => `r(1, ${q + 1}, ${n})`).join(" + "),
            regex: pattern
          })
  });

  if (animate)
    frames.push({
      graph: f,
      caption: steps[steps.length - 1].detail!,
      tags,
      classes: passed(n),
      focus: accepting.map((q) => order[q]),
      table: numbered(r, n, { focus: accepting.map((q) => [0, q + 1] as [number, number]) })
    });

  const v = regexValue(pattern, f.name);
  return { ...v, steps, animation: animate ? { frames } : undefined };
}
