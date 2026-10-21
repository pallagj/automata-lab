import { describe, expect, it } from "vitest";
import { EPS } from "./types";
import { acceptsFSM, analyzeFSM, enumerateWords, makeFSM } from "./fsm/fsm";
import {
  checkEquivalence,
  complement,
  complete,
  concatFSM,
  determinize,
  minimize,
  product,
  removeEpsilon,
  reverseFSM,
  starFSM,
  unionEpsilon
} from "./fsm/ops";
import { regexToNFA } from "./fsm/regex";
import { parseGrammar, parseMachine } from "./parse/definitionParser";
import { classify, generateWords, grammarAccepts, grammarToFSM, grammarToPDA, fsmToGrammar, removeEpsilonRules } from "./grammar/grammar";
import { machineCaps, machineToFSM, runMachine } from "./machine/machine";
import { evaluateCells } from "./workspace";
import { serializeDefinition } from "./parse/serialize";

/** DFA of words with an even number of a's */
const evenA = makeFSM({
  name: "evenA",
  alphabet: ["a", "b"],
  states: ["E", "O"],
  start: "E",
  accept: ["E"],
  transitions: [
    { from: "E", symbol: "a", to: "O" },
    { from: "O", symbol: "a", to: "E" },
    { from: "E", symbol: "b", to: "E" },
    { from: "O", symbol: "b", to: "O" }
  ]
});

/** NFA of words ending in ab */
const endsAB = makeFSM({
  name: "endsAB",
  alphabet: ["a", "b"],
  states: ["0", "1", "2"],
  start: "0",
  accept: ["2"],
  transitions: [
    { from: "0", symbol: "a", to: "0" },
    { from: "0", symbol: "b", to: "0" },
    { from: "0", symbol: "a", to: "1" },
    { from: "1", symbol: "b", to: "2" }
  ]
});

describe("FSM simulation", () => {
  it("DFA acceptance", () => {
    expect(acceptsFSM(evenA, "")).toBe(true);
    expect(acceptsFSM(evenA, "aba")).toBe(true);
    expect(acceptsFSM(evenA, "ab")).toBe(false);
  });
  it("NFA acceptance", () => {
    expect(acceptsFSM(endsAB, "aab")).toBe(true);
    expect(acceptsFSM(endsAB, "abba")).toBe(false);
  });
  it("ε-NFA acceptance", () => {
    const m = makeFSM({
      name: "m",
      alphabet: ["a"],
      states: ["S", "A", "B"],
      start: "S",
      accept: ["B"],
      transitions: [
        { from: "S", symbol: EPS, to: "A" },
        { from: "A", symbol: "a", to: "B" }
      ]
    });
    expect(acceptsFSM(m, "a")).toBe(true);
    expect(acceptsFSM(m, "")).toBe(false);
  });
});

describe("determinisation", () => {
  it("NFA to an equivalent complete DFA", () => {
    const r = determinize(endsAB);
    expect(r.ok).toBe(true);
    const d = r.value!;
    expect(analyzeFSM(d).isCompleteDFA).toBe(true);
    for (const w of ["", "ab", "aab", "abab", "abb", "ba"]) {
      expect(acceptsFSM(d, w)).toBe(acceptsFSM(endsAB, w));
    }
  });
  it("rejects an automaton with ε-transitions, suggesting a fix", () => {
    const m = makeFSM({
      name: "m",
      alphabet: ["a"],
      states: ["S", "A"],
      start: "S",
      accept: ["A"],
      transitions: [{ from: "S", symbol: EPS, to: "A" }]
    });
    const r = determinize(m);
    expect(r.ok).toBe(false);
    expect(r.diagnostics[0].fix?.code).toBe("det(epsfree(m))");
  });
});

describe("ε-removal", () => {
  it("preserves the language", () => {
    const m = makeFSM({
      name: "m",
      alphabet: ["a", "b"],
      states: ["S", "A", "B"],
      start: "S",
      accept: ["B"],
      transitions: [
        { from: "S", symbol: EPS, to: "A" },
        { from: "A", symbol: "a", to: "A" },
        { from: "A", symbol: EPS, to: "B" },
        { from: "B", symbol: "b", to: "B" }
      ]
    });
    const r = removeEpsilon(m);
    expect(r.ok).toBe(true);
    expect(analyzeFSM(r.value!).hasEpsilon).toBe(false);
    for (const w of ["", "a", "ab", "aabb", "ba", "b"]) {
      expect(acceptsFSM(r.value!, w)).toBe(acceptsFSM(m, w));
    }
  });
});

