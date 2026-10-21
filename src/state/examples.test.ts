import { describe, expect, it } from "vitest";
import { CELL_TEMPLATES, EXAMPLE_WORKSHEETS } from "./examples";
import { parseDefinition, parseMachine, splitTopLevel } from "../core/parse/definitionParser";
import { readDelta } from "../core/parse/delta";
import { canonicalLabel } from "../core/symbols";
import { evaluateCells } from "../core/workspace";
import enUi from "../i18n/locales/en/ui.json";
import deUi from "../i18n/locales/de/ui.json";
import huUi from "../i18n/locales/hu/ui.json";

/** The machines of a help example: each starts at a Machine: line. */
const helpMachines = (example: string) =>
  example
    .split(/\n(?=Machine:)/)
    .map((m) => m.trim())
    .filter((m) => m.startsWith("Machine:"));
const HELP = Object.entries({ en: enUi, de: deUi, hu: huUi }).flatMap(([lang, ui]) =>
  [ui.help.machines.example, ui.help.storages.example].flatMap((ex) => helpMachines(ex).map((m) => ({ lang, m })))
);

/** Every state label a machine's source writes: its states, start and accepting states, each transition's two. */
function writtenStates(source: string): string[] {
  const out: string[] = [];
  for (const line of source.split("\n")) {
    const text = line.replace(/\s+#.*$/, "");
    const list = /^\s*(states|init|accept)\s*:\s*(.*)$/.exec(text);
    if (list) out.push(...splitTopLevel(list[2].replace(/^"|"$/g, "")).map((s) => s.trim()).filter(Boolean));
    const row = /^\s*-\s+'?(\(.*)$/.exec(text);
    if (row) {
      const d = readDelta(row[1].replace(/'$/, ""));
      out.push(d.args[0], d.values[0]);
    }
  }
  return out;
}

describe("example worksheets and templates", () => {
  const definitions = [...EXAMPLE_WORKSHEETS.flatMap((w) => w.cells), ...Object.values(CELL_TEMPLATES)].filter(
    (c) => parseDefinition(c) !== null
  );

  it("every cell of a worksheet evaluates without an error", () => {
    for (const w of EXAMPLE_WORKSHEETS) {
      const results = evaluateCells(w.cells);
      results.forEach((r, i) => {
        expect(r.diagnostics.filter((d) => d.level === "error"), `${w.key}: ${w.cells[i]}`).toEqual([]);
        if (!r.empty && !r.comment) expect(r.value, `${w.key}: ${w.cells[i]}`).not.toBeNull();
      });
    }
  });

  it("every definition in them parses without an error", () => {
    expect(definitions.length).toBeGreaterThan(10);
    for (const c of definitions) {
      const r = parseDefinition(c)!;
      expect(r.ok, c).toBe(true);
      expect(r.diagnostics.filter((d) => d.level === "error"), c).toEqual([]);
    }
  });

  it("write every state name canonically, as the graph shows it: q_0, not q0", () => {
    const machines = definitions.filter((c) => c.startsWith("Machine:"));
    expect(machines.length).toBeGreaterThan(8);
    let numbered = 0;
    for (const c of machines) {
      const states = writtenStates(c);
      expect(states.length, c).toBeGreaterThan(0);
      for (const s of states) expect(s, c).toBe(canonicalLabel(s));
      numbered += states.filter((s) => /^q_\d$/.test(s)).length;
    }
    expect(numbered).toBeGreaterThan(20);
  });
});

describe("the help's example machines, in every language", () => {
  it("parse without an error — the 2-tape one as the notes' k-tape machine (9.9)", () => {
    expect(HELP.length).toBe(3 * 4);
    for (const { lang, m } of HELP) {
      const r = parseMachine(m);
      expect(r.ok, `${lang}: ${m}\n${JSON.stringify(r.diagnostics)}`).toBe(true);
    }
    const twoTapes = HELP.filter(({ m }) => /^\s+t2: tape$/m.test(m));
    expect(twoTapes).toHaveLength(3);
    for (const { m } of twoTapes) {
      const machine = parseMachine(m).value!;
      expect(machine.storages.map((s) => s.readOnly === true)).toEqual([true, false]);
    }
  });

  it("write every state name canonically", () => {
    for (const { lang, m } of HELP) for (const s of writtenStates(m)) expect(s, `${lang}: ${m}`).toBe(canonicalLabel(s));
  });
});
