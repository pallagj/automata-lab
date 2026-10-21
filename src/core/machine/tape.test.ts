import { describe, expect, it } from "vitest";
import {
  initialMachineConfig,
  isAcceptingMachineConfig,
  Machine,
  machineCaps,
  machineConfigKey,
  machineMoves,
  machineTransitionLabel,
  runMachine,
  StorageOp,
  TapeExtent,
  TapeState,
  tapeWindow
} from "./machine";
import { parseMachine } from "../parse/definitionParser";
import { serializeMachine } from "../parse/serialize";
import { allWords, rng } from "../testing";
import { EXAMPLE_WORKSHEETS } from "../../state/examples";

/** A one-tape machine with the input on the tape; `storage` is the tape's entry. */
const tm = (transitions: string[], accept = "ok", storage = "    t: tape", states = "s, t, ok") =>
  [
    "Machine:",
    "  name: T",
    "  charset: a, b",
    `  states: ${states}`,
    "  init: s",
    `  accept: ${accept}`,
    "  input: t",
    "  storages:",
    storage,
    "  transitions:",
    ...transitions.map((l) => `    - ${l}`)
  ].join("\n");

const BOTH = "    t:\n      type: tape\n      infinite: both";
const parse = (src: string) => {
  const r = parseMachine(src);
  expect(r.ok, JSON.stringify(r.diagnostics)).toBe(true);
  return r.value!;
};
const errorKey = (src: string) => parseMachine(src).diagnostics.find((d) => d.level === "error")?.title.key;

type TapeOp = Extract<StorageOp, { type: "tape" }>;

/**
 * An independent oracle for a deterministic one-tape machine: a plain loop over a map of
 * cells. On a one-way tape a head left of cell 0 halts the run with an error.
 */
function oracle(m: Machine, input: string, maxSteps = 150): "accepted" | "rejected" | "running" {
  const oneWay = m.storages[0].infinite !== "both";
  const tape = new Map<number, string>([...input].map((c, i) => [i, c]));
  let head = 0;
  let state = m.start;
  for (let step = 0; step < maxSteps; step++) {
    const read = tape.get(head) ?? "_";
    const t = m.transitions.find((x) => x.from === state && (x.ops[0] as TapeOp).read === read);
    if (!t) return m.accept.includes(state) ? "accepted" : "rejected";
    const op = t.ops[0] as TapeOp;
    tape.set(head, op.write);
    head += op.move === "R" ? 1 : op.move === "L" ? -1 : 0;
    state = t.to;
    if (oneWay && head < 0) return "rejected";
  }
  return "running";
}

/** A random deterministic one-tape machine over {a, b} with Γ = {a, b, _}. */
function randomTM(next: () => number, infinite: TapeExtent): Machine {
  const n = 1 + Math.floor(next() * 4);
  const states = Array.from({ length: n }, (_, i) => `q${i}`);
  const pick = <T,>(xs: T[]) => xs[Math.floor(next() * xs.length)];
  const transitions: Machine["transitions"] = [];
  for (const from of states)
    for (const read of ["a", "b", "_"])
      if (next() < 0.75)
        transitions.push({
          from,
          to: pick(states),
          input: "ε",
          ops: [{ type: "tape", read, write: pick(["a", "b", "_"]), move: pick(["L", "R", "S"] as const) }]
        });
  return {
    kind: "machine",
    name: "R",
    alphabet: ["a", "b"],
    states,
    start: "q0",
    accept: states.filter(() => next() < 0.4),
    acceptMode: "finalState",
    input: "t",
    storages: [{ id: "t", type: "tape", alphabet: ["a", "b", "_"], init: [], infinite }],
    transitions
  };
}