describe("minimisation", () => {
  it("merges equivalent states", () => {
    // a DFA with two redundant states for the language (a|b)* b
    const m = makeFSM({
      name: "m",
      alphabet: ["a", "b"],
      states: ["1", "2", "3", "4"],
      start: "1",
      accept: ["3", "4"],
      transitions: [
        { from: "1", symbol: "a", to: "2" },
        { from: "1", symbol: "b", to: "3" },
        { from: "2", symbol: "a", to: "2" },
        { from: "2", symbol: "b", to: "4" },
        { from: "3", symbol: "a", to: "2" },
        { from: "3", symbol: "b", to: "3" },
        { from: "4", symbol: "a", to: "2" },
        { from: "4", symbol: "b", to: "4" }
      ]
    });
    const r = minimize(m);
    expect(r.ok).toBe(true);
    expect(r.value!.states.length).toBe(2);
    for (const w of ["", "b", "ab", "ba", "abb"]) {
      expect(acceptsFSM(r.value!, w)).toBe(acceptsFSM(m, w));
    }
  });
  it("rejects a nondeterministic one with a fix", () => {
    const r = minimize(endsAB);
    expect(r.ok).toBe(false);
    expect(r.diagnostics[0].fix?.code).toContain("det(");
  });
  it("rejects an incomplete one with a fix", () => {
    const m = makeFSM({
      name: "m",
      alphabet: ["a", "b"],
      states: ["S", "A"],
      start: "S",
      accept: ["A"],
      transitions: [{ from: "S", symbol: "a", to: "A" }]
    });
    const r = minimize(m);
    expect(r.ok).toBe(false);
    expect(r.diagnostics[0].fix?.code).toBe("min(complete(m))");
  });
});

describe("operations", () => {
  it("complement", () => {
    const r = complement(evenA);
    expect(r.ok).toBe(true);
    expect(acceptsFSM(r.value!, "a")).toBe(true);
    expect(acceptsFSM(r.value!, "aa")).toBe(false);
  });
  it("intersection via product", () => {
    const evenB = makeFSM({
      name: "evenB",
      alphabet: ["a", "b"],
      states: ["E", "O"],
      start: "E",
      accept: ["E"],
      transitions: [
        { from: "E", symbol: "b", to: "O" },
        { from: "O", symbol: "b", to: "E" },
        { from: "E", symbol: "a", to: "E" },
        { from: "O", symbol: "a", to: "O" }
      ]
    });
    const r = product(evenA, evenB, "intersect");
    expect(r.ok).toBe(true);
    expect(acceptsFSM(r.value!, "abab")).toBe(true);
    expect(acceptsFSM(r.value!, "aab")).toBe(false);
  });
  it("concatenation and star", () => {
    const a = regexToNFA("a").value!;
    const b = regexToNFA("b").value!;
    const ab = concatFSM(a, b).value!;
    expect(acceptsFSM(ab, "ab")).toBe(true);
    expect(acceptsFSM(ab, "a")).toBe(false);
    const star = starFSM(ab).value!;
    expect(acceptsFSM(star, "")).toBe(true);
    expect(acceptsFSM(star, "abab")).toBe(true);
    expect(acceptsFSM(star, "aba")).toBe(false);
  });
  it("reversal", () => {
    const r = reverseFSM(endsAB).value!;
    expect(acceptsFSM(r, "ba")).toBe(true);
    expect(acceptsFSM(r, "ab")).toBe(false);
  });
  it("union via ε-construction", () => {
    const u = unionEpsilon(evenA, endsAB).value!;
    expect(acceptsFSM(u, "aa")).toBe(true);
    expect(acceptsFSM(u, "ab")).toBe(true);
    expect(acceptsFSM(u, "a")).toBe(false);
  });
});

