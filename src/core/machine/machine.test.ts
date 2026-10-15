import { describe, expect, it } from "vitest";
import {
  analyzeMachine,
  initialMachineConfig,
  machineCaps,
  machineToFSM,
  machineTransitionLabel,
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
  name: AnBnCn
  charset: a, b, c
  states: qa, qb, qc, ok
  init: qa
  accept: ok
  storages:
    v1: stack
    v2: stack
  transitions:
    - qa a $/A $/$ qa
    - qa $ $/$ $/$ qb
    - qb b A/$ $/B qb
    - qb $ $/$ $/$ qc
    - qc c $/$ B/$ qc
    - qc $ Z/$ Z/$ ok
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
  name: AnBnQueue
  charset: a, b
  states: collect, consume
  init: collect
  accept: consume
  acceptMode: emptyStorages
  storages:
    s: queue
  transitions:
    - collect a $/A collect
    - collect $ $/$ consume
    - consume b A/$ consume
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
    expect(collecting?.storages[0]).toBe("A");
  });
});

describe("general machine — tape input (TM-like)", () => {
  // rewrites the word to b's, then halts accepting at the end of the tape
  const m = parseMachine(`
Machine:
  name: Rewrite
  charset: a, b
  states: run, done
  init: run
  accept: done
  input: tape
  storages:
    tape: tape
  transitions:
    - run ./b > run
    - run _/_ = done
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
  name: Sweep
  charset: a
  states: s
  init: s
  accept: s
  input: t
  storages:
    t: tape
  transitions:
    - s a/a > s
`).value!;
    // runs over the a's, halts on _, s is accepting → accepts
    expect(runMachine(loop, "aaa").verdict).toBe("accepted");
  });
});

describe("determinism analysis", () => {
  it("reports no false positive for a deterministic stack machine", () => {
    const m = parseMachine(`
Machine:
  name: Det
  charset: a, b
  states: q
  init: q
  accept: q
  storages:
    v: stack
  transitions:
    - q a Z/AZ q
    - q b A/$ q
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
  name: D2
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
  name: EndsB
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
    expect(m.storages.map((s) => s.init)).toEqual(["Z", "XY", ""]);
  });
});

describe("error reporting", () => {
  it("a transition with the wrong token count gives a clear error", () => {
    const r = parseMachine(`
Machine:
  name: Broken
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
  name: Broken
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
  name: Broken
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
  it("custom machines get a label split into segments", () => {
    const m = parseMachine(TWO_STACKS).value!;
    const t = m.transitions.find((x) => x.from === "qb" && x.input === "b")!;
    expect(machineTransitionLabel(m, t)).toBe("b ‖ A / ε ‖ ε / B");
  });
});

describe("legacy Hungarian aliases", () => {
  it("still parse in worksheets saved by older versions", () => {
    const r = parseMachine(`
gep:
  name: Old
  charset: a
  states: q
  init: q
  accept: q
  input: fej
  storages:
    v: verem
    s: sor
  transitions: []
`);
    expect(r.ok).toBe(true);
    expect(r.value!.input).toBe("head");
    expect(r.value!.storages.map((s) => s.type)).toEqual(["stack", "queue"]);
  });
});
