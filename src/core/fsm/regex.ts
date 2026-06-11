import { EPS, err, failResult, okResult, OpResult } from "../types";
import { FSM, makeFSM } from "./fsm";

/**
 * Reguláris kifejezés → ε-NFA (Thompson-konstrukció).
 * Támogatott: betű/számjegy literál, ε, ∅, összefűzés, | vagy + (unió),
 * * (csillag), ? (opcionális), zárójelezés.
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
      throw new Error(`Váratlan karakter a(z) ${this.pos + 1}. pozíción: „${this.peek()}”`);
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
    if (c === undefined) throw new Error("A kifejezés váratlanul véget ért.");
    if (c === "(") {
      this.eat();
      const node = this.parseAlt();
      if (this.peek() !== ")") throw new Error(`Hiányzó záró zárójel a(z) ${this.pos + 1}. pozíción.`);
      this.eat();
      return node;
    }
    if (c === ")") throw new Error(`Pár nélküli záró zárójel a(z) ${this.pos + 1}. pozíción.`);
    if (c === "*" || c === "?") throw new Error(`A(z) „${c}” operátor előtt kifejezésnek kell állnia (${this.pos + 1}. pozíció).`);
    if (c === "ε" || c === "$") {
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
        return { start: s, accept: a }; // nincs átmenet — üres nyelv
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

/** Reguláris kifejezés mint önálló érték — automatává a toFsm() alakítja. */
export interface RegexDef {
  kind: "regex";
  name: string;
  pattern: string;
}

function parseOrFail(pattern: string): { ast?: Node; error?: string } {
  try {
    return { ast: new Parser(pattern).parse() };
  } catch (e) {
    return {
      error:
        (e as Error).message +
        " — Támogatott jelölés: literálok, ε, összefűzés, | vagy + (unió), * (ismétlés), ? (opcionális), zárójelek."
    };
  }
}

/** Regex-érték létrehozása szintaktikai ellenőrzéssel. */
export function regexValue(pattern: string, name = "R"): OpResult<RegexDef> {
  const cleaned = pattern.replaceAll(" ", "");
  const p = parseOrFail(cleaned);
  if (p.error) return failResult([err("Hibás reguláris kifejezés", p.error)]);
  return okResult({ kind: "regex", name, pattern: cleaned });
}

/** A kifejezés szerkezeti fája az elemző-nézethez. */
export interface RegexNodeInfo {
  label: string;
  children: RegexNodeInfo[];
}

function nodeInfo(n: Node): RegexNodeInfo {
  switch (n.t) {
    case "empty":
      return { label: "∅ — üres nyelv", children: [] };
    case "eps":
      return { label: "ε — üres szó", children: [] };
    case "lit":
      return { label: `„${n.c}” betű`, children: [] };
    case "cat":
      return { label: "összefűzés", children: [nodeInfo(n.a), nodeInfo(n.b)] };
    case "alt":
      return { label: "unió ( | )", children: [nodeInfo(n.a), nodeInfo(n.b)] };
    case "star":
      return { label: "lezárás ( * )", children: [nodeInfo(n.a)] };
    case "opt":
      return { label: "opcionális ( ? )", children: [nodeInfo(n.a)] };
  }
}

export function regexTree(pattern: string): RegexNodeInfo | null {
  const p = parseOrFail(pattern.replaceAll(" ", ""));
  return p.ast ? nodeInfo(p.ast) : null;
}

export function regexToNFA(pattern: string, name = "R"): OpResult<FSM> {
  const cleaned = pattern.replaceAll(" ", "");
  const p = parseOrFail(cleaned);
  if (p.error) return failResult([err("Hibás reguláris kifejezés", p.error)]);
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
      title: "Thompson-konstrukció",
      detail: `A reguláris kifejezés szerkezeti felépítését követve minden részkifejezéshez kis ε-NFA-darabot építünk (literál, unió, összefűzés, csillag), majd ezeket ε-átmenetekkel kapcsoljuk össze. Eredmény: ${b.states.length} állapot. A det(epsfree(·)) lánccal DFA-vá alakítható.`
    }
  ]);
}
