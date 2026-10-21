import { describe, expect, it } from "vitest";
import {
  analyzeMachine,
  initialMachineConfig,
  machineCaps,
  machineToFSM,
  machineTransitionLabel,
  MoveLetters,
  runMachine,
  stepMachineConfigs,
  tapeWindow,
  TapeState
} from "./machine";
import { acceptsFSM } from "../fsm/fsm";
import { parseMachine } from "../parse/definitionParser";
import { serializeMachine } from "../parse/serialize";

const TWO_STACKS = `
Machine:
  name: M_{abc}
  charset: a, b, c
  states: qa, qb, qc, ok
  init: qa
  accept: ok
  storages:
    v1: stack
    v2: stack
  transitions:
    - qa a ε/A ε/ε qa
    - qa ε ε/ε ε/ε qb
    - qb b A/ε ε/B qb
    - qb ε ε/ε ε/ε qc
    - qc c ε/ε B/ε qc
    - qc ε Z/ε Z/ε ok
`;

describe("general machine — two stacks", () => {
  const m = parseMachine(TWO_STACKS).value!;

  it("parse: two stacks, read head", () => {
    expect(m.storages.map((s) => s.type)).toEqual(["stack", "stack"]);
    expect(m.input).toBe("head");
    expect(machineCaps(m).isFSMLike).toBe(false);
    expect(machineCaps(m).kind).toBe("general");
    expect(machineCaps(m).storageCounts?.stack).toBe(2);
  });

  it("recognises a^n b^n c^n (not context-free!)", () => {
    expect(runMachine(m, "").verdict).toBe("accepted");
    expect(runMachine(m, "abc").verdict).toBe("accepted");
    expect(runMachine(m, "aabbcc").verdict).toBe("accepted");
    expect(runMachine(m, "aaabbbccc").verdict).toBe("accepted");
    expect(runMachine(m, "aabbc").verdict).toBe("rejected");
    expect(runMachine(m, "abcc").verdict).toBe("rejected");
    expect(runMachine(m, "cba").verdict).toBe("rejected");
  });

  it("serialisation round trip preserves behaviour", () => {
    const re = parseMachine(serializeMachine(m));
    expect(re.ok).toBe(true);
    for (const w of ["", "abc", "aabbcc", "ab", "abca"]) {
      expect(runMachine(re.value!, w).verdict).toBe(runMachine(m, w).verdict);
    }
  });
});

describe("general machine — queue automaton", () => {
  // a^n b^n with a queue: the a's are enqueued, the b's dequeue them (FIFO)
  const m = parseMachine(`
Machine:
  name: Q
  charset: a, b
  states: collect, consume
  init: collect
  accept: consume
  acceptMode: emptyStorages
  storages:
    s: queue
  transitions:
    - collect a ε/A collect
    - collect ε ε/ε consume
    - consume b A/ε consume
`).value!;

  it("recognises a^n b^n", () => {
    expect(runMachine(m, "").verdict).toBe("accepted");
    expect(runMachine(m, "ab").verdict).toBe("accepted");
    expect(runMachine(m, "aaabbb").verdict).toBe("accepted");
    expect(runMachine(m, "abb").verdict).toBe("rejected");
    expect(runMachine(m, "ba").verdict).toBe("rejected");
  });

  it("FIFO behaviour: the front of the queue is removed", () => {
    const c0 = initialMachineConfig(m, "ab");
    const after = stepMachineConfigs(m, [c0], "ab");
    const collecting = after.find((c) => c.state === "collect");
    expect(collecting?.storages[0]).toEqual(["A"]);
  });
});

