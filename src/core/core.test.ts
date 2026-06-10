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
import { parseFSM, parseGrammar, parsePDA, parseTM } from "./parse/definitionParser";
import { classify, generateWords, grammarAccepts, grammarToFSM, grammarToPDA, fsmToGrammar, removeEpsilonRules } from "./grammar/grammar";
import { runPDA } from "./pda/pda";
import { runTM } from "./tm/tm";
import { evaluateCells } from "./workspace";
import { serializeDefinition } from "./parse/serialize";

/** páros számú a-t tartalmazó szavak DFA-ja */
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

/** ab-re végződő szavak NFA-ja */
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

describe("FSM szimuláció", () => {
  it("DFA elfogadás", () => {
    expect(acceptsFSM(evenA, "")).toBe(true);
    expect(acceptsFSM(evenA, "aba")).toBe(true);
    expect(acceptsFSM(evenA, "ab")).toBe(false);
  });
  it("NFA elfogadás", () => {
    expect(acceptsFSM(endsAB, "aab")).toBe(true);
    expect(acceptsFSM(endsAB, "abba")).toBe(false);
  });
  it("ε-NFA elfogadás", () => {
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

describe("determinizálás", () => {
  it("NFA-ból ekvivalens teljes DFA", () => {
    const r = determinize(endsAB);
    expect(r.ok).toBe(true);
    const d = r.value!;
    expect(analyzeFSM(d).isCompleteDFA).toBe(true);
    for (const w of ["", "ab", "aab", "abab", "abb", "ba"]) {
      expect(acceptsFSM(d, w)).toBe(acceptsFSM(endsAB, w));
    }
  });
  it("ε-átmenetes automatát elutasít javítási javaslattal", () => {
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

describe("ε-mentesítés", () => {
  it("megőrzi a nyelvet", () => {
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

describe("minimalizálás", () => {
  it("összevonja az ekvivalens állapotokat", () => {
    // két felesleges állapotú DFA az (a|b)* b nyelvhez
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
  it("nemdeterminisztikusat elutasít fix-szel", () => {
    const r = minimize(endsAB);
    expect(r.ok).toBe(false);
    expect(r.diagnostics[0].fix?.code).toContain("det(");
  });
  it("nem teljeset elutasít fix-szel", () => {
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

describe("műveletek", () => {
  it("komplementer", () => {
    const r = complement(evenA);
    expect(r.ok).toBe(true);
    expect(acceptsFSM(r.value!, "a")).toBe(true);
    expect(acceptsFSM(r.value!, "aa")).toBe(false);
  });
  it("metszet szorzattal", () => {
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
  it("konkatenáció és csillag", () => {
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
  it("megfordítás", () => {
    const r = reverseFSM(endsAB).value!;
    expect(acceptsFSM(r, "ba")).toBe(true);
    expect(acceptsFSM(r, "ab")).toBe(false);
  });
  it("unió ε-konstrukcióval", () => {
    const u = unionEpsilon(evenA, endsAB).value!;
    expect(acceptsFSM(u, "aa")).toBe(true);
    expect(acceptsFSM(u, "ab")).toBe(true);
    expect(acceptsFSM(u, "a")).toBe(false);
  });
});

describe("ekvivalencia", () => {
  it("regex(ab*) ≠ regex(a*b) ellenpéldával", () => {
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
  it("szóenumeráció", () => {
    const m = regexToNFA("ab*").value!;
    const { words } = enumerateWords(m, 4, 10);
    expect(words).toContain("a");
    expect(words).toContain("ab");
    expect(words).toContain("abb");
  });
});

describe("parser", () => {
  it("FSM helyettesítőkkel és intervallummal", () => {
    const r = parseFSM(`
StateMachine:
  name: M
  charset: a, b
  states: S, A-C
  init: S
  accept: C
  transitions:
    - S . S
    - S a A
    - A b B
    - B a C
`);
    expect(r.ok).toBe(true);
    expect(r.value!.states).toEqual(["S", "A", "B", "C"]);
    // wildcard: S minden szimbólumra önmagába
    expect(acceptsFSM(r.value!, "bbaba")).toBe(true);
  });
  it("ismeretlen állapot hibát ad", () => {
    const r = parseFSM(`
StateMachine:
  name: M
  charset: a
  states: S
  init: S
  accept: S
  transitions:
    - S a X
`);
    expect(r.ok).toBe(false);
    expect(r.diagnostics[0].title).toContain("X");
  });
  it("hiányzó init hibát ad", () => {
    const r = parseFSM(`
StateMachine:
  name: M
  charset: a
  states: S
`);
    expect(r.ok).toBe(false);
    expect(r.diagnostics[0].title).toContain("init");
  });
});

describe("nyelvtan", () => {
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

  it("osztályozás: 3. típus", () => {
    const c = classify(regular);
    expect(c.type).toBe(3);
    expect(c.direction).toBe("right");
  });

  it("osztályozás: 2. típus magyarázattal", () => {
    const g = parseGrammar(`
Grammar:
  name: G
  charset: a, b
  variables: S
  init: S
  rules:
    - S -> aSb | $
`).value!;
    const c = classify(g);
    expect(c.type).toBe(2);
    expect(c.reasons.type3.holds).toBe(false);
  });

  it("osztályozás: 1. típus (környezetfüggő)", () => {
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
    expect(c.type).toBe(1);
  });

  it("szógenerálás levezetéssel", () => {
    const { words } = generateWords(regular, 4, 20);
    const w = words.find((x) => x.word === "abb");
    expect(w).toBeDefined();
    expect(w!.derivation[0]).toBe("S");
    expect(w!.derivation[w!.derivation.length - 1]).toBe("abb");
  });

  it("RG → FSM nyelvmegőrző", () => {
    const r = grammarToFSM(regular);
    expect(r.ok).toBe(true);
    expect(acceptsFSM(r.value!, "abb")).toBe(true);
    expect(acceptsFSM(r.value!, "aabb")).toBe(true);
    expect(acceptsFSM(r.value!, "ba")).toBe(false);
  });

  it("FSM → RG nyelvmegőrző", () => {
    const r = fsmToGrammar(evenA);
    expect(r.ok).toBe(true);
    expect(grammarAccepts(r.value!, "aba").verdict).toBe("yes");
    expect(grammarAccepts(r.value!, "ab").verdict).toBe("no");
  });

  it("ε-mentesítés", () => {
    const g = parseGrammar(`
Grammar:
  name: G
  charset: a, b
  variables: S, A
  init: S
  rules:
    - S -> aAb
    - A -> aA | $
`).value!;
    const r = removeEpsilonRules(g);
    expect(r.ok).toBe(true);
    expect(r.value!.rules.every((x) => x.right !== "" || x.left === r.value!.start)).toBe(true);
    expect(grammarAccepts(r.value!, "ab").verdict).toBe("yes");
    expect(grammarAccepts(r.value!, "aab").verdict).toBe("yes");
  });
});

describe("PDA", () => {
  it("a^n b^n elfogadása", () => {
    const p = parsePDA(`
PushdownMachine:
  name: P
  charset: a, b
  states: q0, q1, q2
  init: q0
  initStack: Z
  accept: q2
  transitions:
    - q0 a Z/AZ q0
    - q0 a A/AA q0
    - q0 b A/$ q1
    - q1 b A/$ q1
    - q1 $ Z/Z q2
`).value!;
    expect(runPDA(p, "aabb").verdict).toBe("accepted");
    expect(runPDA(p, "ab").verdict).toBe("accepted");
    expect(runPDA(p, "abb").verdict).toBe("rejected");
    expect(runPDA(p, "ba").verdict).toBe("rejected");
  });

  it("CFG → PDA: palindromok", () => {
    const g = parseGrammar(`
Grammar:
  name: G
  charset: a, b
  variables: S
  init: S
  rules:
    - S -> aSa | bSb | a | b | $
`).value!;
    const r = grammarToPDA(g);
    expect(r.ok).toBe(true);
    const p = r.value!;
    expect(runPDA(p, "abba").verdict).toBe("accepted");
    expect(runPDA(p, "aba").verdict).toBe("accepted");
    expect(runPDA(p, "abab").verdict).toBe("rejected");
  });
});

describe("Turing-gép", () => {
  it("palindróma-ellenőrző", () => {
    const t = parseTM(`
TuringMachine:
  name: T
  charset: a, b
  states: start, haveA, haveB, matchA, matchB, back, ok
  init: start
  accept: ok
  transitions:
    - start a/_ > haveA
    - start b/_ > haveB
    - start _/& = ok
    - haveA ./& > haveA
    - haveA _/& < matchA
    - haveB ./& > haveB
    - haveB _/& < matchB
    - matchA a/_ < back
    - matchA _/& = ok
    - matchB b/_ < back
    - matchB _/& = ok
    - back ./& < back
    - back _/& > start
`).value!;
    expect(runTM(t, "abba").status).toBe("accepted");
    expect(runTM(t, "aba").status).toBe("accepted");
    expect(runTM(t, "ab").status).toBe("rejected");
    expect(runTM(t, "").status).toBe("accepted");
  });
});

describe("munkalap-kiértékelés", () => {
  it("kifejezések függőségi sorrendben", () => {
    const cells = [
      `StateMachine:
  name: M
  charset: a, b
  states: 0, 1, 2
  init: "0"
  accept: "2"
  transitions:
    - 0 a 0
    - 0 b 0
    - 0 a 1
    - 1 b 2`,
      "D = det(M)",
      "MD = min(D)",
      "V = equal(M, MD)"
    ];
    const rs = evaluateCells(cells);
    expect(rs[0].value?.kind).toBe("fsm");
    expect(rs[1].value?.kind).toBe("fsm");
    expect(rs[2].value?.kind).toBe("fsm");
    expect(rs[3].value?.kind).toBe("verdict");
    expect((rs[3].value as { equal: boolean }).equal).toBe(true);
  });

  it("hibás függőség jelzése", () => {
    const rs = evaluateCells(["X = det(Nincs)"]);
    expect(rs[0].value).toBeNull();
    expect(rs[0].diagnostics.some((d) => d.level === "error")).toBe(true);
  });

  it("körkörös függőség jelzése", () => {
    const rs = evaluateCells(["A = det(B)", "B = det(A)"]);
    expect(rs[0].diagnostics.some((d) => d.title.includes("Körkörös"))).toBe(true);
  });

  it("literál-kifejezés: (ab)*+ba", () => {
    const rs = evaluateCells(["R = (ab)*+ba"]);
    const m = rs[0].value;
    expect(m?.kind).toBe("fsm");
    expect(acceptsFSM(m as never, "abab")).toBe(true);
    expect(acceptsFSM(m as never, "ba")).toBe(true);
    expect(acceptsFSM(m as never, "ab")).toBe(true);
    expect(acceptsFSM(m as never, "aab")).toBe(false);
  });

  it("javítási lánc működik: min(det(epsfree(M)))", () => {
    const cells = [
      `StateMachine:
  name: M
  charset: a
  states: S, A
  init: S
  accept: A
  transitions:
    - S $ A
    - A a A`,
      "K = min(M)",
      "J = min(complete(det(epsfree(M))))"
    ];
    const rs = evaluateCells(cells);
    expect(rs[1].value).toBeNull();
    expect(rs[1].diagnostics[0].fix).toBeDefined();
    expect(rs[2].value?.kind).toBe("fsm");
  });

  it("szerializálás round-trip", () => {
    const rs = evaluateCells(["R = det(epsfree(ab+a))"]);
    const ser = serializeDefinition(rs[0].value as never);
    expect(ser).toContain("StateMachine:");
    const back = parseFSM(ser);
    expect(back.ok).toBe(true);
    expect(checkEquivalence(back.value!, rs[0].value as never).value!.equal).toBe(true);
  });
});
