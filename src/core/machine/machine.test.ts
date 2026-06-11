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
import { parseMachine, parseFSM } from "../parse/definitionParser";
import { serializeMachine } from "../parse/serialize";

const KETVEREM = `
Machine:
  name: AnBnCn
  charset: a, b, c
  states: qa, qb, qc, ok
  init: qa
  accept: ok
  storages:
    v1: stack(Z)
    v2: stack(Z)
  transitions:
    - qa a $/A $/$ qa
    - qa $ $/$ $/$ qb
    - qb b A/$ $/B qb
    - qb $ $/$ $/$ qc
    - qc c $/$ B/$ qc
    - qc $ Z/$ Z/$ ok
`;

describe("általános gép — kétvermes", () => {
  const m = parseMachine(KETVEREM).value!;

  it("parse: két verem, olvasófej", () => {
    expect(m.storages.map((s) => s.type)).toEqual(["stack", "stack"]);
    expect(m.input).toBe("head");
    expect(machineCaps(m).isFSMLike).toBe(false);
    expect(machineCaps(m).label).toContain("2 verem");
  });

  it("a^n b^n c^n felismerése (nem környezetfüggetlen!)", () => {
    expect(runMachine(m, "").verdict).toBe("accepted");
    expect(runMachine(m, "abc").verdict).toBe("accepted");
    expect(runMachine(m, "aabbcc").verdict).toBe("accepted");
    expect(runMachine(m, "aaabbbccc").verdict).toBe("accepted");
    expect(runMachine(m, "aabbc").verdict).toBe("rejected");
    expect(runMachine(m, "abcc").verdict).toBe("rejected");
    expect(runMachine(m, "cba").verdict).toBe("rejected");
  });

  it("szerializálás-oda-vissza megőrzi a viselkedést", () => {
    const re = parseMachine(serializeMachine(m));
    expect(re.ok).toBe(true);
    for (const w of ["", "abc", "aabbcc", "ab", "abca"]) {
      expect(runMachine(re.value!, w).verdict).toBe(runMachine(m, w).verdict);
    }
  });
});

describe("általános gép — sorautomata (queue)", () => {
  // a^n b^n sorral: az a-k bekerülnek a sorba, a b-k kiveszik őket (FIFO)
  const m = parseMachine(`
Machine:
  name: AnBnSor
  charset: a, b
  states: gyujt, fogyaszt
  init: gyujt
  accept: fogyaszt
  acceptMode: emptyStorages
  storages:
    s: queue
  transitions:
    - gyujt a $/A gyujt
    - gyujt $ $/$ fogyaszt
    - fogyaszt b A/$ fogyaszt
`).value!;

  it("a^n b^n felismerése", () => {
    expect(runMachine(m, "").verdict).toBe("accepted");
    expect(runMachine(m, "ab").verdict).toBe("accepted");
    expect(runMachine(m, "aaabbb").verdict).toBe("accepted");
    expect(runMachine(m, "abb").verdict).toBe("rejected");
    expect(runMachine(m, "ba").verdict).toBe("rejected");
  });

  it("FIFO-viselkedés: a sor eleje kerül ki", () => {
    const c0 = initialMachineConfig(m, "ab");
    const after = stepMachineConfigs(m, [c0], "ab");
    const collecting = after.find((c) => c.state === "gyujt");
    expect(collecting?.storages[0]).toBe("A");
  });
});

