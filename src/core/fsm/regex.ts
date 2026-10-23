import { EPS, err, failResult, I18nText, okResult, OpResult, tx } from "../types";
import { FSM, FSMTransition, makeFSM } from "./fsm";
import { AnimFrame, ANIMATION_STATE_LIMIT, transKey } from "./animation";
import { epsilonWords } from "../epsilon";
import { formatIdent } from "../symbols";

class RegexSyntaxError extends Error {
  constructor(public i18n: I18nText) {
    super(i18n.key);
  }
}

/**
 * Regular expression → ε-NFA, built as lecture notes 3.20 proves the expression's language
 * regular: small automata for a letter, ε and ∅ (3.3), then for r₁ + r₂ the union (3.4), for
 * r₁r₂ the concatenation (3.9) and for r* the closure (3.10). The animation draws the automata
 * of the subexpressions side by side, each with its own start and accepting states, until
 * they are joined.
 * Supported: letter/digit literals, ε, ∅, concatenation, | or + (union),
 * * (star), ? (optional: r? is r + ε), parentheses.
 */

type Node =
  | { t: "empty" } // ∅
  | { t: "eps" }
  | { t: "lit"; c: string }
  | { t: "cat"; a: Node; b: Node }
  | { t: "alt"; a: Node; b: Node }
  | { t: "star"; a: Node }
  | { t: "opt"; a: Node };

class Parser {
  pos = 0;
  constructor(public src: string) {}

  peek(): string | undefined {
    return this.src[this.pos];
  }
  eat(): string {
    return this.src[this.pos++];
  }

  parse(): Node {
    const node = this.parseAlt();
    if (this.pos < this.src.length) {
      throw new RegexSyntaxError(tx("regex.error.unexpectedChar", { pos: this.pos + 1, char: this.peek() ?? "" }));
    }
    return node;
  }

  parseAlt(): Node {
    let node = this.parseCat();
    while (this.peek() === "|" || this.peek() === "+") {
      this.eat();
      node = { t: "alt", a: node, b: this.parseCat() };
    }
    return node;
  }

  parseCat(): Node {
    let node: Node | null = null;
    while (true) {
      const c = this.peek();
      if (c === undefined || c === ")" || c === "|" || c === "+") break;
      const next = this.parsePostfix();
      node = node === null ? next : { t: "cat", a: node, b: next };
    }
    return node ?? { t: "eps" };
  }

  parsePostfix(): Node {
    let node = this.parseAtom();
    while (true) {
      const c = this.peek();
      if (c === "*") {
        this.eat();
        node = { t: "star", a: node };
      } else if (c === "?") {
        this.eat();
        node = { t: "opt", a: node };
      } else break;
    }
    return node;
  }

  parseAtom(): Node {
    const c = this.peek();
    if (c === undefined) throw new RegexSyntaxError(tx("regex.error.unexpectedEnd"));
    if (c === "(") {
      this.eat();
      const node = this.parseAlt();
      if (this.peek() !== ")") throw new RegexSyntaxError(tx("regex.error.missingCloseParen", { pos: this.pos + 1 }));
      this.eat();
      return node;
    }
    if (c === ")") throw new RegexSyntaxError(tx("regex.error.unmatchedCloseParen", { pos: this.pos + 1 }));
    if (c === "*" || c === "?")
      throw new RegexSyntaxError(tx("regex.error.operatorNeedsExpr", { op: c, pos: this.pos + 1 }));
    if (c === "ε") {
      this.eat();
      return { t: "eps" };
    }
    if (c === "\\") {
      // escaped character: taken literally, e.g. \eps is the letters e, p, s
      this.eat();
      const lit = this.peek();
      if (lit === undefined) throw new RegexSyntaxError(tx("regex.error.unexpectedEnd"));
      this.eat();
      return { t: "lit", c: lit };
    }
    if (c === "∅") {
      this.eat();
      return { t: "empty" };
    }
    this.eat();
    return { t: "lit", c };
  }
}

interface Frag {
  start: string;
  accept: string[];
}

/** The expression as written, with parentheses only where they are needed. */
function show(n: Node): string {
  const atom = (x: Node) => (x.t === "lit" || x.t === "eps" || x.t === "empty" || x.t === "star" || x.t === "opt" ? show(x) : `(${show(x)})`);
  switch (n.t) {
    case "empty":
      return "∅";
    case "eps":
      return EPS;
    case "lit":
      return SPECIAL.has(n.c) ? `\\${n.c}` : n.c;
    case "alt":
      return `${show(n.a)}+${show(n.b)}`;
    case "cat":
      return [n.a, n.b].map((x) => (x.t === "alt" ? `(${show(x)})` : show(x))).join("");
    case "star":
      return `${atom(n.a)}*`;
    case "opt":
      return `${atom(n.a)}?`;
  }
}
const SPECIAL = new Set(["(", ")", "|", "+", "*", "?", "ε", "∅", "\\"]);

