import { describe, expect, it } from "vitest";
import { deltaShape, deltaToRow, readDelta, rowToDelta, transitionScalar, writeDelta } from "./delta";
import { parseDefinition, parseMachine } from "./definitionParser";
import { serializeMachine } from "./serialize";
import { fsmToMachine, machineToFSM, runMachine } from "../machine/machine";
import { determinize } from "../fsm/ops";
import { CELL_TEMPLATES, EXAMPLE_WORKSHEETS } from "../worksheet/examples";

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

  const STACK = { type: "stack" } as const;
  const QUEUE = { type: "queue" } as const;
  const TAPE = { type: "tape" } as const;
  const READ_ONLY = { type: "tape", readOnly: true } as const;

  it("orders the parts as the form's fields: input, then each storage's", () => {
    const d = readDelta("(q, a, Z, b) -> (p, AZ, c, R)");
    const row = deltaToRow(d, true, [STACK, TAPE]);
    expect(row).toEqual(["q", "a", "Z", "AZ", "b", "c", "R", "p"]);
    expect(rowToDelta(row, true, [STACK, TAPE])).toEqual({ args: d.args, values: d.values });
    expect(deltaToRow(readDelta("(s, a) -> (s, x, R)"), false, [TAPE])).toEqual(["s", "a", "x", "R", "s"]);
    expect(deltaToRow(readDelta("(q, a) -> p"), true, [])).toEqual(["q", "a", "p"]);
  });

  it("takes δ's value as the notes write it: what is written on each storage, then each tape's move", () => {
    // δ(q, a₁a₂) = (p, b₂, d₁d₂): the input tape read-only (9.9)
    const ro = readDelta("(q, a, c) -> (p, d, R, L)");
    expect(deltaToRow(ro, false, [READ_ONLY, TAPE])).toEqual(["q", "a", "R", "c", "d", "L", "p"]);
    expect(rowToDelta(["q", "a", "R", "c", "d", "L", "p"], false, [READ_ONLY, TAPE])).toEqual({ args: ro.args, values: ro.values });
    // both tapes written: (p, b₁, b₂, d₁, d₂)
    const rw = readDelta("(q, a, c) -> (p, b, d, R, L)");
    expect(deltaToRow(rw, false, [TAPE, TAPE])).toEqual(["q", "a", "b", "R", "c", "d", "L", "p"]);
    expect(rowToDelta(deltaToRow(rw, false, [TAPE, TAPE]), false, [TAPE, TAPE])).toEqual({ args: rw.args, values: rw.values });
    // a tape before a stack: its symbol, the stack's word, then the tape's move
    const mixed = readDelta("(q, a, x, Z) -> (p, y, AZ, R)");
    expect(deltaToRow(mixed, true, [TAPE, STACK])).toEqual(["q", "a", "x", "y", "R", "Z", "AZ", "p"]);
    expect(rowToDelta(deltaToRow(mixed, true, [TAPE, STACK]), true, [TAPE, STACK])).toEqual({
      args: mixed.args,
      values: mixed.values
    });
    // three tapes, the first read-only: (p, b₂, b₃, d₁, d₂, d₃)
    const three = readDelta("(q, a, b, c) -> (p, x, y, R, S, L)");
    const shape = [READ_ONLY, TAPE, TAPE];
    expect(deltaToRow(three, false, shape)).toEqual(["q", "a", "R", "b", "x", "S", "c", "y", "L", "p"]);
    expect(rowToDelta(deltaToRow(three, false, shape), false, shape)).toEqual({ args: three.args, values: three.values });
  });

  it("pads an unfinished line to the shape, for the form", () => {
    expect(deltaToRow(readDelta("(q, a"), true, [STACK])).toEqual(["q", "a", "", "", ""]);
    expect(deltaToRow(readDelta("(q, a, b) -> (p"), false, [READ_ONLY, TAPE])).toEqual(["q", "a", "", "b", "", "", "p"]);
  });

  it("names the shape a machine's transitions take", () => {
    expect(deltaShape(true, [])).toBe("(q, a) -> p");
    expect(deltaShape(true, [STACK])).toBe("(q, a, Z) -> (p, γ)");
    expect(deltaShape(false, [TAPE])).toBe("(q, a) -> (p, b, D)");
    expect(deltaShape(true, [STACK, QUEUE])).toBe("(q, a, Z₁, Z₂) -> (p, γ₁, γ₂)");
    expect(deltaShape(false, [READ_ONLY, TAPE])).toBe("(q, a₁, a₂) -> (p, b₂, D₁, D₂)");
    expect(deltaShape(false, [TAPE, TAPE])).toBe("(q, a₁, a₂) -> (p, b₁, b₂, D₁, D₂)");
    expect(deltaShape(false, [READ_ONLY, TAPE, TAPE])).toBe("(q, a₁, a₂, a₃) -> (p, b₂, b₃, D₁, D₂, D₃)");
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
