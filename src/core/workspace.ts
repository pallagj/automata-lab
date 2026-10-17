import { Diagnostic, err, tx, warn } from "./types";
import { Definition, parseDefinition } from "./parse/definitionParser";
import { suggestName } from "./symbols";
import {
  collectDependencies,
  evaluateExpression,
  ExprValue,
  splitAssignment,
  StepGroup
} from "./expr/expression";

/**
 * Evaluates the cells of a worksheet: parses definitions, computes expressions
 * in dependency order, and detects cycles and name clashes. Names are optional,
 * as in Desmos: an unnamed cell is evaluated and shown but cannot be referenced.
 */

export interface CellResult {
  /** the name defined by the cell; null for unnamed cells */
  name: string | null;
  value: ExprValue | null;
  diagnostics: Diagnostic[];
  stepGroups: StepGroup[];
  isExpression: boolean;
  empty: boolean;
  /** a cell starting with # is a note and is not evaluated */
  comment?: boolean;
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
    /** null for an unnamed expression */
    name: string | null;
    expr: string;
  }
  /** dependency-graph key: the name, or a per-cell key for unnamed expressions */
  const keyOf = (c: ExprCell) => c.name ?? `\u0000${c.index}`;
  const exprCells: ExprCell[] = [];
  const definedAt = new Map<string, number>();
  const names = new Set<string>();

  // pass 1: collect definitions and names
  sources.forEach((src, i) => {
    const trimmed = src.trim();
    if (trimmed === "") return;
    results[i].empty = false;

    // a cell starting with # is a note — not evaluated
    if (trimmed.startsWith("#")) {
      results[i].comment = true;
      return;
    }

    const def = parseDefinition(trimmed);
    if (def !== null) {
      results[i].diagnostics.push(...def.diagnostics);
      if (def.ok) {
        const value = def.value as Definition;
        results[i].value = value;
        if (value.name) {
          results[i].name = value.name;
          registerName(value.name, i);
        }
      }
      return;
    }

    const asg = splitAssignment(trimmed);
    if (asg !== null) {
      results[i].isExpression = true;
      if (asg.name === null) {
        // EvenA = …: names are single letters with a subscript, as in Desmos
        results[i].diagnostics.push(
          err(tx("definitionParser.badName.title", { name: asg.rawName }), tx("definitionParser.badName.detail", { suggestion: suggestName(asg.rawName) }))
        );
        return;
      }
      results[i].name = asg.name;
      exprCells.push({ index: i, name: asg.name, expr: asg.expr });
      registerName(asg.name, i);
      return;
    }

    // anything else is an unnamed expression — unless it looks like a definition with an unknown key
    if (!/^[A-Za-z]+\s*:/.test(trimmed)) {
      results[i].isExpression = true;
      exprCells.push({ index: i, name: null, expr: trimmed });
      return;
    }

    results[i].diagnostics.push(
      err(
        tx("workspace.unparseableCell.title"),
        tx("workspace.unparseableCell.detail")
      )
    );
  });

  function registerName(name: string, index: number) {
    if (definedAt.has(name)) {
      const other = definedAt.get(name)!;
      const d = warn(
        tx("workspace.duplicateDefinition.title", { name }),
        tx("workspace.duplicateDefinition.detail", { other: other + 1, index: index + 1 })
      );
      results[index].diagnostics.push(d);
      return;
    }
    definedAt.set(name, index);
    names.add(name);
  }

  // pass 2: dependency graph of expressions + topological order
  const deps = new Map<string, Set<string>>();
  for (const c of exprCells) {
    deps.set(keyOf(c), collectDependencies(c.expr, names));
  }

  const order: ExprCell[] = [];
  const visited = new Map<string, "doing" | "done">();
  const cyclic = new Set<string>();

  const visit = (key: string, chain: string[]) => {
    const state = visited.get(key);
    if (state === "done") return;
    if (state === "doing") {
      for (const n of chain.slice(chain.indexOf(key))) cyclic.add(n);
      return;
    }
    visited.set(key, "doing");
    for (const d of deps.get(key) ?? []) {
      if (deps.has(d)) visit(d, [...chain, key]);
    }
    visited.set(key, "done");
    const cell = exprCells.find((c) => keyOf(c) === key && (c.name === null || definedAt.get(c.name) === c.index));
    if (cell) order.push(cell);
  };
  for (const c of exprCells) visit(keyOf(c), []);

  // pass 3: evaluate in order
  const env = new Map<string, ExprValue>();
  sources.forEach((_, i) => {
    if (results[i].value !== null && results[i].name && definedAt.get(results[i].name!) === i) {
      env.set(results[i].name!, results[i].value!);
    }
  });

  for (const cell of order) {
    const r = results[cell.index];
    if (cyclic.has(keyOf(cell))) {
      r.diagnostics.push(
        err(
          tx("workspace.circularDependency.title"),
          tx("workspace.circularDependency.detail", { name: cell.name ?? "", chain: [...cyclic].join(" → ") })
        )
      );
      continue;
    }
    const missing = [...(deps.get(keyOf(cell)) ?? [])].filter((d) => !env.has(d) && names.has(d));
    if (missing.length > 0) {
      r.diagnostics.push(
        err(
          tx("workspace.brokenDependency.title", { missing: missing.join(", ") }),
          tx("workspace.brokenDependency.detail")
        )
      );
      continue;
    }

    const out = evaluateExpression(cell.expr, env, names);
    r.diagnostics.push(...out.diagnostics.filter((d) => !r.diagnostics.includes(d)));
    if (out.ok) {
      const v = out.value!.value;
      // the result takes the cell's name (an unnamed cell's result stays unnamed)
      const named = { ...v, name: cell.name ?? "" } as ExprValue;
      r.value = named;
      r.stepGroups = out.value!.stepGroups;
      if (cell.name !== null) env.set(cell.name, named);
    }
  }

  // deduplicate diagnostics
  const i18nKey = (x?: { key: string; params?: Record<string, string | number> }) =>
    x ? `${x.key}|${JSON.stringify(x.params ?? {})}` : "";
  for (const r of results) {
    const seen = new Set<string>();
    r.diagnostics = r.diagnostics.filter((d) => {
      const key = `${d.level}|${i18nKey(d.title)}|${i18nKey(d.detail)}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  return results;
}
