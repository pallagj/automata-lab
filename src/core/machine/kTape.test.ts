import { describe, expect, it } from "vitest";
import {
  initialMachineConfig,
  isReadOnlyTape,
  Machine,
  machineCaps,
  machineMoves,
  machineTransitionLabel,
  runMachine,
  StorageOp,
  TapeState
} from "./machine";
import { parseMachine } from "../parse/definitionParser";
import { serializeMachine } from "../parse/serialize";
import { allWords, rng } from "../testing";
import { EXAMPLE_WORKSHEETS } from "../../state/examples";

const parse = (src: string) => {
  const r = parseMachine(src);
  expect(r.ok, JSON.stringify(r.diagnostics)).toBe(true);
  return r.value!;
};
const errorOf = (src: string) => parseMachine(src).diagnostics.find((d) => d.level === "error");

/** A machine with the input on tape t1, its storages and transitions as given. */
const machine = (storages: string[], transitions: string[], opts: { charset?: string; accept?: string; input?: string } = {}) =>
  [
    "Machine:",
    "  name: T",
    `  charset: ${opts.charset ?? "a, b"}`,
    "  states: s, t, ok",
    "  init: s",
    `  accept: ${opts.accept ?? "ok"}`,
    `  input: ${opts.input ?? "t1"}`,
    "  storages:",
    ...storages,
    "  transitions:",
    ...transitions.map((l) => `    - ${l}`)
  ].join("\n");

const TWO_TAPES = ["    t1: tape", "    t2: tape"];
const WRITABLE_INPUT = ["    t1:", "      type: tape", "      writable: true", "    t2: tape"];

/** A tape's cells from the first one, the blanks at the end dropped. */
const cellsText = (cells: Map<number, string>) => {
  const max = Math.max(-1, ...cells.keys());
  return Array.from({ length: max + 1 }, (_, i) => cells.get(i) ?? "_").join("").replace(/_+$/, "");
};
const content = (t: TapeState) => cellsText(t.cells);
const finalTapes = (m: Machine, w: string) => {
  const r = runMachine(m, w);
  expect(r.verdict, w).toBe("accepted");
  return r.acceptingPath!.at(-1)!.config.storages.map((s) => content(s as TapeState));
};

const HU = { R: "J", L: "B", S: "H" };
const T2 = EXAMPLE_WORKSHEETS.flatMap((w) => w.cells).find((c) => c.includes("name: T_2"))!;