describe("equivalence", () => {
  it("regex(ab*) ≠ regex(a*b) with a counterexample", () => {
    const a = regexToNFA("ab*").value!;
    const b = regexToNFA("a*b").value!;
    const r = checkEquivalence(a, b);
    expect(r.ok).toBe(true);
    expect(r.value!.equal).toBe(false);
    expect(r.value!.counterexample).toBeDefined();
  });
  it("det(M) ≡ M", () => {
    const d = determinize(endsAB).value!;
    const r = checkEquivalence(endsAB, d);
    expect(r.value!.equal).toBe(true);
  });
});

describe("regex", () => {
  it("(a|b)*abb", () => {
    const m = regexToNFA("(a|b)*abb").value!;
    expect(acceptsFSM(m, "abb")).toBe(true);
    expect(acceptsFSM(m, "aabb")).toBe(true);
    expect(acceptsFSM(m, "ab")).toBe(false);
  });
  it("word enumeration", () => {
    const m = regexToNFA("ab*").value!;
    const { words } = enumerateWords(m, 4, 10);
    expect(words).toContain("a");
    expect(words).toContain("ab");
    expect(words).toContain("abb");
  });
});

describe("parser", () => {
  it("a dash in a state name is part of the name, not a range", () => {
    const r = parseMachine(`
Machine:
  name: M
  charset: a, b
  states: S, 1-2, C-A
  init: S
  accept: 1-2, C-A
  transitions:
    - (S, a) -> 1-2
    - (1-2, b) -> C-A
`);
    expect(r.ok).toBe(true);
    expect(r.diagnostics).toEqual([]);
    expect(r.value!.states).toEqual(["S", "1-2", "C-A"]);
    expect(r.value!.accept).toEqual(["1-2", "C-A"]);
    expect(runMachine(r.value!, "a").verdict).toBe("accepted");
    expect(runMachine(r.value!, "ab").verdict).toBe("accepted");
    expect(runMachine(r.value!, "b").verdict).toBe("rejected");
    expect(parseMachine(serializeDefinition(r.value!)).value!.states).toEqual(["S", "1-2", "C-A"]);
  });
  it("a range of states is not expanded: its states are unknown", () => {
    const r = parseMachine(`
Machine:
  name: M
  charset: a
  states: A-C
  init: A
  accept: C
  transitions:
    - (A, a) -> C
`);
    expect(r.ok).toBe(false);
    expect(r.diagnostics[0].title).toEqual({ key: "definitionParser.machine.startNotInStates", params: { start: "A" } });
  });
  it("an alphabet still expands a range", () => {
    const r = parseMachine(`
Machine:
  name: M
  charset: a-c, x
  states: S
  init: S
  accept: S
  transitions:
    - (S, b) -> S
`);
    expect(r.ok).toBe(true);
    expect(r.value!.alphabet).toEqual(["a", "b", "c", "x"]);
  });
  it("a grammar's terminals expand a range, its variables do not", () => {
    const g = parseGrammar(`
Grammar:
  name: G
  charset: 0-2
  variables: S
  init: S
  rules:
    - S -> 0S | 2
`);
    expect(g.ok).toBe(true);
    expect(g.value!.terminals).toEqual(["0", "1", "2"]);
    const v = parseGrammar(`
Grammar:
  name: G
  charset: a
  variables: S, A-C
  init: S
  rules:
    - S -> aB
`);
    expect(v.ok).toBe(false);
    expect(v.diagnostics[0].title).toEqual({ key: "definitionParser.badName.title", params: { name: "A-C" } });
  });
  it("a rule's empty alternative is an error: the empty word is written ε", () => {
    const grammar = (rule: string) =>
      parseGrammar(`
Grammar:
  name: G
  charset: a
  variables: S
  init: S
  rules:
    - ${rule}
`);
    for (const rule of ["S -> aS |", "S -> | aS", "S -> aS || ε", "S ->", "S -> aS |  "]) {
      const r = grammar(rule);
      expect(r.ok, rule).toBe(false);
      expect(r.diagnostics[0].title, rule).toEqual({
        key: "definitionParser.grammar.emptyAlternative.title",
        params: { line: rule.trim() }
      });
    }
    const ok = grammar("S -> aS | ε");
    expect(ok.ok).toBe(true);
    expect(ok.value!.rules).toEqual([
      { left: ["S"], right: ["a", "S"] },
      { left: ["S"], right: [] }
    ]);
  });
  it("an unknown state is an error", () => {
    const r = parseMachine(`
Machine:
  name: M
  charset: a
  states: S
  init: S
  accept: S
  transitions:
    - (S, a) -> X
`);
    expect(r.ok).toBe(false);
    expect(r.diagnostics[0].title.key).toBe("definitionParser.machine.unknownToState");
    expect(r.diagnostics[0].title.params?.state).toBe("X");
  });
  it("a missing init is an error", () => {
    const r = parseMachine(`
Machine:
  name: M
  charset: a
  states: S
`);
    expect(r.ok).toBe(false);
    expect(r.diagnostics[0].title.key).toBe("definitionParser.missingField.title");
    expect(r.diagnostics[0].title.params?.field).toBe("init");
  });
});

