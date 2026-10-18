import { describe, expect, it } from "vitest";
import { evaluateCells } from "./workspace";
import { collectDependencies } from "./expr/expression";
import { parseGrammar, parseMachine } from "./parse/definitionParser";
import { serializeDefinition } from "./parse/serialize";
import { fsmToGrammar, grammarToFSM, grammarToPDA, removeEpsilonRules } from "./grammar/grammar";
import { toCNF } from "./grammar/normalForm";
import { checkEquivalence, complete, determinize, removeEpsilon } from "./fsm/ops";
import { acceptsFSM, makeFSM } from "./fsm/fsm";
import { runMachine } from "./machine/machine";
import { allWords, cfgWordsUpTo, randomCFG, randomNFA, rng } from "./testing";

const M = (name: string) => `Machine:
  name: ${name}
  charset: a, b
  states: S, A
  init: S
  accept: A
  transitions:
    - S a A
    - A b A`;

describe("cell names: one letter with a subscript", () => {
  it("a definition's name is canonical: M1 is M_1", () => {
    const rs = evaluateCells([M("M1"), "D = det(M_1)", "E = det(M1)"]);
    expect(rs[0].name).toBe("M_1");
    expect(rs[1].value?.kind).toBe("machine");
    expect(rs[2].value?.kind).toBe("machine");
  });

  it("a word is not a name, with a suggestion", () => {
    const def = evaluateCells([M("EvenA")]);
    expect(def[0].value).toBeNull();
    expect(def[0].diagnostics[0].title).toEqual({ key: "definitionParser.badName.title", params: { name: "EvenA" } });
    expect(def[0].diagnostics[0].detail?.params).toEqual({ suggestion: "E_{venA}" });

    const asg = evaluateCells([M("M"), "Min = min(complete(M))"]);
    expect(asg[1].value).toBeNull();
    expect(asg[1].diagnostics[0].detail?.params).toEqual({ suggestion: "M_{in}" });
  });

  it("subscripted names in assignments and references", () => {
    const rs = evaluateCells([M("M"), "M_{det} = det(M)", "E = equal(M, M_{det})", "M_2 = min(complete(M_{det}))"]);
    expect(rs[1].name).toBe("M_{det}");
    expect((rs[2].value as { equal: boolean }).equal).toBe(true);
    expect(rs[3].name).toBe("M_2");
  });

  it("names side by side are concatenated, as factors are multiplied in mathematics", () => {
    const rs = evaluateCells(["A = regex(a)", "B = regex(b)", "C = AB", "D = A B"]);
    for (const i of [2, 3]) {
      const m = rs[i].value as never;
      expect(runMachine(m, "ab").verdict).toBe("accepted");
      expect(runMachine(m, "ba").verdict).toBe("rejected");
    }
  });

  it("an unknown word is reported with a name suggestion", () => {
    const rs = evaluateCells([M("M"), "X = det(EvenA)"]);
    expect(rs[1].diagnostics[0].detail?.key).toBe("expression.error.multiLetterName");
    expect(rs[1].diagnostics[0].detail?.params?.suggestion).toBe("E_{venA}");
  });

  it("a function name needs its parentheses", () => {
    const rs = evaluateCells([M("M"), "X = det"]);
    expect(rs[1].diagnostics[0].detail?.key).toBe("expression.error.functionNeedsParen");
  });

  it("dependencies are found by the same rule, regex bodies skipped", () => {
    const known = new Set(["M", "M_1", "R", "a"]);
    expect([...collectDependencies("union(M1, det(M)) + R", known)].sort()).toEqual(["M", "M_1", "R"]);
    expect([...collectDependencies("regex(a+R)", known)]).toEqual([]);
    expect([...collectDependencies("toRegex(M_1)", known)]).toEqual(["M_1"]);
  });
});