describe("a k-tape Turing machine (lecture notes 9.9)", () => {
  it("tapes only, the input on one of them: a Turing machine, with its number of tapes", () => {
    const m = parse(T2);
    expect(machineCaps(m)).toMatchObject({ isTMLike: true, kind: "tm", storageCounts: { tape: 2 } });
    expect(machineCaps(parse(machine(["    t1: tape"], ["(s, a) -> (ok, a, S)"])))).toMatchObject({
      kind: "tm",
      storageCounts: undefined
    });
    // a stack beside the tape: no longer a Turing machine
    const mixed: Machine = { ...m, storages: [m.storages[0], { id: "v", type: "stack", alphabet: ["Z"], init: ["Z"] }] };
    expect(machineCaps(mixed).kind).toBe("general");
  });

  it("its input tape is only read, the others are its work tapes: δ(q, a₁a₂) = (q′, b₂, d₁d₂)", () => {
    const m = parse(T2);
    expect(m.storages.map(isReadOnlyTape)).toEqual([true, false]);
    // nothing is written on the input tape: every step keeps the symbol it reads there
    for (const t of m.transitions) {
      const op = t.ops[0] as Extract<StorageOp, { type: "tape" }>;
      expect(op.write).toBe(op.read);
    }
    const first = m.transitions.find((t) => t.from === "q_0" && (t.ops[0] as { read: string }).read === "a")!;
    expect(first.ops).toEqual([
      { type: "tape", read: "a", write: "a", move: "R" },
      { type: "tape", read: "_", write: "Y", move: "R" }
    ]);
  });

  it("the example accepts exactly aⁿbⁿ (n ≥ 0), never falling off its tapes, its input left as it was", () => {
    const m = parse(T2);
    for (const w of allWords(["a", "b"], 8)) {
      const n = w.length / 2;
      const inL = w === "a".repeat(n) + "b".repeat(n);
      expect(runMachine(m, w).verdict, w).toBe(inL ? "accepted" : "rejected");
      if (inL) expect(finalTapes(m, w)[0], w).toBe(w);
    }
  });

  it("falling off any tape halts the machine — here the second one", () => {
    const m = parse(machine(TWO_TAPES, ["(s, a, _) -> (ok, _, R, L)"]));
    const c = machineMoves(m, initialMachineConfig(m, "a"), "a")[0].config;
    expect(c.fellOff).toBe("t2");
    expect(runMachine(m, "a").verdict).toBe("rejected");
    // the input tape falls off just the same
    const m1 = parse(machine(TWO_TAPES, ["(s, a, _) -> (ok, _, L, R)"]));
    expect(machineMoves(m1, initialMachineConfig(m1, "a"), "a")[0].config.fellOff).toBe("t1");
  });

  it("a value written per tape is no transition of this machine: the error names the notes' shape", () => {
    const e = errorOf(machine(TWO_TAPES, ["(s, a, _) -> (ok, a, R, _, L)"]))!;
    expect(e.title.key).toBe("definitionParser.machine.invalidTransition.title");
    expect(e.detail?.params?.shape).toBe("(q, a₁, a₂) -> (p, b₂, D₁, D₂)");
    // with a writable input tape both tapes are written: the writes, then the moves
    const w = errorOf(machine(WRITABLE_INPUT, ["(s, a, _) -> (ok, _, R, L)"]))!;
    expect(w.detail?.params?.shape).toBe("(q, a₁, a₂) -> (p, b₁, b₂, D₁, D₂)");
  });

  it("writable: true makes the input tape written too, δ(q, a₁a₂) = (q′, b₁b₂, d₁d₂)", () => {
    // every a becomes b on the input tape, every letter is copied onto tape 2
    const m = parse(
      machine(WRITABLE_INPUT, ["(s, a, _) -> (s, b, a, R, R)", "(s, b, _) -> (s, b, b, R, R)", "(s, _, _) -> (ok, _, _, S, S)"])
    );
    expect(m.storages.map(isReadOnlyTape)).toEqual([false, false]);
    expect(finalTapes(m, "abaab")).toEqual(["bbbbb", "abaab"]);
    // read-only, the same steps leave the input as it was
    const ro = parse(machine(TWO_TAPES, ["(s, a, _) -> (s, a, R, R)", "(s, b, _) -> (s, b, R, R)", "(s, _, _) -> (ok, _, S, S)"]));
    expect(finalTapes(ro, "abaab")).toEqual(["abaab", "abaab"]);
  });

  it("writable: false makes any tape read-only, even a one-tape machine's", () => {
    const one = parse(
      machine(["    t1:", "      type: tape", "      writable: false"], ["(s, a) -> (s, R)", "(s, _) -> (ok, S)"])
    );
    expect(isReadOnlyTape(one.storages[0])).toBe(true);
    for (const w of allWords(["a", "b"], 5)) expect(runMachine(one, w).verdict, w).toBe(/^a*$/.test(w) ? "accepted" : "rejected");
    expect(machineTransitionLabel(one, one.transitions[0], HU)).toBe("a, J");
    // a work tape made read-only keeps what it starts with
    const work = parse(
      machine(
        ["    t1: tape", "    t2:", "      type: tape", "      writable: false", "      init: ab"],
        ["(s, a, a) -> (s, R, R)", "(s, b, b) -> (s, R, R)", "(s, _, _) -> (ok, S, S)"]
      )
    );
    expect(work.storages.map(isReadOnlyTape)).toEqual([true, true]);
    expect(runMachine(work, "ab").verdict).toBe("accepted");
    expect(runMachine(work, "ba").verdict).toBe("rejected");
  });

  it("writable is a tape's key, true or false", () => {
    const stack = [
      "Machine:",
      "  charset: a",
      "  states: q",
      "  init: q",
      "  accept: q",
      "  storages:",
      "    v:",
      "      type: stack",
      "      writable: true",
      "  transitions:",
      "    - (q, a, Z) -> (q, Z)"
    ].join("\n");
    expect(errorOf(stack)?.title.key).toBe("definitionParser.writableOnlyForTape.title");
    for (const value of ["yes", "1", "read"])
      expect(errorOf(machine(["    t1:", "      type: tape", `      writable: ${value}`], ["(s, a) -> (ok, a, S)"]))?.title.key, value).toBe(
        "definitionParser.badWritable.title"
      );
    expect(errorOf(machine(["    t1:", "      type: tape", "      writable: true"], ["(s, a) -> (ok, a, S)"]))).toBeUndefined();
  });

  it("the input tape beside a stack is read-only too; a machine read with a head writes every tape", () => {
    const mixed = parse(machine(["    t1: tape", "    s: stack"], ["(s, a, Z) -> (ok, AZ, R)"]));
    expect(mixed.storages.map(isReadOnlyTape)).toEqual([true, false]);
    expect(machineTransitionLabel(mixed, mixed.transitions[0], HU)).toBe("t1: a, J; s: Z → AZ");
    const head = parse(machine(["    t1: tape", "    s: stack"], ["(s, a, a, Z) -> (ok, b, AZ, R)"], { input: "head" }));
    expect(head.storages.map(isReadOnlyTape)).toEqual([false, false]);
    expect(machineTransitionLabel(head, head.transitions[0], HU)).toBe("a; t1: a → b, J; s: Z → AZ");
  });

  it("reads back unchanged: the default access is not written, a chosen one is", () => {
    const cases: [string, string | null][] = [
      [T2, null],
      [machine(WRITABLE_INPUT, ["(s, a, _) -> (ok, b, a, R, L)"]), "writable: true"],
      [machine(["    t1: tape", "    t2:", "      type: tape", "      writable: false"], ["(s, a, _) -> (ok, R, L)"]), "writable: false"],
      [machine(["    t1:", "      type: tape", "      writable: false"], ["(s, a) -> (ok, R)"]), "writable: false"],
      [machine(["    t1: tape"], ["(s, a) -> (ok, b, R)"]), null]
    ];
    for (const [src, line] of cases) {
      const m = parse(src);
      const yaml = serializeMachine(m);
      if (line) expect(yaml).toContain(`      ${line}\n`);
      else expect(yaml).not.toContain("writable");
      expect(parse(yaml)).toEqual(m);
      expect(serializeMachine(parse(yaml))).toBe(yaml);
    }
    // the transitions keep the notes' order: what is written, then the moves
    expect(serializeMachine(parse(T2))).toContain("- (q_0, a, _) -> (q_1, Y, R, R)\n");
  });
});