describe("általános gép — szalagos bemenet (TM-szerű)", () => {
  // a szót b-kre írja át, majd a szalag végén megáll elfogadva
  const m = parseMachine(`
Machine:
  name: Atiro
  charset: a, b
  states: megy, kesz
  init: megy
  accept: kesz
  input: szalag
  storages:
    szalag: tape
  transitions:
    - megy ./b > megy
    - megy _/_ = kesz
`).value!;

  it("megálláskor fogad el, a szalagot átírja", () => {
    expect(machineCaps(m).isTMLike).toBe(true);
    const r = runMachine(m, "aab");
    expect(r.verdict).toBe("accepted");
    const last = r.acceptingPath![r.acceptingPath!.length - 1].config;
    const tape = last.storages[0] as TapeState;
    expect(tapeWindow(tape, 10).cells.join("").replace(/_+$/, "")).toBe("bbb");
  });

  it("elfogadó állapot önmagában nem elég: csak megálláskor dönt", () => {
    const loop = parseMachine(`
Machine:
  name: Vegtelen
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
    // a-n végigmegy, az _ alatt megáll, s elfogadó → elfogad
    expect(runMachine(loop, "aaa").verdict).toBe("accepted");
  });
});

describe("determinizmus-analízis", () => {
  it("determinisztikus kétvermes gépnél nem jelez álpozitívat", () => {
    const m = parseMachine(`
Machine:
  name: Det
  charset: a, b
  states: q
  init: q
  accept: q
  storages:
    v: stack(Z)
  transitions:
    - q a Z/AZ q
    - q b A/$ q
`).value!;
    expect(analyzeMachine(m).isDeterministic).toBe(true);
  });

  it("ε-bemenet + olvasó átmenet ütközése nemdeterminizmus", () => {
    const m = parseMachine(KETVEREM).value!;
    const a = analyzeMachine(m);
    expect(a.isDeterministic).toBe(false);
    expect(a.hasEpsilonInput).toBe(true);
    expect(a.nondeterministicAt.some((n) => n.state === "qa")).toBe(true);
  });

  it("különböző veremtetőre váró átmenetek nem ütköznek", () => {
    const m = parseMachine(`
Machine:
  name: D2
  charset: a
  states: q
  init: q
  accept: q
  storages:
    v: stack(Z)
  transitions:
    - q a Z/Z q
    - q a A/A q
`).value!;
    expect(analyzeMachine(m).isDeterministic).toBe(true);
  });
});

describe("képességek: tárolómentes gép = véges automata", () => {
  const m = parseMachine(`
Machine:
  name: VegeB
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

  it("machineToFSM és a viselkedés egyezik", () => {
    expect(machineCaps(m).isFSMLike).toBe(true);
    const f = machineToFSM(m)!;
    const ref = parseFSM(`
StateMachine:
  name: VegeB
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
    for (const w of ["", "b", "ab", "ba", "abab"]) {
      expect(acceptsFSM(f, w)).toBe(acceptsFSM(ref, w));
      expect(runMachine(m, w).verdict).toBe(acceptsFSM(ref, w) ? "accepted" : "rejected");
    }
  });

  it("tárolós gép nem alakítható automatává", () => {
    const p = parseMachine(KETVEREM).value!;
    expect(machineToFSM(p)).toBe(null);
  });
});

describe("hibajelzések", () => {
  it("rossz tokenszámú átmenet érthető hibát ad", () => {
    const r = parseMachine(`
Machine:
  name: Hibas
  charset: a
  states: q
  init: q
  accept: q
  storages:
    v: stack(Z)
  transitions:
    - q a q
`);
    expect(r.ok).toBe(false);
    expect(r.diagnostics[0].title).toContain("Hibás átmenet");
    expect(r.diagnostics[0].detail).toContain("4 elem");
  });

  it("ismeretlen tárolótípus", () => {
    const r = parseMachine(`
Machine:
  name: Hibas
  charset: a
  states: q
  init: q
  accept: q
  storages:
    v: heap
  transitions: []
`);
    expect(r.ok).toBe(false);
    expect(r.diagnostics[0].title).toContain("Ismeretlen tárolótípus");
  });

  it("input mező csak head vagy tároló-id lehet", () => {
    const r = parseMachine(`
Machine:
  name: Hibas
  charset: a
  states: q
  init: q
  accept: q
  input: nincsilyen
  transitions: []
`);
    expect(r.ok).toBe(false);
    expect(r.diagnostics[0].title).toContain("input");
  });
});

describe("él-címkék", () => {
  it("egyedi gépnél szegmensekre bontott címke", () => {
    const m = parseMachine(KETVEREM).value!;
    const t = m.transitions.find((x) => x.from === "qb" && x.input === "b")!;
    expect(machineTransitionLabel(m, t)).toBe("b ‖ A / ε ‖ ε / B");
  });
});