describe("general machine — tape input (TM-like)", () => {
  // rewrites the word to b's, then halts accepting at the end of the tape
  const m = parseMachine(`
Machine:
  name: R
  charset: a, b
  states: run, done
  init: run
  accept: done
  input: tape
  storages:
    tape: tape
  transitions:
    - run ./b R run
    - run _/_ S done
`).value!;

  it("accepts on halting and rewrites the tape", () => {
    expect(machineCaps(m).isTMLike).toBe(true);
    const r = runMachine(m, "aab");
    expect(r.verdict).toBe("accepted");
    const last = r.acceptingPath![r.acceptingPath!.length - 1].config;
    const tape = last.storages[0] as TapeState;
    expect(tapeWindow(tape, 10).cells.join("").replace(/_+$/, "")).toBe("bbb");
  });

  it("an accepting state alone is not enough: it decides only on halting", () => {
    const loop = parseMachine(`
Machine:
  name: W
  charset: a
  states: s
  init: s
  accept: s
  input: t
  storages:
    t: tape
  transitions:
    - s a/a R s
`).value!;
    // runs over the a's, halts on _, s is accepting → accepts
    expect(runMachine(loop, "aaa").verdict).toBe("accepted");
  });
});

describe("determinism analysis", () => {
  it("reports no false positive for a deterministic stack machine", () => {
    const m = parseMachine(`
Machine:
  name: D
  charset: a, b
  states: q
  init: q
  accept: q
  storages:
    v: stack
  transitions:
    - q a Z/AZ q
    - q b A/ε q
`).value!;
    expect(analyzeMachine(m).isDeterministic).toBe(true);
  });

  it("an ε-input transition clashing with a reading one is nondeterminism", () => {
    const m = parseMachine(TWO_STACKS).value!;
    const a = analyzeMachine(m);
    expect(a.isDeterministic).toBe(false);
    expect(a.hasEpsilonInput).toBe(true);
    expect(a.nondeterministicAt.some((n) => n.state === "qa")).toBe(true);
  });

  it("transitions expecting different stack tops do not clash", () => {
    const m = parseMachine(`
Machine:
  name: D_2
  charset: a
  states: q
  init: q
  accept: q
  storages:
    v: stack
  transitions:
    - q a Z/Z q
    - q a A/A q
`).value!;
    expect(analyzeMachine(m).isDeterministic).toBe(true);
  });
});

describe("capabilities: storage-free machine = finite automaton", () => {
  const m = parseMachine(`
Machine:
  name: E
  charset: a, b
  states: N, B
  init: N
  accept: B
  transitions:
    - N a N
    - N b B
    - B a N
    - B b B
`).value!;

  it("machineToFSM agrees with the machine simulation", () => {
    expect(machineCaps(m).isFSMLike).toBe(true);
    const f = machineToFSM(m)!;
    for (const w of ["", "b", "ab", "ba", "abab"]) {
      expect(runMachine(m, w).verdict).toBe(acceptsFSM(f, w) ? "accepted" : "rejected");
    }
  });

  it("a machine with storages cannot be turned into an automaton", () => {
    const p = parseMachine(TWO_STACKS).value!;
    expect(machineToFSM(p)).toBe(null);
  });
});

describe("storages format", () => {
  it("nested form and the stack default (Z)", () => {
    const m = parseMachine(`
Machine:
  name: S
  charset: a
  states: q
  init: q
  accept: q
  storages:
    short: stack
    detailed:
      type: stack
      init: XY
    empty:
      type: stack
      init: ""
  transitions: []
`).value!;
    expect(m.storages.map((s) => s.init)).toEqual([["Z"], ["X", "Y"], []]);
  });
});

describe("error reporting", () => {
  it("a transition with the wrong token count gives a clear error", () => {
    const r = parseMachine(`
Machine:
  name: B
  charset: a
  states: q
  init: q
  accept: q
  storages:
    v: stack
  transitions:
    - q a q
`);
    expect(r.ok).toBe(false);
    expect(r.diagnostics[0].title.key).toBe("definitionParser.machine.invalidTransition.title");
    expect(r.diagnostics[0].detail?.params?.count).toBe(4);
  });

  it("unknown storage type", () => {
    const r = parseMachine(`
Machine:
  name: B
  charset: a
  states: q
  init: q
  accept: q
  storages:
    v: heap
  transitions: []
`);
    expect(r.ok).toBe(false);
    expect(r.diagnostics[0].title.key).toBe("definitionParser.unknownStorageType.title");
  });

  it("the input field must be head or a storage id", () => {
    const r = parseMachine(`
Machine:
  name: B
  charset: a
  states: q
  init: q
  accept: q
  input: nosuchstorage
  transitions: []
`);
    expect(r.ok).toBe(false);
    expect(r.diagnostics[0].title.key).toBe("definitionParser.machine.badInputField.title");
  });
});