describe("an edge of a k-tape machine: each tape's a → b, then the moves", () => {
  it("a writable tape shows what it reads and writes, as a → b, c → d, D₁, D₂", () => {
    const m = parse(machine(WRITABLE_INPUT, ["(s, a, _) -> (ok, b, a, R, S)"]));
    expect(machineTransitionLabel(m, m.transitions[0], HU)).toBe("a → b, _ → a, J, H");
    // one tape: a → b, D as before
    const one = parse(machine(["    t1: tape"], ["(s, a) -> (ok, b, R)"]));
    expect(machineTransitionLabel(one, one.transitions[0], HU)).toBe("a → b, J");
  });

  it("a read-only tape shows the symbol it reads alone: the example's edges", () => {
    const m = parse(T2);
    const labels = m.transitions.map((t) => machineTransitionLabel(m, t, HU));
    expect(labels).toEqual([
      "_, _ → _, H, H",
      "a, _ → Y, J, J",
      "a, _ → X, J, J",
      "b, _ → _, H, B",
      "b, X → X, J, B",
      "b, Y → Y, J, H",
      "_, Y → Y, H, H"
    ]);
  });

  it("the counting machine of exercise 9.28 reads as its figure and computes f(1ⁿ) = 1ⁿ⁺¹", () => {
    // its input tape is read-only, the second tape is the output tape (9.24)
    const m = parse(
      [
        "Machine:",
        "  charset: 0, 1",
        "  states: q_0, q_1",
        "  init: q_0",
        "  accept: q_1",
        "  input: t1",
        "  storages:",
        "    t1: tape",
        "    t2: tape",
        "  transitions:",
        "    - (q_0, 0, _) -> (q_0, _, S, S)",
        "    - (q_0, 1, _) -> (q_0, 1, R, R)",
        "    - (q_0, _, _) -> (q_1, 1, R, R)"
      ].join("\n")
    );
    // the figure's labels, ⊔ written _
    expect(m.transitions.map((t) => machineTransitionLabel(m, t, HU))).toEqual(["0, _ → _, H, H", "1, _ → 1, J, J", "_, _ → 1, J, J"]);
    for (let n = 1; n <= 8; n++) expect(finalTapes(m, "1".repeat(n))).toEqual(["1".repeat(n), "1".repeat(n + 1)]);
    // with a 0 in the input the machine stays on it forever: f is not defined there
    for (const w of ["0", "10", "110", "101"]) expect(runMachine(m, w).verdict, w).not.toBe("accepted");
  });
});

/* ------------------------------------------------------------------ */
/* Random 2-tape machines against an independent simulation            */
/* ------------------------------------------------------------------ */

type Move = "L" | "R" | "S";
interface Step {
  from: string;
  reads: [string, string];
  to: string;
  writes: [string, string];
  moves: [Move, Move];
}