describe("automaton → grammar names the variables A_q", () => {
  const fsm = (states: string[], start: string, accept: string[], t: [string, string, string][], alphabet = ["a", "b"]) =>
    makeFSM({ name: "M", alphabet, states, start, accept, transitions: t.map(([from, symbol, to]) => ({ from, symbol, to })) });

  it("keeps names that are already variable names, gives A_q to the rest", () => {
    const f = fsm(["S", "00", "{A,B}", "q_0"], "S", ["q_0"], [
      ["S", "a", "00"],
      ["00", "b", "{A,B}"],
      ["{A,B}", "a", "q_0"]
    ]);
    const g = fsmToGrammar(f).value!;
    expect(g.nonterminals).toEqual(["S", "A_{00}", "A_{A,B}", "q_0"]);
    expect(g.rules.map((r) => `${r.left.join("")}→${r.right.join(" ")}`)).toEqual([
      "S→a A_{00}",
      "A_{00}→b A_{A,B}",
      "A_{A,B}→a q_0",
      "q_0→"
    ]);
  });

  it("a state named like a terminal is renamed, and names never clash", () => {
    const f = fsm(["a", "A_a", "x"], "a", ["x"], [
      ["a", "a", "A_a"],
      ["A_a", "b", "x"]
    ]);
    const g = fsmToGrammar(f).value!;
    expect(new Set(g.nonterminals).size).toBe(3);
    expect(g.nonterminals).not.toContain("a");
    expect(g.nonterminals).toEqual(["A′_a", "A_a", "x"]);
  });

  it("state labels with separator characters still give a grammar that reads back", () => {
    const f = fsm(["p|q", "r/s"], "p|q", ["r/s"], [["p|q", "a", "r/s"]]);
    const g = fsmToGrammar(f).value!;
    expect(g.nonterminals).toEqual(["A_{pq}", "A_{rs}"]);
    const back = parseGrammar(serializeDefinition(g));
    expect(back.ok, JSON.stringify(back.diagnostics)).toBe(true);
    expect(back.value!.rules).toEqual(g.rules);
  });

  it("the round trip keeps the language for 200 random automata", () => {
    const random = rng(420);
    for (let i = 0; i < 200; i++) {
      const f = randomNFA(random, { states: 1 + Math.floor(random() * 5), alphabet: ["a", "b"] });
      // det gives set names such as {q0,q1}: free labels that need A_q variables
      const d = complete(determinize(removeEpsilon(f).value!).value!).value!;
      const back = grammarToFSM(fsmToGrammar(d).value!).value!;
      expect(checkEquivalence(d, back).value!.equal).toBe(true);
    }
  });
});

describe("stack symbols are names too", () => {
  it("Z_0 and X_a are single stack symbols", () => {
    const p = parseMachine(`Machine:
  name: P
  charset: a, b
  states: q
  init: q
  storages:
    stack:
      type: stack
      init: Z_0
  acceptMode: emptyStorages
  transitions:
    - q a Z_0/X_aZ_0 q
    - q a X_a/X_aX_a q
    - q b X_a/ε q
    - q ε Z_0/ε q`).value!;
    expect(p.storages[0].init).toEqual(["Z_0"]);
    expect(p.transitions[0].ops[0]).toEqual({ type: "stack", pop: "Z_0", push: ["X_a", "Z_0"] });
    expect(runMachine(p, "aabb").verdict).toBe("accepted");
    expect(runMachine(p, "aab").verdict).toBe("rejected");
    // and the YAML reads back the same
    const back = parseMachine(serializeDefinition(p)).value!;
    expect(back.transitions).toEqual(p.transitions);
    expect(back.storages).toEqual(p.storages);
  });

  it("taking off two symbols is an error that shows the subscript form", () => {
    const r = parseMachine(`Machine:
  name: P
  charset: a
  states: q
  init: q
  storages:
    stack: stack
  transitions:
    - q a Z0/Z q`);
    expect(r.ok).toBe(false);
    expect(r.diagnostics[0].title.key).toBe("definitionParser.storageOp.oneSymbol.title");
    expect(r.diagnostics[0].detail?.params?.example).toBe("Z_0");
  });

  it("toPda(cnf(…)) puts X_a and C_1 on the stack as single symbols: same language for 80 random grammars", () => {
    const random = rng(712);
    const words = allWords(["a", "b"], 4).filter((w) => w !== "");
    let checked = 0;
    for (let i = 0; i < 80; i++) {
      const g = randomCFG(random);
      const cnf = toCNF(removeEpsilonRules(g).value!).value!;
      const pda = grammarToPDA(cnf).value!;
      const lang = cfgWordsUpTo(g, 4);
      for (const w of words) {
        // a left-recursive grammar can keep a top-down parser busy: undecided runs are skipped
        const v = runMachine(pda, w, 3000).verdict;
        if (v === "limit") continue;
        checked++;
        expect(v === "accepted", `${w} in ${JSON.stringify(cnf.rules)}`).toBe(lang.has(w));
      }
    }
    expect(checked).toBeGreaterThan(800);
  });
});