describe("grammar", () => {
  const regular = parseGrammar(`
Grammar:
  name: G
  charset: a, b
  variables: S, A
  init: S
  rules:
    - S -> aS | bA
    - A -> bA | b
`).value!;

  it("classification: type 3", () => {
    const c = classify(regular);
    expect(c.type).toBe(3);
    expect(c.rightLinear).toBe(true);
  });

  it("classification: S → ε with S on a right-hand side is in no class above 0 (4.13)", () => {
    const g = parseGrammar(`
Grammar:
  name: G
  charset: a, b
  variables: S
  init: S
  rules:
    - S -> aSb | ε
`).value!;
    const c = classify(g);
    expect(c.type).toBe(0);
    expect(c.reasons.type2.violations[0].key).toBe("grammar.classify.startEpsilonNotAllowed");
    // but its rules are A → α: ε-removal makes it type 2
    expect(c.contextFreeForm).toBe(true);
  });

  it("classification: a non-contracting grammar is not type 1 by the definition (4.14, 12.5)", () => {
    const g = parseGrammar(`
Grammar:
  name: G
  charset: a, b, c
  variables: S, B
  init: S
  rules:
    - S -> aSBc | abc
    - cB -> Bc
    - bB -> bb
`).value!;
    const c = classify(g);
    expect(c.type).toBe(0);
    expect(c.nonContracting).toBe(true);
  });

  it("word generation with derivations", () => {
    const { words } = generateWords(regular, 4, 20);
    const w = words.find((x) => x.word === "abb");
    expect(w).toBeDefined();
    expect(w!.derivation[0]).toBe("S");
    expect(w!.derivation[w!.derivation.length - 1]).toBe("abb");
  });

  it("RG → FSM preserves the language", () => {
    const r = grammarToFSM(regular);
    expect(r.ok).toBe(true);
    expect(acceptsFSM(r.value!, "abb")).toBe(true);
    expect(acceptsFSM(r.value!, "aabb")).toBe(true);
    expect(acceptsFSM(r.value!, "ba")).toBe(false);
  });

  it("FSM → RG preserves the language", () => {
    const r = fsmToGrammar(evenA);
    expect(r.ok).toBe(true);
    expect(grammarAccepts(r.value!, "aba").verdict).toBe("yes");
    expect(grammarAccepts(r.value!, "ab").verdict).toBe("no");
  });

  it("ε-removal", () => {
    const g = parseGrammar(`
Grammar:
  name: G
  charset: a, b
  variables: S, A
  init: S
  rules:
    - S -> aAb
    - A -> aA | ε
`).value!;
    const r = removeEpsilonRules(g);
    expect(r.ok).toBe(true);
    expect(r.value!.rules.every((x) => x.right.length > 0 || x.left[0] === r.value!.start)).toBe(true);
    expect(grammarAccepts(r.value!, "ab").verdict).toBe("yes");
    expect(grammarAccepts(r.value!, "aab").verdict).toBe("yes");
  });
});