/** A random deterministic 2-tape machine over {a, b}: tape 2 holds X, Y and the blank. */
function randomSteps(next: () => number): { states: string[]; accept: string[]; steps: Step[] } {
  const n = 1 + Math.floor(next() * 4);
  const states = Array.from({ length: n }, (_, i) => `q_${i}`);
  const pick = <T,>(xs: readonly T[]) => xs[Math.floor(next() * xs.length)];
  const steps: Step[] = [];
  for (const from of states)
    for (const r1 of ["a", "b", "_"])
      for (const r2 of ["X", "Y", "_"])
        if (next() < 0.6)
          steps.push({
            from,
            reads: [r1, r2],
            to: pick(states),
            writes: [pick(["a", "b", "_"]), pick(["X", "Y", "_"])],
            moves: [pick(["L", "R", "S"] as const), pick(["L", "R", "S"] as const)]
          });
  return { states, accept: states.filter(() => next() < 0.4), steps };
}

/** The machine as YAML, its transitions in the notes' order: the writes (b₂ only, or b₁b₂), then the moves. */
function stepsYaml(r: ReturnType<typeof randomSteps>, writable: boolean): string {
  return [
    "Machine:",
    "  charset: a, b",
    `  states: ${r.states.join(", ")}`,
    "  init: q_0",
    `  accept: ${r.accept.join(", ")}`,
    "  input: t1",
    "  storages:",
    ...(writable ? ["    t1:", "      type: tape", "      writable: true"] : ["    t1: tape"]),
    "    t2:",
    "      type: tape",
    "      charset: X, Y, _",
    "  transitions:",
    ...r.steps.map((s) => {
      const writes = writable ? s.writes : [s.writes[1]];
      return `    - (${s.from}, ${s.reads.join(", ")}) -> (${[s.to, ...writes, ...s.moves].join(", ")})`;
    })
  ].join("\n");
}

/**
 * An independent oracle: a plain loop over two maps of cells. A read-only input tape is
 * never written; a head left of a first cell halts the run with an error.
 */
function oracle(r: ReturnType<typeof randomSteps>, writable: boolean, input: string, maxSteps = 120) {
  const tapes = [new Map<number, string>([...input].map((c, i) => [i, c])), new Map<number, string>()];
  const heads = [0, 0];
  let state = "q_0";
  for (let k = 0; k < maxSteps; k++) {
    const reads = heads.map((h, i) => tapes[i].get(h) ?? "_");
    const s = r.steps.find((x) => x.from === state && x.reads[0] === reads[0] && x.reads[1] === reads[1]);
    if (!s) return { verdict: r.accept.includes(state) ? "accepted" : "rejected", tapes };
    if (writable) tapes[0].set(heads[0], s.writes[0]);
    tapes[1].set(heads[1], s.writes[1]);
    s.moves.forEach((d, i) => (heads[i] += d === "R" ? 1 : d === "L" ? -1 : 0));
    state = s.to;
    if (heads.some((h) => h < 0)) return { verdict: "rejected", tapes };
  }
  return { verdict: "running", tapes };
}

describe("random 2-tape machines match an independent simulation", () => {
  for (const writable of [false, true]) {
    it(`200 deterministic machines, the input tape ${writable ? "writable" : "read-only"}`, () => {
      const next = rng(writable ? 913 : 912);
      let accepted = 0;
      let rewritten = 0;
      for (let k = 0; k < 200; k++) {
        const r = randomSteps(next);
        const m = parse(stepsYaml(r, writable));
        expect(m.storages.map(isReadOnlyTape)).toEqual([!writable, false]);
        for (const w of allWords(["a", "b"], 3)) {
          const expected = oracle(r, writable, w);
          // bounds past the oracle's steps: a run that halts there halts here too
          const got = runMachine(m, w, 600, 140);
          if (expected.verdict === "running") {
            expect(got.verdict, `${k} ${w}`).not.toBe("accepted");
            continue;
          }
          expect(got.verdict, `${k} ${w}`).toBe(expected.verdict);
          if (got.verdict !== "accepted") continue;
          accepted++;
          const tapes = got.acceptingPath!.at(-1)!.config.storages.map((s) => content(s as TapeState));
          expect(tapes, `${k} ${w}`).toEqual(expected.tapes.map(cellsText));
          if (tapes[0] !== w) rewritten++;
          // a read-only input tape ends as it began
          if (!writable) expect(tapes[0]).toBe(w);
        }
      }
      expect(accepted).toBeGreaterThan(150);
      // a writable input tape did get written
      if (writable) expect(rewritten).toBeGreaterThan(20);
    });
  }
});
