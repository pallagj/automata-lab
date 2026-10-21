import { describe, expect, it, vi } from "vitest";
import { DraftStorage, EntityDraft, parseEntityDraft, reshapeDraft, serializeEntityDraft } from "./EntityForm";
import { parseGrammar, parseMachine } from "../../core/parse/definitionParser";
import { isReadOnlyTape, Machine, runMachine } from "../../core/machine/machine";
import { CELL_TEMPLATES, EXAMPLE_WORKSHEETS } from "../../state/examples";
import { allWords } from "../../core/testing";

// the draft is plain data; the store (and the i18n it loads) wants a browser
vi.mock("../../state/store", () => ({ useAppStore: () => undefined }));

const grammar = (rules: string[]) =>
  ["Grammar:", "  name: G", "  charset: a, b", "  variables: S, A", "  init: S", "  rules:", ...rules.map((r) => `    - ${r}`)].join("\n");

describe("a grammar's rules in the form", () => {
  it("are the left-hand side, then each alternative", () => {
    const d = parseEntityDraft(grammar(["S -> aS | b|ε", "A -> a"]))!;
    expect(d.rows).toEqual([
      ["S", "aS", "b", "ε"],
      ["A", "a"]
    ]);
  });

  it("are written back as one line each, as the notes write them", () => {
    const d = parseEntityDraft(grammar(["S -> aS | b|ε", "A -> a"]))!;
    expect(serializeEntityDraft(d)).toBe(grammar(["S -> aS | b | ε", "A -> a"]));
    expect(parseGrammar(serializeEntityDraft(d)).ok).toBe(true);
  });

  it("leave out an alternative left empty, so it never means ε", () => {
    const d = parseEntityDraft(grammar(["S -> aS"]))!;
    d.rows = [["S", "", "aS", " ", "b"]];
    expect(serializeEntityDraft(d)).toBe(grammar(["S -> aS | b"]));
  });

  it("an empty right-hand side stays empty, and the parser asks for ε", () => {
    const d = parseEntityDraft(grammar(["S -> aS"]))!;
    d.rows = [["S", ""]];
    const yaml = serializeEntityDraft(d);
    expect(yaml).toBe(grammar(["S -> "]));
    expect(parseGrammar(yaml).diagnostics[0].title.key).toBe("definitionParser.grammar.emptyAlternative.title");
  });
});

describe("a tape's extent in the form", () => {
  const machine = (storage: string) =>
    [
      "Machine:",
      "  name: T",
      "  charset: a, b",
      "  states: s, ok",
      "  init: s",
      "  accept: ok",
      "  input: t",
      "  storages:",
      storage,
      "  transitions:",
      "    - (s, a) -> (ok, a, L)"
    ].join("\n");

  it("is the notes' tape by default, and the short form stays short", () => {
    const src = machine("    t: tape");
    const d = parseEntityDraft(src)!;
    expect(d.storages[0].infinite).toBe("right");
    expect(serializeEntityDraft(d)).toBe(src);
  });

  it("a tape infinite both ways reads back unchanged", () => {
    const src = machine("    t:\n      type: tape\n      infinite: both");
    const d = parseEntityDraft(src)!;
    expect(d.storages[0].infinite).toBe("both");
    expect(serializeEntityDraft(d)).toBe(src);
    expect(parseMachine(serializeEntityDraft(d)).value!.storages[0].infinite).toBe("both");
  });
});