describe("grammar text with subscripts", () => {
  const grammar = (variables: string, rules: string, charset = "a, b") =>
    parseGrammar(`Grammar:
  name: G
  charset: ${charset}
  variables: ${variables}
  init: S
  rules:
${rules
  .split("\n")
  .map((l) => `    - ${l.trim()}`)
  .join("\n")}`);

  it("variables with subscripts and primes", () => {
    const g = grammar("S, X_a, S'", "S -> X_aS' | a\nX_a -> a\nS' -> b").value!;
    expect(g.nonterminals).toEqual(["S", "X_a", "S′"]);
    expect(g.rules[0].right).toEqual(["X_a", "S′"]);
  });

  it("S1 reads as S_1 when only S_1 is a variable", () => {
    const g = grammar("S, S1", "S -> aS1\nS1 -> b").value!;
    expect(g.nonterminals).toEqual(["S", "S_1"]);
    expect(g.rules[0].right).toEqual(["a", "S_1"]);
    expect(g.rules[1].left).toEqual(["S_1"]);
  });

  it("with a terminal 1, S1 is ambiguous — S_1 or S 1 are fine", () => {
    const bad = grammar("S, S_1", "S -> 0S1 | ε\nS_1 -> 1", "0, 1");
    expect(bad.ok).toBe(false);
    expect(bad.diagnostics[0].title.key).toBe("definitionParser.grammar.ambiguousSubscript.title");
    const ok = grammar("S, S_1", "S -> 0S_1 | 0S 1 | ε\nS_1 -> 1", "0, 1").value!;
    expect(ok.rules.map((r) => r.right)).toEqual([["0", "S_1"], ["0", "S", "1"], [], ["1"]]);
  });

  it("digits stay terminals when no such variable exists: S → 0S1", () => {
    const g = grammar("S", "S -> 0S1 | ε", "0, 1").value!;
    expect(g.rules[0].right).toEqual(["0", "S", "1"]);
  });

  it("bad variable names and long terminals are explained", () => {
    expect(grammar("S, Var", "S -> a").diagnostics[0].title.key).toBe("definitionParser.badName.title");
    expect(grammar("S", "S -> ab", "ab").diagnostics[0].title.key).toBe("definitionParser.grammar.terminalNotOneChar.title");
  });

  it("an expanded grammar with long subscripts reads back the same", () => {
    const g = grammar("S, X_{ab}, C_{12}", "S -> X_{ab}C_{12} | a\nX_{ab} -> b\nC_{12} -> a").value!;
    const back = parseGrammar(serializeDefinition(g)).value!;
    expect(back.nonterminals).toEqual(g.nonterminals);
    expect(back.rules).toEqual(g.rules);
  });

  it("toFsm turns variables into states with the same names", () => {
    const g = grammar("S, X_a", "S -> aX_a\nX_a -> b").value!;
    const f = grammarToFSM(g).value!;
    expect(f.states).toContain("X_a");
    expect(acceptsFSM(f, "ab")).toBe(true);
  });
});