describe("a tape is infinite to the right only, as in the lecture notes (9.1)", () => {
  it("by default: the parsed tape says so", () => {
    expect(parse(tm(["(s, a) -> (ok, a, S)"])).storages[0].infinite).toBe("right");
    expect(parse(tm(["(s, a) -> (ok, a, S)"], "ok", BOTH)).storages[0].infinite).toBe("both");
  });

  it("a head stepping left off the first cell halts the machine with an error: rejected", () => {
    // per the notes the step falls off; with a tape infinite both ways it reads a blank and accepts
    const steps = ["(s, a) -> (t, a, L)", "(t, _) -> (ok, _, S)"];
    expect(runMachine(parse(tm(steps)), "a").verdict).toBe("rejected");
    expect(runMachine(parse(tm(steps, "ok", BOTH)), "a").verdict).toBe("accepted");
  });

  it("even from an accepting state: falling off is no halt in that state", () => {
    // s is accepting; its only move steps left from cell 0
    const steps = ["(s, a) -> (s, a, L)"];
    expect(runMachine(parse(tm(steps, "s")), "a").verdict).toBe("rejected");
    // on a tape infinite both ways the machine halts in s on the blank at −1
    expect(runMachine(parse(tm(steps, "s", BOTH)), "a").verdict).toBe("accepted");
    // not a step taken: halting right away in s accepts
    expect(runMachine(parse(tm(steps, "s")), "b").verdict).toBe("accepted");
  });

  it("the write is made before the head falls off, and the configuration says which tape", () => {
    const m = parse(tm(["(s, a) -> (t, b, L)"]));
    const moves = machineMoves(m, initialMachineConfig(m, "a"), "a");
    expect(moves).toHaveLength(1);
    const c = moves[0].config;
    expect(c.fellOff).toBe("t");
    expect(c.state).toBe("t");
    const tape = c.storages[0] as TapeState;
    expect(tape.head).toBe(-1);
    expect(tape.cells.get(0)).toBe("b");
    // halted: no move, no acceptance — not even if the state accepts
    expect(machineMoves(m, c, "a")).toEqual([]);
    expect(isAcceptingMachineConfig({ ...m, accept: ["t"] }, c, "a")).toBe(false);
    // a different configuration from the same one without the fall
    expect(machineConfigKey(c)).not.toBe(machineConfigKey({ ...c, fellOff: undefined }));
  });

  it("a nondeterministic machine accepts if any branch does: one falling off is just a rejecting branch", () => {
    const steps = ["(s, a) -> (t, a, L)", "(s, a) -> (ok, a, R)"];
    expect(runMachine(parse(tm(steps)), "a").verdict).toBe("accepted");
    // every branch falls off: rejected
    expect(runMachine(parse(tm(["(s, a) -> (t, a, L)", "(s, a) -> (ok, a, L)"])), "a").verdict).toBe("rejected");
  });

  it("the window of a one-way tape starts at its first cell; a fallen head is left of it", () => {
    const tape: TapeState = { cells: new Map([[0, "a"], [1, "b"]]), head: -1 };
    expect(tapeWindow(tape, 5, true)).toEqual({ cells: ["a", "b"], headIndex: -1, startPos: 0 });
    // infinite both ways: cell −1 is a blank like any other
    expect(tapeWindow(tape, 5, false)).toEqual({ cells: ["_", "a", "b"], headIndex: 0, startPos: -1 });
    // an empty tape still shows its first cell
    expect(tapeWindow({ cells: new Map(), head: 0 }, 5, true)).toEqual({ cells: ["_"], headIndex: 0, startPos: 0 });
  });

  for (const infinite of ["right", "both"] as const) {
    it(`matches an independent simulation on 250 random deterministic machines (infinite: ${infinite})`, () => {
      const next = rng(infinite === "right" ? 91 : 92);
      let fell = 0;
      for (let k = 0; k < 250; k++) {
        const m = randomTM(next, infinite);
        for (const w of allWords(["a", "b"], 4)) {
          const expected = oracle(m, w);
          // bounds just past the oracle's 150 steps: a run that halts there halts here too
          const got = runMachine(m, w, 600, 170).verdict;
          if (expected === "running") expect(got, `${k} ${w}`).not.toBe("accepted");
          else expect(got, `${k} ${w}`).toBe(expected);
          if (infinite === "right" && expected === "rejected" && oracle({ ...m, storages: [{ ...m.storages[0], infinite: "both" }] }, w) !== "rejected")
            fell++;
        }
      }
      // the boundary did decide some runs
      if (infinite === "right") expect(fell).toBeGreaterThan(30);
    });
  }
});