/** An automaton built for a subexpression and not yet joined into a bigger one. */
interface Built {
  node: Node;
  frag: Frag;
  states: string[];
  /** how many transitions there were when it was done: its parts', then its own */
  end: number;
}

class Builder {
  counter = 0;
  states: string[] = [];
  transitions: FSMTransition[] = [];
  alphabet = new Set<string>();
  /** one row per subexpression, inside out: the expression, what it adds, start, accepting */
  rows: string[][] = [];
  /** the automata built and not joined yet, in order: the animation draws each one on its own */
  live: Built[] = [];
  /** one frame per subexpression (the graph is added once it is complete); null once too big to watch */
  frames: Omit<AnimFrame, "graph">[] | null = [];

  newState(): string {
    // q_0, q_1, …, q_{10}: names, written canonically
    const s = formatIdent({ base: "q", primes: 0, sub: String(this.counter++) });
    this.states.push(s);
    return s;
  }

  add(from: string, symbol: string, to: string) {
    this.transitions.push({ from, symbol, to });
  }

  /** The automaton of a subexpression, made of its parts' automata, recorded as a row and a frame. */
  build(node: Node): Frag {
    const mark = { states: this.states.length, transitions: this.transitions.length, live: this.live.length };
    const f = this.make(node);
    const parts = this.live.splice(mark.live);
    const states = this.states.slice(mark.states);
    // its own transitions come after its parts'
    const own = this.transitions.slice(parts.length ? parts[parts.length - 1].end : mark.transitions);
    this.rows.push([
      show(node),
      own.map((t) => `${t.from} →${t.symbol} ${t.to}`).join(", ") || "—",
      f.start,
      f.accept.join(", ") || "∅"
    ]);
    this.live.push({ node, frag: f, states, end: this.transitions.length });
    if (this.frames && this.states.length > ANIMATION_STATE_LIMIT) this.frames = null;
    this.frames?.push({
      caption: caption(node, f, parts),
      // every automaton not joined yet: its states in its own colour, its start tagged with its expression
      shown: this.live.flatMap((b) => b.states),
      edges: this.transitions.map((t) => transKey(t.from, t.symbol, t.to)),
      start: this.live.map((b) => b.frag.start),
      accept: this.live.flatMap((b) => b.frag.accept),
      classes: Object.fromEntries(this.live.flatMap((b, i) => b.states.map((st) => [st, i]))),
      tags: Object.fromEntries(this.live.map((b) => [b.frag.start, show(b.node)])),
      focus: states.filter((st) => !parts.some((b) => b.states.includes(st))),
      focusEdges: own.map((t) => transKey(t.from, t.symbol, t.to))
    });
    return f;
  }

  private make(node: Node): Frag {
    switch (node.t) {
      case "empty":
        // one state, not accepting: no word is accepted
        return { start: this.newState(), accept: [] };
      case "eps": {
        // one accepting state and no transition: only ε
        const s = this.newState();
        return { start: s, accept: [s] };
      }
      case "lit": {
        const s = this.newState();
        const a = this.newState();
        this.alphabet.add(node.c);
        this.add(s, node.c, a);
        return { start: s, accept: [a] };
      }
      case "alt":
      case "opt": {
        // a new start state, ε-transitions into both start states, accepting where either accepts
        const s = this.newState();
        const fa = this.build(node.a);
        const fb = this.build(node.t === "alt" ? node.b : { t: "eps" });
        this.add(s, EPS, fa.start);
        this.add(s, EPS, fb.start);
        return { start: s, accept: [...fa.accept, ...fb.accept] };
      }
      case "cat": {
        // ε-transitions from the first one's accepting states into the second one's start
        const fa = this.build(node.a);
        const fb = this.build(node.b);
        for (const x of fa.accept) this.add(x, EPS, fb.start);
        return { start: fa.start, accept: fb.accept };
      }
      case "star": {
        // a new accepting start state, ε into the old start, ε back from the accepting states
        const s = this.newState();
        const fa = this.build(node.a);
        this.add(s, EPS, fa.start);
        for (const x of fa.accept) this.add(x, EPS, s);
        return { start: s, accept: [s] };
      }
    }
  }
}