describe("PDA", () => {
  it("accepts a^n b^n", () => {
    const p = parseMachine(`
Machine:
  name: P
  charset: a, b
  states: q0, q1, q2
  init: q0
  accept: q2
  storages:
    stack: stack
  transitions:
    - (q0, a, Z) -> (q0, AZ)
    - (q0, a, A) -> (q0, AA)
    - (q0, b, A) -> (q1, ε)
    - (q1, b, A) -> (q1, ε)
    - (q1, ε, Z) -> (q2, Z)
`).value!;
    expect(machineCaps(p).isPDALike).toBe(true);
    expect(runMachine(p, "aabb").verdict).toBe("accepted");
    expect(runMachine(p, "ab").verdict).toBe("accepted");
    expect(runMachine(p, "abb").verdict).toBe("rejected");
    expect(runMachine(p, "ba").verdict).toBe("rejected");
  });

  it("serialisation: the pushdown machine format round-trips", () => {
    const p = parseMachine(`
Machine:
  name: P
  charset: a
  states: q0, q1
  init: q0
  accept: q1
  storages:
    stack: stack
  transitions:
    - (q0, a, Z) -> (q0, AZ)
    - (q0, eps, Z) -> (q1, Z)
`).value!;
    const ser = serializeDefinition(p);
    expect(ser).toContain("Machine:");
    expect(ser).toContain("stack: stack");
    // the eps alias is written back as ε
    // q0 is the name q₀: written canonically
    expect(ser).toContain("- (q_0, ε, Z) -> (q_1, Z)");
    expect(ser).not.toContain("$");
    const back = parseMachine(ser).value!;
    for (const w of ["", "a", "aa"]) {
      expect(runMachine(back, w).verdict).toBe(runMachine(p, w).verdict);
    }
  });

  it("CFG → PDA: palindromes", () => {
    const g = parseGrammar(`
Grammar:
  name: G
  charset: a, b
  variables: S
  init: S
  rules:
    - S -> aSa | bSb | a | b | ε
`).value!;
    const r = grammarToPDA(g);
    expect(r.ok).toBe(true);
    const p = r.value!;
    expect(runMachine(p, "abba").verdict).toBe("accepted");
    expect(runMachine(p, "aba").verdict).toBe("accepted");
    expect(runMachine(p, "abab").verdict).toBe("rejected");
  });
});

describe("Turing machine", () => {
  it("palindrome checker", () => {
    const t = parseMachine(`
Machine:
  name: T
  charset: a, b
  states: start, haveA, haveB, matchA, matchB, back, ok
  init: start
  accept: ok
  input: tape
  storages:
    tape: tape
  transitions:
    - (start, a) -> (haveA, _, R)
    - (start, b) -> (haveB, _, R)
    - (start, _) -> (ok, _, S)
    - (haveA, a) -> (haveA, a, R)
    - (haveA, b) -> (haveA, b, R)
    - (haveA, _) -> (matchA, _, L)
    - (haveB, a) -> (haveB, a, R)
    - (haveB, b) -> (haveB, b, R)
    - (haveB, _) -> (matchB, _, L)
    - (matchA, a) -> (back, _, L)
    - (matchA, _) -> (ok, _, S)
    - (matchB, b) -> (back, _, L)
    - (matchB, _) -> (ok, _, S)
    - (back, a) -> (back, a, L)
    - (back, b) -> (back, b, L)
    - (back, _) -> (start, _, R)
`).value!;
    expect(machineCaps(t).isTMLike).toBe(true);
    expect(runMachine(t, "abba").verdict).toBe("accepted");
    expect(runMachine(t, "aba").verdict).toBe("accepted");
    expect(runMachine(t, "ab").verdict).toBe("rejected");
    expect(runMachine(t, "").verdict).toBe("accepted");
  });

  it("serialisation: the Turing machine format round-trips", () => {
    const t = parseMachine(`
Machine:
  name: T
  charset: a
  states: s, ok
  init: s
  accept: ok
  input: tape
  storages:
    tape: tape
  transitions:
    - (s, a) -> (s, a, R)
    - (s, _) -> (ok, _, S)
`).value!;
    const ser = serializeDefinition(t);
    expect(ser).toContain("Machine:");
    expect(ser).toContain("- (s, a) -> (s, a, R)");
    const back = parseMachine(ser).value!;
    expect(runMachine(back, "aaa").verdict).toBe("accepted");
  });
});