describe("edge labels", () => {
  const labels = (src: string, moves?: MoveLetters) => {
    const m = parseMachine(src).value!;
    return m.transitions.map((t) => machineTransitionLabel(m, t, moves));
  };
  const TM = `
Machine:
  charset: 0, 1
  states: r, c, d
  init: r
  accept: d
  input: tape
  storages:
    tape: tape
  transitions:
    - r 1/0 L c
    - c 0/& R c
    - c _/1 S d
`;

  it("custom machines name each storage and leave out untouched ones", () => {
    const m = parseMachine(TWO_STACKS).value!;
    const label = (from: string, input: string) =>
      machineTransitionLabel(m, m.transitions.find((x) => x.from === from && x.input === input)!);
    expect(label("qb", "b")).toBe("b; v1: A → ε; v2: ε → B");
    expect(label("qa", "a")).toBe("a; v1: ε → A");
    expect(label("qa", "ε")).toBe("ε");
  });

  it("pushdown automata read as in the lecture notes: a; Z → AZ", () => {
    expect(
      labels(`
Machine:
  charset: a, b
  states: q0, q1
  init: q0
  accept: q1
  storages:
    stack: stack
  transitions:
    - q0 a Z/AZ q0
    - q0 b A/ε q1
    - q1 ε ε/ε q1
`)
    ).toEqual(["a; Z → AZ", "b; A → ε", "ε; ε → ε"]);
  });

  it("Turing machines read as in the lecture notes: a → b, D with the move's letter", () => {
    expect(labels(TM)).toEqual(["1 → 0, L", "0 → 0, R", "_ → 1, S"]);
  });

  it("the move letters are the UI language's: J, B, H in Hungarian", () => {
    expect(labels(TM, { R: "J", L: "B", S: "H" })).toEqual(["1 → 0, B", "0 → 0, J", "_ → 1, H"]);
  });

  it("a tape of a custom machine is named too, with the same notation", () => {
    const m = parseMachine(`
Machine:
  charset: a
  states: q
  init: q
  accept: q
  storages:
    s: stack
    t: tape
  transitions:
    - q a Z/Z a/& R q
`).value!;
    expect(machineTransitionLabel(m, m.transitions[0])).toBe("a; s: Z → Z; t: a → a, R");
  });
});

describe("head moves in the YAML: R, L, S", () => {
  const tm = (move: string) =>
    parseMachine(`
Machine:
  charset: a
  states: q
  init: q
  accept: q
  input: tape
  storages:
    tape: tape
  transitions:
    - q a/a ${move} q
`);

  it("reads the three English letters", () => {
    expect(tm("R").value!.transitions[0].ops[0]).toEqual({ type: "tape", read: "a", write: "a", move: "R" });
    expect(tm("L").value!.transitions[0].ops[0]).toMatchObject({ move: "L" });
    expect(tm("S").value!.transitions[0].ops[0]).toMatchObject({ move: "S" });
  });

  it("rejects the old arrows and the localized letters alike", () => {
    for (const move of [">", "<", "=", "J", "B", "H", "N", "r"]) {
      const r = tm(move);
      expect(r.ok).toBe(false);
      expect(r.diagnostics[0].title.key).toBe("definitionParser.storageOp.unknownMove.title");
    }
  });

  it("writes them back as letters", () => {
    const yaml = serializeMachine(tm("L").value!);
    expect(yaml).toContain("- q a/a L q");
  });
});

describe("$ is an ordinary symbol", () => {
  it("works as a bottom-of-stack marker", () => {
    const r = parseMachine(`
Machine:
  name: B
  charset: a, b
  states: q0, q1, q2
  init: q0
  accept: q2
  storages:
    stack:
      type: stack
      init: $
  transitions:
    - q0 a $/A$ q0
    - q0 a A/AA q0
    - q0 b A/ε q1
    - q1 b A/ε q1
    - q1 ε $/$ q2
`);
    expect(r.ok).toBe(true);
    expect(runMachine(r.value!, "aabb").verdict).toBe("accepted");
    expect(runMachine(r.value!, "aab").verdict).toBe("rejected");
  });
});