describe("a k-tape machine's input tape in the form (lecture notes 9.9)", () => {
  const cells = EXAMPLE_WORKSHEETS.flatMap((w) => w.cells);
  const T2 = cells.find((c) => c.includes("name: T_2"))!;
  const PAL = cells.find((c) => c.includes("name: T_{pal}"))!;
  const machine = (src: string): Machine => {
    const r = parseMachine(src);
    expect(r.ok, JSON.stringify(r.diagnostics)).toBe(true);
    return r.value!;
  };
  /** the same verdict on every word up to the length */
  const sameLanguage = (a: Machine, b: Machine, n: number) => {
    for (const w of allWords(a.alphabet, n)) expect(runMachine(b, w).verdict, w).toBe(runMachine(a, w).verdict);
  };
  const tape = (id: string): DraftStorage => ({ id, type: "tape", charset: "", init: "", infinite: "right", readOnly: false });
  const withStorages = (d: EntityDraft, storages: DraftStorage[]): EntityDraft => ({ ...d, storages });

  it("is read-only: its row has no field written on it, and the YAML reads back unchanged", () => {
    const d = parseEntityDraft(T2)!;
    expect(d.storages.map((s) => s.readOnly)).toEqual([true, false]);
    // from, t1 read, t1 move, t2 read, t2 write, t2 move, to
    expect(d.rows[1]).toEqual(["q_0", "a", "R", "_", "Y", "R", "q_1"]);
    expect(serializeEntityDraft(d)).toBe(T2);
  });

  it("a chosen write access reads back unchanged too", () => {
    for (const storages of [
      ["    t1:", "      type: tape", "      writable: true", "    t2: tape"],
      ["    t1: tape", "    t2:", "      type: tape", "      writable: false"]
    ]) {
      const src = [
        "Machine:",
        "  name: T",
        "  charset: a, b",
        "  states: s, ok",
        "  init: s",
        "  accept: ok",
        "  input: t1",
        "  storages:",
        ...storages,
        "  transitions:",
        storages[2].includes("writable") ? "    - (s, a, _) -> (ok, b, a, R, L)" : "    - (s, a, _) -> (ok, R, L)"
      ].join("\n");
      expect(serializeEntityDraft(parseEntityDraft(src)!)).toBe(src);
    }
  });

  it("a second tape on a machine that writes back what it reads: the input tape becomes the notes' read-only one", () => {
    const prev = parseEntityDraft(CELL_TEMPLATES.tm)!;
    const next = reshapeDraft(prev, withStorages(prev, [...prev.storages, tape("t2")]));
    expect(next.storages.map((s) => s.readOnly)).toEqual([true, false]);
    const yaml = serializeEntityDraft(next);
    expect(yaml).not.toContain("writable");
    expect(yaml).toContain("- (start, a, a) -> (start, a, R, S)");
    sameLanguage(machine(CELL_TEMPLATES.tm), machine(yaml), 6);
  });

  it("a second tape on a machine that writes its tape: the input tape stays writable, so nothing changes", () => {
    const prev = parseEntityDraft(PAL)!;
    const next = reshapeDraft(prev, withStorages(prev, [...prev.storages, tape("t2")]));
    expect(next.storages.map((s) => s.readOnly)).toEqual([false, false]);
    const yaml = serializeEntityDraft(next);
    expect(yaml).toContain("      writable: true");
    const m = machine(yaml);
    expect(m.storages.map(isReadOnlyTape)).toEqual([false, false]);
    sameLanguage(machine(PAL), m, 6);
  });

  it("the work tape removed: one tape again, written as the notes' one-tape machine (9.1)", () => {
    const one = parseEntityDraft(CELL_TEMPLATES.tm)!;
    const two = reshapeDraft(one, withStorages(one, [...one.storages, tape("t2")]));
    const back = reshapeDraft(two, withStorages(two, [two.storages[0]]));
    expect(back.storages.map((s) => s.readOnly)).toEqual([false]);
    const yaml = serializeEntityDraft(back);
    expect(yaml).not.toContain("writable");
    expect(yaml).toContain("- (start, a) -> (start, a, R)");
    sameLanguage(machine(CELL_TEMPLATES.tm), machine(yaml), 6);
  });

  it("made writable by choice: each row writes back what it reads, the language stays", () => {
    const prev = parseEntityDraft(T2)!;
    const next = reshapeDraft(prev, withStorages(prev, [{ ...prev.storages[0], readOnly: false }, prev.storages[1]]));
    expect(next.rows[1]).toEqual(["q_0", "a", "a", "R", "_", "Y", "R", "q_1"]);
    const yaml = serializeEntityDraft(next);
    expect(yaml).toContain("      writable: true");
    expect(yaml).toContain("- (q_0, a, _) -> (q_1, a, Y, R, R)");
    sameLanguage(machine(T2), machine(yaml), 8);
    // and read-only again: the notes' machine as it was
    const again = reshapeDraft(next, withStorages(next, [{ ...next.storages[0], readOnly: true }, next.storages[1]]));
    expect(serializeEntityDraft(again)).toBe(T2);
  });

  it("the input moved to the other tape: the old one becomes a work tape, the new one keeps its writes", () => {
    const src = [
      "Machine:",
      "  charset: a, b",
      "  states: s, ok",
      "  init: s",
      "  accept: ok",
      "  input: t1",
      "  storages:",
      "    t1: tape",
      "    t2: tape",
      "  transitions:",
      "    - (s, a, _) -> (ok, a, R, R)"
    ].join("\n");
    const prev = parseEntityDraft(src)!;
    const next = reshapeDraft(prev, { ...prev, input: "t2" });
    expect(next.storages.map((s) => s.readOnly)).toEqual([false, false]);
    const yaml = serializeEntityDraft(next);
    expect(machine(yaml).storages.map(isReadOnlyTape)).toEqual([false, false]);
    expect(yaml).toContain("    t2:\n      type: tape\n      writable: true");
    // t1 writes back what it reads, t2 what it wrote
    expect(yaml).toContain("- (s, a, _) -> (ok, a, a, R, R)");
  });
});

describe("a machine's state names in the form", () => {
  const src = [
    "Machine:",
    "  charset: a, b",
    '  states: "q0, q_{1}, q10, {A,B}, 00"',
    "  init: q0",
    '  accept: "q_{1}, q10"',
    "  transitions:",
    "    - (q0, a) -> q_{1}",
    "    - (q_{1}, b) -> q10",
    "    - (q10, a) -> {A,B}",
    "    - ({A,B}, b) -> 00"
  ].join("\n");

  it("are written canonically, as the graph shows them: q0 is q_0 (q₀), q10 is q_{10}", () => {
    const d = parseEntityDraft(src)!;
    expect(d.states).toBe("q_0, q_1, q_{10}, {A,B}, 00");
    expect(d.init).toBe("q_0");
    expect(d.accept).toBe("q_1, q_{10}");
    expect(d.rows.map((r) => [r[0], r[r.length - 1]])).toEqual([
      ["q_0", "q_1"],
      ["q_1", "q_{10}"],
      ["q_{10}", "{A,B}"],
      ["{A,B}", "00"]
    ]);
  });

  it("the form's YAML is the same machine", () => {
    const yaml = serializeEntityDraft(parseEntityDraft(src)!);
    expect(yaml).toContain('  states: "q_0, q_1, q_{10}, {A,B}, 00"\n');
    expect(parseMachine(yaml).value).toEqual(parseMachine(src).value);
  });
});