describe("worksheet evaluation", () => {
  it("expressions in dependency order", () => {
    const cells = [
      `Machine:
  name: M
  charset: a, b
  states: 0, 1, 2
  init: "0"
  accept: "2"
  transitions:
    - (0, a) -> 0
    - (0, b) -> 0
    - (0, a) -> 1
    - (1, b) -> 2`,
      "D = det(M)",
      "N = min(D)",
      "V = equal(M, N)"
    ];
    const rs = evaluateCells(cells);
    expect(rs[0].value?.kind).toBe("machine");
    expect(rs[1].value?.kind).toBe("machine");
    expect(rs[2].value?.kind).toBe("machine");
    expect(rs[3].value?.kind).toBe("verdict");
    expect((rs[3].value as { equal: boolean }).equal).toBe(true);
  });

  it("a cell starting with # is a note, not an error", () => {
    const rs = evaluateCells(["# This is a note\n# spanning two lines"]);
    expect(rs[0].comment).toBe(true);
    expect(rs[0].diagnostics).toEqual([]);
    expect(rs[0].value).toBeNull();
  });

  it("reports a broken dependency", () => {
    const rs = evaluateCells(["X = det(Missing)"]);
    expect(rs[0].value).toBeNull();
    expect(rs[0].diagnostics.some((d) => d.level === "error")).toBe(true);
  });

  it("reports a circular dependency", () => {
    const rs = evaluateCells(["A = det(B)", "B = det(A)"]);
    expect(rs[0].diagnostics.some((d) => d.title.key === "workspace.circularDependency.title")).toBe(true);
  });

  it("letter literals are not allowed in the expression language", () => {
    const rs = evaluateCells(["R = (ab)*+ba"]);
    expect(rs[0].value).toBeNull();
    expect(rs[0].diagnostics.some((d) => d.level === "error")).toBe(true);
  });

  it("regex is a standalone value, toFsm turns it into an automaton", () => {
    const rs = evaluateCells(["R = regex((ab)*+ba)", "A = toFsm(R)"]);
    expect(rs[0].value?.kind).toBe("regex");
    const m = rs[1].value;
    expect(m?.kind).toBe("machine");
    expect(runMachine(m as never, "abab").verdict).toBe("accepted");
    expect(runMachine(m as never, "ba").verdict).toBe("accepted");
    expect(runMachine(m as never, "ab").verdict).toBe("accepted");
    expect(runMachine(m as never, "aab").verdict).toBe("rejected");
  });

  it("regex is auto-converted in automaton operations", () => {
    const rs = evaluateCells(["R = regex(ab*)", "D = det(epsfree(R))"]);
    expect(rs[1].value?.kind).toBe("machine");
    expect(runMachine(rs[1].value as never, "abb").verdict).toBe("accepted");
    expect(runMachine(rs[1].value as never, "ba").verdict).toBe("rejected");
  });

  it("the fix chain works: min(det(epsfree(M)))", () => {
    const cells = [
      `Machine:
  name: M
  charset: a
  states: S, A
  init: S
  accept: A
  transitions:
    - (S, ε) -> A
    - (A, a) -> A`,
      "K = min(M)",
      "J = min(complete(det(epsfree(M))))"
    ];
    const rs = evaluateCells(cells);
    expect(rs[1].value).toBeNull();
    expect(rs[1].diagnostics[0].fix).toBeDefined();
    expect(rs[2].value?.kind).toBe("machine");
  });

  it("capability gate: automaton operations reject machines with storages", () => {
    const cells = [
      `Machine:
  name: P
  charset: a
  states: q0
  init: q0
  storages:
    stack: stack
  transitions:
    - (q0, a, Z) -> (q0, Z)`,
      "D = det(P)"
    ];
    const rs = evaluateCells(cells);
    expect(rs[1].value).toBeNull();
    expect(
      rs[1].diagnostics.some(
        (d) => d.level === "error" && (d.detail?.key === "expression.error.machineNeedsFsm" || d.title.key === "expression.error.machineNeedsFsm")
      )
    ).toBe(true);
  });

  it("capability gate: a storage-free Machine can be used as an automaton", () => {
    const cells = [
      `Machine:
  name: M
  charset: a, b
  states: S, A
  init: S
  accept: A
  transitions:
    - (S, a) -> A
    - (A, b) -> A`,
      "D = min(complete(det(M)))",
      "F = toFsm(M)"
    ];
    const rs = evaluateCells(cells);
    expect(rs[1].value?.kind).toBe("machine");
    expect(rs[2].value?.kind).toBe("machine");
    expect(runMachine(rs[2].value as never, "abb").verdict).toBe("accepted");
    expect(runMachine(rs[2].value as never, "b").verdict).toBe("rejected");
  });

  it("toPda yields a pushdown machine that can be simulated", () => {
    const cells = [
      `Grammar:
  name: G2
  charset: a, b
  variables: S
  init: S
  rules:
    - S -> aSb | ε`,
      "P = toPda(G2)"
    ];
    const rs = evaluateCells(cells);
    expect(rs[1].value?.kind).toBe("machine");
    expect(machineCaps(rs[1].value as never).isPDALike).toBe(true);
    expect(runMachine(rs[1].value as never, "aabb").verdict).toBe("accepted");
    expect(runMachine(rs[1].value as never, "aba").verdict).toBe("rejected");
  });

  it("serialisation round trip", () => {
    const rs = evaluateCells(["R0 = regex(ab+a)", "R = det(epsfree(toFsm(R0)))"]);
    const ser = serializeDefinition(rs[1].value as never);
    expect(ser).toContain("Machine:");
    const back = parseMachine(ser);
    expect(back.ok).toBe(true);
    expect(
      checkEquivalence(machineToFSM(back.value!)!, machineToFSM(rs[1].value as never)!).value!.equal
    ).toBe(true);
  });
});

