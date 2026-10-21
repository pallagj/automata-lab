/**
 * Shared types: every algorithm can return diagnostics (explanations, fix
 * suggestions) and recorded steps alongside its result.
 */

export type DiagLevel = "error" | "warning" | "info";

/**
 * Translatable text: an i18next key plus optional interpolation params.
 * Resolved to a concrete string only at render time via `tr()` from
 * `src/i18n/translate.ts`, so the same diagnostic/step works in any UI
 * language. `ns` defaults to "core" (every value built by core algorithms
 * lives there); UI-authored I18nText values — e.g. `Applicability.reason` in
 * `src/ui/editor/ops.ts` — set `ns: "ui"` explicitly since they key into the
 * "ui" namespace instead.
 */
export interface I18nText {
  key: string;
  params?: Record<string, string | number>;
  ns?: "core" | "ui";
}

/** Shorthand constructor for I18nText. */
export function tx(key: string, params?: Record<string, string | number>): I18nText {
  return { key, params };
}

export interface Diagnostic {
  level: DiagLevel;
  title: I18nText;
  /** Detailed explanation — why this is a precondition and what it means. */
  detail?: I18nText;
  /** Suggested fix: inserting this expression resolves the problem. */
  fix?: { label: I18nText; code: string };
}

export interface StepTable {
  /** Either a translatable label or a raw symbol/formula (e.g. "δ(·, a)", an alphabet letter) shown verbatim. */
  headers: (string | I18nText)[];
  rows: string[][];
}

export interface AlgoStep {
  title: I18nText;
  detail?: I18nText;
  table?: StepTable;
}

export interface OpResult<T> {
  ok: boolean;
  value?: T;
  diagnostics: Diagnostic[];
  steps: AlgoStep[];
}

export const EPS = "ε";

export function err(title: I18nText, detail?: I18nText, fix?: Diagnostic["fix"]): Diagnostic {
  return { level: "error", title, detail, fix };
}
export function warn(title: I18nText, detail?: I18nText, fix?: Diagnostic["fix"]): Diagnostic {
  return { level: "warning", title, detail, fix };
}
export function info(title: I18nText, detail?: I18nText, fix?: Diagnostic["fix"]): Diagnostic {
  return { level: "info", title, detail, fix };
}

export function okResult<T>(value: T, diagnostics: Diagnostic[] = [], steps: AlgoStep[] = []): OpResult<T> {
  return { ok: true, value, diagnostics, steps };
}

export function failResult<T>(diagnostics: Diagnostic[], steps: AlgoStep[] = []): OpResult<T> {
  return { ok: false, diagnostics, steps };
}

/** Set helpers */
export const setUnion = <T>(a: Set<T>, b: Set<T>): Set<T> => new Set([...a, ...b]);
export const setIntersect = <T>(a: Set<T>, b: Set<T>): Set<T> =>
  new Set([...a].filter((x) => b.has(x)));
export const setDifference = <T>(a: Set<T>, b: Set<T>): Set<T> =>
  new Set([...a].filter((x) => !b.has(x)));
export const setEquals = <T>(a: Set<T>, b: Set<T>): boolean =>
  a.size === b.size && [...a].every((x) => b.has(x));

/** Deterministic, readable name of a state set: {A,B} */
export function setName(states: Iterable<string>): string {
  const arr = [...states].sort();
  return arr.length === 0 ? "∅" : `{${arr.join(",")}}`;
}
