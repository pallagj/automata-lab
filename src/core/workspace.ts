import { Diagnostic, err, tx, warn } from "./types";
import { Definition, parseDefinition } from "./parse/definitionParser";
import {
  collectDependencies,
  evaluateExpression,
  ExprValue,
  splitAssignment,
  StepGroup
} from "./expr/expression";

/**
 * Evaluates the cells of a worksheet: parses definitions, computes expressions
 * in dependency order, and detects cycles and name clashes.
 */

export interface CellResult {
  /** the name defined by the cell (if recognisable) */
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
    name: string;
    expr: string;
  }
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

  // pass 3: evaluate in order
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
          tx("workspace.circularDependency.title"),
          tx("workspace.circularDependency.detail", { name: cell.name, chain: [...cyclic].join(" → ") })
        )
      );
      continue;
    }
    const missing = [...(deps.get(cell.name) ?? [])].filter((d) => !env.has(d) && names.has(d));
    if (missing.length > 0) {
      r.diagnostics.push(
        err(
          tx("workspace.brokenDependency.title", { missing: missing.join(", ") }),
          tx("workspace.brokenDependency.detail")
        )
      );
      continue;
    }

    const out = evaluateExpression(cell.expr, env);
    r.diagnostics.push(...out.diagnostics.filter((d) => !r.diagnostics.includes(d)));
    if (out.ok) {
      const v = out.value!.value;
      // the resulting machine takes the cell's name
      const named = { ...v, name: cell.name } as ExprValue;
      r.value = named;
      r.stepGroups = out.value!.stepGroups;
      env.set(cell.name, named);
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