describe("unnamed cells", () => {
  const M1 = `Machine:
  name: M1
  charset: a, b
  states: S, A
  init: S
  accept: A
  transitions:
    - (S, a) -> A
    - (S, b) -> S`;
  const unnamed = M1.replace("  name: M1\n", "");

  it("evaluates an expression without a name", () => {
    const rs = evaluateCells([M1, "det(M1)", "regex(a+b)", "M1"]);
    expect(rs[1].name).toBe(null);
    expect(rs[1].value?.kind).toBe("machine");
    expect(rs[2].value?.kind).toBe("regex");
    expect(rs[3].value?.kind).toBe("machine");
    expect(rs.flatMap((r) => r.diagnostics).filter((d) => d.level === "error")).toEqual([]);
  });

  it("shows an unnamed definition, but it cannot be referenced and never clashes", () => {
    const rs = evaluateCells([unnamed, unnamed, "det(M)"]);
    expect(rs[0].value?.kind).toBe("machine");
    expect(rs[0].name).toBe(null);
    expect(rs[1].diagnostics).toEqual([]);
    expect(rs[2].value).toBe(null);
  });

  it("still reports a definition with an unknown type key", () => {
    const rs = evaluateCells(["Machin:\n  name: X"]);
    expect(rs[0].diagnostics[0].title.key).toBe("workspace.unparseableCell.title");
  });

  it("keeps an unnamed definition unnamed when written back", () => {
    const m = evaluateCells([unnamed])[0].value!;
    expect(serializeDefinition(m as never)).not.toContain("name:");
  });
});

describe("names inside a regex", () => {
  it("are letters, with a warning that they are not references", () => {
    const rs = evaluateCells(["R1 = regex(ab)", "X = regex(R1|b)", "Y = regex(ab|b)", "Z = regex(L)", "L = regex(a)"]);
    expect(rs[1].value?.kind).toBe("regex");
    expect(rs[1].diagnostics.map((d) => d.title.key)).toContain("expression.regexNameInside.title");
    expect(rs[1].diagnostics.find((d) => d.level === "warning")?.title.params?.names).toBe("R1");
    expect(rs[2].diagnostics).toEqual([]);
    // names defined further down count too
    expect(rs[3].diagnostics.map((d) => d.title.key)).toContain("expression.regexNameInside.title");
  });
});
