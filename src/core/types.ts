/**
 * Közös típusok: minden algoritmus diagnosztikát (magyarázatokat, javítási
 * javaslatokat) és rögzített lépéseket adhat vissza az eredmény mellé.
 */

export type DiagLevel = "error" | "warning" | "info";

export interface Diagnostic {
  level: DiagLevel;
  title: string;
  /** Részletes magyarázat — miért feltétel ez, mit jelent. */
  detail?: string;
  /** Javasolt javítás: ezt a kifejezést beszúrva megoldódik. */
  fix?: { label: string; code: string };
}

export interface StepTable {
  headers: string[];
  rows: string[][];
}

export interface AlgoStep {
  title: string;
  detail?: string;
  table?: StepTable;
}

export interface OpResult<T> {
  ok: boolean;
  value?: T;
  diagnostics: Diagnostic[];
  steps: AlgoStep[];
}

export const EPS = "ε";
export const BLANK = "␣";

export function err(title: string, detail?: string, fix?: Diagnostic["fix"]): Diagnostic {
  return { level: "error", title, detail, fix };
}
export function warn(title: string, detail?: string, fix?: Diagnostic["fix"]): Diagnostic {
  return { level: "warning", title, detail, fix };
}
export function info(title: string, detail?: string, fix?: Diagnostic["fix"]): Diagnostic {
  return { level: "info", title, detail, fix };
}

export function okResult<T>(value: T, diagnostics: Diagnostic[] = [], steps: AlgoStep[] = []): OpResult<T> {
  return { ok: true, value, diagnostics, steps };
}

export function failResult<T>(diagnostics: Diagnostic[], steps: AlgoStep[] = []): OpResult<T> {
  return { ok: false, diagnostics, steps };
}

/** Halmaz segédfüggvények */
export const setUnion = <T>(a: Set<T>, b: Set<T>): Set<T> => new Set([...a, ...b]);
export const setIntersect = <T>(a: Set<T>, b: Set<T>): Set<T> =>
  new Set([...a].filter((x) => b.has(x)));
export const setDifference = <T>(a: Set<T>, b: Set<T>): Set<T> =>
  new Set([...a].filter((x) => !b.has(x)));
export const setEquals = <T>(a: Set<T>, b: Set<T>): boolean =>
  a.size === b.size && [...a].every((x) => b.has(x));

/** Állapothalmaz determinisztikus, olvasható neve: {A,B} */
export function setName(states: Iterable<string>): string {
  const arr = [...states].sort();
  return arr.length === 0 ? "∅" : `{${arr.join(",")}}`;
}
