import { Diagnostic, err, warn } from "./types";
import { Definition, parseDefinition } from "./parse/definitionParser";
import {
  collectDependencies,
  evaluateExpression,
  ExprValue,
  splitAssignment,
  StepGroup
} from "./expr/expression";

/**
 * Egy munkalap celláinak kiértékelése: definíciók beolvasása, kifejezések
 * függőségi sorrendben való kiszámítása, kör- és névütközés-felismerés.
 */

export interface CellResult {
  /** a cella által definiált név (ha felismerhető) */
  name: string | null;
  value: ExprValue | null;
  diagnostics: Diagnostic[];
  stepGroups: StepGroup[];
  isExpression: boolean;
  empty: boolean;
}

export function evaluateCells(sources: string[]): CellResult[] {
  const results: CellResult[] = sources.map(() => ({
    name: null,
    value: null,
    diagnostics: [],
    stepGroups: [],
    isExpression: false,
    empty: true
  }));

  interface ExprCell {
    index: number;
    name: string;
    expr: string;
  }
  const exprCells: ExprCell[] = [];
  const definedAt = new Map<string, number>();
  const names = new Set<string>();

  // 1. menet: definíciók és nevek begyűjtése
  sources.forEach((src, i) => {
    const trimmed = src.trim();
    if (trimmed === "") return;
    results[i].empty = false;

    const def = parseDefinition(trimmed);
    if (def !== null) {
      results[i].diagnostics.push(...def.diagnostics);
      if (def.ok) {
        const value = def.value as Definition;
        results[i].value = value;
        results[i].name = value.name;
        registerName(value.name, i);
      }
      return;
    }

    const asg = splitAssignment(trimmed);
    if (asg !== null) {
      results[i].isExpression = true;
      results[i].name = asg.name;
      exprCells.push({ index: i, name: asg.name, expr: asg.expr });
      registerName(asg.name, i);
      return;
    }

    results[i].diagnostics.push(
      err(
        "Értelmezhetetlen cella",
        "A cella vagy YAML-definíció (StateMachine / PushdownMachine / TuringMachine / Machine / Grammar kulccsal), vagy kifejezés („név = kifejezés” alakban) lehet."
      )
    );
  });

  function registerName(name: string, index: number) {
    if (definedAt.has(name)) {
      const other = definedAt.get(name)!;
      const d = warn(
        `Többszörös definíció: „${name}”`,
        `A nevet a(z) ${other + 1}. és a(z) ${index + 1}. cella is definiálja — az első definíció él, a többit hagyd ki vagy nevezd át.`
      );
      results[index].diagnostics.push(d);
      return;
    }
    definedAt.set(name, index);
    names.add(name);
  }

  // 2. menet: kifejezések függőségi gráfja + topologikus sorrend
  const deps = new Map<string, Set<string>>();
  for (const c of exprCells) {
    deps.set(c.name, collectDependencies(c.expr, names));
  }

  const order: ExprCell[] = [];
  const visited = new Map<string, "doing" | "done">();
  const cyclic = new Set<string>();

  const visit = (name: string, chain: string[]) => {
    const state = visited.get(name);
    if (state === "done") return;
    if (state === "doing") {
      for (const n of chain.slice(chain.indexOf(name))) cyclic.add(n);
      return;
    }
    visited.set(name, "doing");
    for (const d of deps.get(name) ?? []) {
      if (deps.has(d)) visit(d, [...chain, name]);
    }
    visited.set(name, "done");
    const cell = exprCells.find((c) => c.name === name && definedAt.get(name) === c.index);
    if (cell) order.push(cell);
  };
  for (const c of exprCells) visit(c.name, []);

  // 3. menet: kiértékelés sorrendben
  const env = new Map<string, ExprValue>();
  sources.forEach((_, i) => {
    if (results[i].value !== null && results[i].name && definedAt.get(results[i].name!) === i) {
      env.set(results[i].name!, results[i].value!);
    }
  });

  for (const cell of order) {
    const r = results[cell.index];
    if (cyclic.has(cell.name)) {
      r.diagnostics.push(
        err(
          "Körkörös függőség",
          `A(z) „${cell.name}” definíciója (közvetve) önmagára hivatkozik: ${[...cyclic].join(" → ")}. Bontsd fel a kört.`
        )
      );
      continue;
    }
    const missing = [...(deps.get(cell.name) ?? [])].filter((d) => !env.has(d) && names.has(d));
    if (missing.length > 0) {
      r.diagnostics.push(
        err(
          `Hibás függőség: ${missing.join(", ")}`,
          "A hivatkozott cella hibás vagy még nem értékelhető ki — előbb azt javítsd."
        )
      );
      continue;
    }

    const out = evaluateExpression(cell.expr, env);
    r.diagnostics.push(...out.diagnostics.filter((d) => !r.diagnostics.includes(d)));
    if (out.ok) {
      const v = out.value!.value;
      // a kapott gép a cella nevét veszi fel
      const named = { ...v, name: cell.name } as ExprValue;
      r.value = named;
      r.stepGroups = out.value!.stepGroups;
      env.set(cell.name, named);
    }
  }

  // dedup diagnosztika
  for (const r of results) {
    const seen = new Set<string>();
    r.diagnostics = r.diagnostics.filter((d) => {
      const key = `${d.level}|${d.title}|${d.detail ?? ""}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  return results;
}