/** What a subexpression's frame says: how its automaton is made of its parts' automata. */
function caption(node: Node, f: Frag, parts: Built[]): I18nText {
  const expr = show(node);
  const accept = f.accept.join(", ") || "∅";
  switch (node.t) {
    case "empty":
      return tx("regex.anim.empty", { start: f.start });
    case "eps":
      return tx("regex.anim.eps", { start: f.start });
    case "lit":
      return tx("regex.anim.lit", { expr, letter: node.c, start: f.start, accept });
    case "alt":
    case "opt": {
      const [a, b] = parts;
      return tx(`regex.anim.${node.t}`, {
        expr,
        a: show(a.node),
        b: show(b.node),
        start: f.start,
        aStart: a.frag.start,
        bStart: b.frag.start,
        accept
      });
    }
    case "cat": {
      const [a, b] = parts;
      return tx(a.frag.accept.length ? "regex.anim.cat" : "regex.anim.catNone", {
        expr,
        a: show(a.node),
        b: show(b.node),
        from: a.frag.accept.join(", "),
        bStart: b.frag.start,
        start: f.start,
        accept
      });
    }
    case "star": {
      const [a] = parts;
      return tx(a.frag.accept.length ? "regex.anim.star" : "regex.anim.starNone", {
        expr,
        a: show(a.node),
        start: f.start,
        aStart: a.frag.start,
        from: a.frag.accept.join(", ")
      });
    }
  }
}

/** A regular expression as a standalone value — toFsm() turns it into an automaton. */
export interface RegexDef {
  kind: "regex";
  name: string;
  pattern: string;
}

function parseOrFail(pattern: string): { ast?: Node; error?: I18nText } {
  try {
    return { ast: new Parser(pattern).parse() };
  } catch (e) {
    return {
      error: e instanceof RegexSyntaxError ? e.i18n : tx("regex.error.unknown", { message: String((e as Error).message ?? e) })
    };
  }
}

/** Spaces are ignored and eps/epsilon mean ε (see core/epsilon.ts). */
const clean = (pattern: string) => epsilonWords(pattern.replaceAll(" ", ""));

/** Creates a regex value with syntax checking. */
export function regexValue(pattern: string, name = "R"): OpResult<RegexDef> {
  const cleaned = clean(pattern);
  const p = parseOrFail(cleaned);
  if (p.error) return failResult([err(tx("regex.error.invalid"), p.error)]);
  return okResult({ kind: "regex", name, pattern: cleaned });
}

/** The expression's syntax tree for the analyser view. */
export interface RegexNodeInfo {
  label: I18nText;
  children: RegexNodeInfo[];
}

function nodeInfo(n: Node): RegexNodeInfo {
  switch (n.t) {
    case "empty":
      return { label: tx("regex.node.empty"), children: [] };
    case "eps":
      return { label: tx("regex.node.eps"), children: [] };
    case "lit":
      return { label: tx("regex.node.lit", { char: n.c }), children: [] };
    case "cat":
      return { label: tx("regex.node.cat"), children: [nodeInfo(n.a), nodeInfo(n.b)] };
    case "alt":
      return { label: tx("regex.node.alt"), children: [nodeInfo(n.a), nodeInfo(n.b)] };
    case "star":
      return { label: tx("regex.node.star"), children: [nodeInfo(n.a)] };
    case "opt":
      return { label: tx("regex.node.opt"), children: [nodeInfo(n.a)] };
  }
}

export function regexTree(pattern: string): RegexNodeInfo | null {
  const p = parseOrFail(clean(pattern));
  return p.ast ? nodeInfo(p.ast) : null;
}

export function regexToNFA(pattern: string, name = "R"): OpResult<FSM> {
  const cleaned = clean(pattern);
  const p = parseOrFail(cleaned);
  if (p.error) return failResult([err(tx("regex.error.invalid"), p.error)]);
  const ast = p.ast!;
  const b = new Builder();
  const frag = b.build(ast);
  const fsm = makeFSM({
    name,
    alphabet: [...b.alphabet].sort(),
    states: b.states,
    start: frag.start,
    accept: frag.accept,
    transitions: b.transitions
  });
  const animation = b.frames
    ? {
        frames: [
          { graph: fsm, caption: tx("regex.anim.start", { expr: show(ast) }), shown: [], edges: [] },
          ...b.frames.map((fr) => ({ graph: fsm, ...fr })),
          { graph: fsm, caption: tx("regex.anim.done", { expr: show(ast), count: b.states.length }) }
        ]
      }
    : undefined;
  const result = okResult(fsm, [], [
    {
      title: tx("regex.step.build.title"),
      detail: tx("regex.step.build.detail", { count: b.states.length }),
      table: {
        headers: [
          tx("regex.table.subexpression"),
          tx("regex.table.added"),
          tx("regex.table.start"),
          tx("regex.table.accepting")
        ],
        rows: b.rows
      }
    }
  ]);
  return { ...result, animation };
}