describe("the tape's extent in the YAML", () => {
  it("takes right or both, on a tape only", () => {
    expect(errorKey(tm(["(s, a) -> (ok, a, S)"], "ok", "    t:\n      type: tape\n      infinite: right"))).toBeUndefined();
    expect(errorKey(tm(["(s, a) -> (ok, a, S)"], "ok", "    t:\n      type: tape\n      infinite: left"))).toBe(
      "definitionParser.badInfinite.title"
    );
    const stack = [
      "Machine:",
      "  charset: a",
      "  states: q",
      "  init: q",
      "  accept: q",
      "  storages:",
      "    v:",
      "      type: stack",
      "      infinite: both",
      "  transitions:",
      "    - (q, a, Z) -> (q, Z)"
    ].join("\n");
    expect(errorKey(stack)).toBe("definitionParser.infiniteOnlyForTape.title");
  });

  it("reads back unchanged: a tape infinite both ways is written out, the notes' tape is the short form", () => {
    const both = parse(tm(["(s, a) -> (ok, a, L)"], "ok", BOTH));
    const yaml = serializeMachine(both);
    expect(yaml).toContain("      infinite: both");
    expect(parse(yaml)).toEqual(both);
    const right = parse(tm(["(s, a) -> (ok, a, L)"]));
    expect(serializeMachine(right)).toContain("    t: tape\n");
    expect(serializeMachine(right)).not.toContain("infinite");
    expect(parse(serializeMachine(right))).toEqual(right);
  });
});

describe("a k-tape Turing machine (lecture notes 9.9)", () => {
  const T2 = EXAMPLE_WORKSHEETS.flatMap((w) => w.cells).find((c) => c.includes("name: T_2"))!;

  it("tapes only, the input on one of them: a Turing machine, with its number of tapes", () => {
    const m = parse(T2);
    expect(machineCaps(m)).toMatchObject({ isTMLike: true, kind: "tm", storageCounts: { tape: 2 } });
    expect(machineCaps(parse(tm(["(s, a) -> (ok, a, S)"])))).toMatchObject({ kind: "tm", storageCounts: undefined });
    // a stack beside the tape: no longer a Turing machine
    const mixed: Machine = { ...m, storages: [m.storages[0], { id: "v", type: "stack", alphabet: ["Z"], init: ["Z"] }] };
    expect(machineCaps(mixed).kind).toBe("general");
  });

  it("the example accepts exactly aⁿbⁿ (n ≥ 0), never falling off its tapes", () => {
    const m = parse(T2);
    for (const w of allWords(["a", "b"], 8)) {
      const n = w.length / 2;
      const inL = w === "a".repeat(n) + "b".repeat(n);
      expect(runMachine(m, w).verdict, w).toBe(inL ? "accepted" : "rejected");
    }
  });

  it("falling off any tape halts the machine — here the second one", () => {
    const src = [
      "Machine:",
      "  charset: a",
      "  states: s, ok",
      "  init: s",
      "  accept: ok",
      "  input: t1",
      "  storages:",
      "    t1: tape",
      "    t2: tape",
      "  transitions:",
      "    - (s, a, _) -> (ok, a, R, _, L)"
    ].join("\n");
    const m = parse(src);
    const c = machineMoves(m, initialMachineConfig(m, "a"), "a")[0].config;
    expect(c.fellOff).toBe("t2");
    expect(runMachine(m, "a").verdict).toBe("rejected");
  });

  it("an edge reads as in figure 9.28: the symbols read, the symbols written, the moves", () => {
    const m = parse(T2);
    const hu = { R: "J", L: "B", S: "H" };
    const labels = m.transitions.map((t) => machineTransitionLabel(m, t, hu));
    expect(labels).toContain("a, _ → a, Y, J, J");
    expect(labels).toContain("b, _ → b, _, H, B");
    // one tape: a → b, D as before
    const one = parse(tm(["(s, a) -> (ok, b, R)"]));
    expect(machineTransitionLabel(one, one.transitions[0], hu)).toBe("a → b, J");
  });
});

describe("the example worksheets' Turing machines", () => {
  const cells = EXAMPLE_WORKSHEETS.flatMap((w) => w.cells);
  const named = (name: string) => parse(cells.find((c) => c.includes(`name: ${name}\n`))!);

  it("the binary increment needs its tape infinite both ways: 11 + 1 = 100", () => {
    const m = named("T_{inc}");
    expect(m.storages[0].infinite).toBe("both");
    const result = (w: string) => {
      const r = runMachine(m, w);
      expect(r.verdict, w).toBe("accepted");
      const t = r.acceptingPath!.at(-1)!.config.storages[0] as TapeState;
      return tapeWindow(t, 40).cells.join("").replace(/^_+|_+$/g, "");
    };
    for (let n = 0; n < 40; n++) expect(result(n.toString(2))).toBe((n + 1).toString(2));
    // on the notes' tape the carry out of the first digit falls off
    const oneWay: Machine = { ...m, storages: [{ ...m.storages[0], infinite: "right" }] };
    expect(runMachine(oneWay, "11").verdict).toBe("rejected");
    expect(runMachine(oneWay, "10").verdict).toBe("accepted");
  });
});
