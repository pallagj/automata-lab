import { EPS, err, failResult, I18nText, okResult, OpResult, tx } from "../types";
import { FSM, makeFSM } from "./fsm";
import { regexEpsilonWords } from "../epsilon";

class RegexSyntaxError extends Error {
  constructor(public i18n: I18nText) {
    super(i18n.key);
  }
}

/**
 * Regular expression → ε-NFA (Thompson construction).
 * Supported: letter/digit literals, ε, ∅, concatenation, | or + (union),
 * * (star), ? (optional), parentheses.
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
  accept: string;
}

class Builder {
  counter = 0;
  states: string[] = [];
  transitions: { from: string; symbol: string; to: string }[] = [];
  alphabet = new Set<string>();

  newState(): string {
    const s = `q${this.counter++}`;
    this.states.push(s);
    return s;
  }

  add(from: string, symbol: string, to: string) {
    this.transitions.push({ from, symbol, to });
  }

  build(node: Node): Frag {
    switch (node.t) {
      case "empty": {
        const s = this.newState();
        const a = this.newState();
        return { start: s, accept: a }; // no transition — empty language
      }
      case "eps": {
        const s = this.newState();
        const a = this.newState();
        this.add(s, EPS, a);
        return { start: s, accept: a };
      }
      case "lit": {
        const s = this.newState();
        const a = this.newState();
        this.alphabet.add(node.c);
        this.add(s, node.c, a);
        return { start: s, accept: a };
      }
      case "cat": {
        const fa = this.build(node.a);
        const fb = this.build(node.b);
        this.add(fa.accept, EPS, fb.start);
        return { start: fa.start, accept: fb.accept };
      }
      case "alt": {
        const s = this.newState();
        const a = this.newState();
        const fa = this.build(node.a);
        const fb = this.build(node.b);
        this.add(s, EPS, fa.start);
        this.add(s, EPS, fb.start);
        this.add(fa.accept, EPS, a);
        this.add(fb.accept, EPS, a);
        return { start: s, accept: a };
      }
      case "star": {
        const s = this.newState();
        const a = this.newState();
        const fa = this.build(node.a);
        this.add(s, EPS, fa.start);
        this.add(s, EPS, a);
        this.add(fa.accept, EPS, fa.start);
        this.add(fa.accept, EPS, a);
        return { start: s, accept: a };
      }
      case "opt": {
        const s = this.newState();
        const a = this.newState();
        const fa = this.build(node.a);
        this.add(s, EPS, fa.start);
        this.add(s, EPS, a);
        this.add(fa.accept, EPS, a);
        return { start: s, accept: a };
      }
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

/** Spaces are ignored and whole "eps"/"epsilon" words mean ε. */
const clean = (pattern: string) => regexEpsilonWords(pattern.replaceAll(" ", ""));

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
    accept: [frag.accept],
    transitions: b.transitions
  });
  return okResult(fsm, [], [
    {
      title: tx("regex.step.thompson.title"),
      detail: tx("regex.step.thompson.detail", { count: b.states.length })
    }
  ]);
}
