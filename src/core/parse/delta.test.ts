import { describe, expect, it } from "vitest";
import { deltaShape, deltaToRow, readDelta, rowToDelta, transitionScalar, writeDelta } from "./delta";
import { parseDefinition, parseMachine } from "./definitionParser";
import { serializeMachine } from "./serialize";
import { fsmToMachine, machineToFSM, runMachine } from "../machine/machine";
import { determinize } from "../fsm/ops";
import { CELL_TEMPLATES, EXAMPLE_WORKSHEETS } from "../../state/examples";

describe("a transition as the notes write δ", () => {
  it("reads an automaton's, a pushdown automaton's and a Turing machine's", () => {
    expect(readDelta("(q, a) -> p")).toEqual({ args: ["q", "a"], values: ["p"], wellFormed: true });
    expect(readDelta("(q0, a, Z) -> (q0, AZ)")).toEqual({ args: ["q0", "a", "Z"], values: ["q0", "AZ"], wellFormed: true });
    expect(readDelta("(s, a) → (s, x, R)")).toEqual({ args: ["s", "a"], values: ["s", "x", "R"], wellFormed: true });
  });

  it("takes spaces freely, and → for ->", () => {
    expect(readDelta("  ( q ,a )->( p ,b,L ) ")).toEqual(readDelta("(q, a) -> (p, b, L)"));
  });

  it("keeps a set-named state whole: ({A,B}, a) -> {A}", () => {
    expect(readDelta("({A,B}, a) -> {A}")).toEqual({ args: ["{A,B}", "a"], values: ["{A}"], wellFormed: true });
    expect(readDelta("({A,B}, a, Z) -> ({B,C}, ε)").values).toEqual(["{B,C}", "ε"]);
  });

  it("reads parentheses as symbols: only the outer ones group", () => {
    expect(readDelta("(q, (, Z) -> (q, (Z)")).toEqual({ args: ["q", "(", "Z"], values: ["q", "(Z"], wellFormed: true });
    expect(readDelta("(q, ), () -> (q, ε)").args).toEqual(["q", ")", "("]);
  });

  it("knows a line that is not in this shape", () => {
    for (const line of ["q a -> p", "(q, a)", "(q, a) p", "(q, a, Z) -> p, AZ", "q, a -> p", "(q, a -> p", "(q, a) -> (p, b", ""])
      expect(readDelta(line).wellFormed, line).toBe(false);
  });

  it("writes a single value bare, several in parentheses", () => {
    expect(writeDelta(["q", "a"], ["p"])).toBe("(q, a) -> p");
    expect(writeDelta(["q", "a", "Z"], ["p", "AZ"])).toBe("(q, a, Z) -> (p, AZ)");
    for (const line of ["(q, a) -> p", "({A,B}, a) -> {A}", "(q, (, Z) -> (q, (Z)", "(s, _) -> (ok, _, S)"]) {
      const d = readDelta(line);
      expect(writeDelta(d.args, d.values)).toBe(line);
    }
  });

  it("orders the parts as the form's fields: input, then each storage's", () => {
    const d = readDelta("(q, a, Z, b) -> (p, AZ, c, R)");
    const row = deltaToRow(d, true, ["stack", "tape"]);
    expect(row).toEqual(["q", "a", "Z", "AZ", "b", "c", "R", "p"]);
    expect(rowToDelta(row, true, ["stack", "tape"])).toEqual({ args: d.args, values: d.values });
    expect(deltaToRow(readDelta("(s, a) -> (s, x, R)"), false, ["tape"])).toEqual(["s", "a", "x", "R", "s"]);
    expect(deltaToRow(readDelta("(q, a) -> p"), true, [])).toEqual(["q", "a", "p"]);
  });

  it("pads an unfinished line to the shape, for the form", () => {
    expect(deltaToRow(readDelta("(q, a"), true, ["stack"])).toEqual(["q", "a", "", "", ""]);
  });

  it("names the shape a machine's transitions take", () => {
    expect(deltaShape(true, [])).toBe("(q, a) -> p");
    expect(deltaShape(true, ["stack"])).toBe("(q, a, Z) -> (p, γ)");
    expect(deltaShape(false, ["tape"])).toBe("(q, a) -> (p, b, D)");
    expect(deltaShape(true, ["stack", "queue"])).toBe("(q, a, Z, Z) -> (p, γ, γ)");
  });

  it("quotes a line for YAML only where it would be cut: ': ' and ' #'", () => {
    expect(transitionScalar("(q, a) -> p")).toBe("(q, a) -> p");
    expect(transitionScalar("({A,B}, a) -> {A}")).toBe("({A,B}, a) -> {A}");
    expect(transitionScalar("(q, #) -> p")).toBe("'(q, #) -> p'");
    expect(transitionScalar("(q, \\eps) -> p")).toBe("(q, \\eps) -> p");
  });
});

describe("transitions read back as they were written", () => {
  const roundTrip = (src: string) => {
    const m = parseMachine(src);
    expect(m.ok, src).toBe(true);
    const back = parseMachine(serializeMachine(m.value!));
    expect(back.ok, serializeMachine(m.value!)).toBe(true);
    expect(back.value!.transitions).toEqual(m.value!.transitions);
    expect(back.value!.storages).toEqual(m.value!.storages);
    return m.value!;
  };

  it("every machine of the examples and the templates", () => {
    const sources = [...EXAMPLE_WORKSHEETS.flatMap((w) => w.cells), ...Object.values(CELL_TEMPLATES)];
    const machines = sources.filter((c) => parseDefinition(c)?.value?.kind === "machine");
    expect(machines.length).toBeGreaterThan(10);
    machines.forEach(roundTrip);
  });

  it("a determinized automaton's set-named states", () => {
    const n = parseMachine(`
Machine:
  charset: a, b
  states: A, B, C
  init: A
  accept: C
  transitions:
    - (A, a) -> A
    - (A, a) -> B
    - (A, b) -> A
    - (B, b) -> C
`).value!;
    const d = fsmToMachine(determinize(machineToFSM(n)!).value!);
    expect(d.states.some((s) => s.includes(","))).toBe(true);
    const back = parseMachine(serializeMachine(d)).value!;
    expect(back.transitions).toEqual(d.transitions);
  });

  it("parentheses as input and stack symbols: the balanced words", () => {
    const m = roundTrip(`
Machine:
  name: D
  charset: (, )
  states: q
  init: q
  acceptMode: emptyStorages
  storages:
    stack: stack
  transitions:
    - (q, (, Z) -> (q, (Z)
    - (q, (, () -> (q, (()
    - (q, ), () -> (q, ε)
    - (q, ε, Z) -> (q, ε)
`);
    const balanced = (w: string) => {
      let depth = 0;
      for (const c of w) if ((depth += c === "(" ? 1 : -1) < 0) return false;
      return depth === 0;
    };
    const words = ["", "(", ")", "()", ")(", "(())", "()()", "(()", "())(", "((()))", "(()())", "())(()"];
    for (const w of words) expect(runMachine(m, w).verdict, w).toBe(balanced(w) ? "accepted" : "rejected");
  });

  it("symbols YAML or ε would misread: #, and e p s in a row", () => {
    roundTrip(`
Machine:
  charset: "#, e, p, s"
  states: q
  init: q
  accept: q
  storages:
    stack: stack
  transitions:
    - '(q, #, Z) -> (q, #Z)'
    - (q, e, Z) -> (q, \\e\\p\\sZ)
`);
  });
});
