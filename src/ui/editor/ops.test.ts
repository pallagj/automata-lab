import { describe, expect, it } from "vitest";
import { OPS, opApplicability } from "./ops";
import { evaluateCells } from "../../core/workspace";
import { EXAMPLE_WORKSHEETS } from "../../state/examples";

const op = (name: string) => OPS.find((o) => o.name === name)!;
const valueOf = (src: string) => evaluateCells([src])[0].value!;

const cfg = valueOf(`Grammar:
  name: G
  charset: a, b
  variables: S
  init: S
  rules:
    - S -> aSb | ε`);
const csg = valueOf(`Grammar:
  name: G
  charset: a, b
  variables: S, B
  init: S
  rules:
    - S -> aSB | ab
    - bB -> bb`);
const fsm = valueOf(`Machine:
  name: M
  charset: a, b
  states: S, A
  init: S
  accept: A
  transitions:
    - S a A`);
const pda = valueOf(`Machine:
  name: P
  charset: a
  states: q
  init: q
  storages:
    stack: stack
  transitions:
    - q a Z/AZ q`);

describe("operation menu applicability", () => {
  it("epsfree applies to a context-free grammar, not to a context-sensitive one", () => {
    expect(opApplicability(op("epsfree"), cfg).ok).toBe(true);
    const cs = opApplicability(op("epsfree"), csg);
    expect(cs.ok).toBe(false);
    expect(cs.reason?.key).toBe("grammar.epsfree.needsContextFree.title");
  });

  it("the grammar transformations check their preconditions", () => {
    expect(opApplicability(op("unitfree"), cfg).ok).toBe(true);
    expect(opApplicability(op("trim"), cfg).ok).toBe(true);
    const cnf = opApplicability(op("cnf"), cfg);
    expect(cnf.ok).toBe(false);
    expect(cnf.reason?.key).toBe("grammar.cnf.needsEpsilonFree.title");
    expect(cnf.fixChain).toBe("cnf(epsfree(G))");
    for (const name of ["unitfree", "trim", "cnf"]) {
      expect(opApplicability(op(name), csg).ok, name).toBe(false);
      expect(opApplicability(op(name), fsm).ok, name).toBe(false);
    }
  });

  it("toRegex applies to a finite automaton, not to a pushdown automaton", () => {
    expect(opApplicability(op("toRegex"), fsm).ok).toBe(true);
    expect(opApplicability(op("toRegex"), pda).ok).toBe(false);
  });

  it("every operation in the menu is a function of the expression language", () => {
    for (const o of OPS) {
      const arg = o.input === "grammar" ? "G" : "M";
      const src = o.args === 2 ? `${o.name}(${arg}, ${arg})` : `${o.name}(${arg})`;
      const rs = evaluateCells([o.input === "grammar" ? CFG_SRC : FSM_SRC, `X = ${src}`]);
      expect(
        rs[1].diagnostics.filter((d) => d.title.key.startsWith("expression.error")),
        src
      ).toEqual([]);
    }
  });
});

describe("example worksheets", () => {
  it("evaluate without errors", () => {
    for (const ws of EXAMPLE_WORKSHEETS) {
      const rs = evaluateCells(ws.cells);
      rs.forEach((r, i) => {
        expect(r.diagnostics.filter((d) => d.level === "error"), `${ws.key} cell ${i + 1}`).toEqual([]);
        if (!r.comment) expect(r.value, `${ws.key} cell ${i + 1}`).not.toBeNull();
      });
    }
  });
});

const CFG_SRC = `Grammar:
  name: G
  charset: a, b
  variables: S, A
  init: S
  rules:
    - S -> aA | ε
    - A -> b`;
const FSM_SRC = `Machine:
  name: M
  charset: a, b
  states: S, A
  init: S
  accept: A
  transitions:
    - S a A
    - S b S
    - A . A`;
