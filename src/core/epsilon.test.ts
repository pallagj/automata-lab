import { describe, expect, it } from "vitest";
import { epsilonWords, escapeSymbols, symbolString } from "./epsilon";
import { parseGrammar, parseMachine } from "./parse/definitionParser";
import { serializeDefinition } from "./parse/serialize";
import { regexToNFA } from "./fsm/regex";
import { acceptsFSM } from "./fsm/fsm";

const grammar = (rules: string, charset = "a, b") =>
  parseGrammar(`Grammar:\n  name: G\n  charset: ${charset}\n  variables: S, A\n  init: S\n  rules:\n${rules}`);

describe("the ε rule", () => {
  it("reads eps / epsilon as ε everywhere in symbols, even inside a word", () => {
    expect(symbolString("eps")).toBe("");
    expect(symbolString("epsilon")).toBe("");
    expect(symbolString("Aeps")).toBe("A");
    expect(symbolString("εA")).toBe("A");
    expect(symbolString("aSb")).toBe("aSb");
  });

  it("keeps escaped letters: \\eps is e, p, s", () => {
    expect(symbolString("\\eps")).toBe("eps");
    expect(symbolString("a\\eps")).toBe("aeps");
    expect(epsilonWords("\\eps|eps")).toBe("\\eps|ε");
  });

  it("escaping is the inverse for literal text", () => {
    for (const s of ["eps", "aepsb", "steps", "a\\b"]) expect(symbolString(escapeSymbols(s))).toBe(s);
  });
});

describe("ε in grammars", () => {
  it("is the identity of concatenation and works in any alphabet", () => {
    const g = grammar("    - S -> εA | aSb | eps | Aeps\n    - A -> b");
    expect(g.ok).toBe(true);
    expect(g.value!.rules.map((r) => r.right.join(""))).toEqual(["A", "aSb", "", "A", "b"]);
    const eps = grammar("    - S -> eps | \\eps", "e, p, s");
    expect(eps.value!.rules.map((r) => r.right)).toEqual([[], ["e", "p", "s"]]);
  });

  it("writes literal e·p·s back escaped so it survives a round trip", () => {
    const g = grammar("    - S -> \\eps | eps", "e, p, s").value!;
    const back = parseGrammar(serializeDefinition(g)).value!;
    expect(back.rules.map((r) => r.right)).toEqual([["e", "p", "s"], []]);
  });
});

describe("ε in machines", () => {
  it("applies to transition symbols and stack operations", () => {
    const m = parseMachine(`Machine:
  name: P
  charset: a
  states: q0, q1
  init: q0
  accept: q1
  storages:
    stack: stack
  transitions:
    - q0 eps Z/Aeps q1
    - q0 a Z/epsilon q0`).value!;
    expect(m.transitions[0].input).toBe("ε");
    expect(m.transitions[0].ops[0]).toEqual({ type: "stack", pop: "Z", push: ["A"] });
    expect(m.transitions[1].ops[0]).toEqual({ type: "stack", pop: "Z", push: [] });
  });

  it("never touches state names", () => {
    const m = parseMachine(`Machine:
  name: P
  charset: a
  states: steps, keeps
  init: steps
  accept: keeps
  transitions:
    - steps a keeps`).value!;
    expect(m.states).toEqual(["steps", "keeps"]);
  });
});

describe("ε in regexes", () => {
  it("reads eps anywhere as ε and \\eps as letters", () => {
    expect(epsilonWords("(a|eps)*")).toBe("(a|ε)*");
    const nfa = regexToNFA("(a|eps)b").value!;
    expect(acceptsFSM(nfa, "b")).toBe(true);
    expect(acceptsFSM(nfa, "ab")).toBe(true);
    const letters = regexToNFA("\\eps").value!;
    expect(acceptsFSM(letters, "eps")).toBe(true);
    expect(acceptsFSM(letters, "")).toBe(false);
  });
});
