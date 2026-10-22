/**
 * Saved work outlives the app version that wrote it: a student's browser keeps the
 * worksheets, and so do exported .automata.json files. When what is saved changes —
 * the stored state, or the cell language (a renamed function or key, a new notation) —
 * SAVE_VERSION goes up and MIGRATIONS gets a step that rewrites the old data, so
 * nothing anyone made is dropped or left unreadable.
 *
 * Rules for a step:
 * - it is idempotent: data an older app wrote back (see below) may meet it twice;
 * - it never deletes a worksheet or a cell; at most it rewrites them.
 */

export const SAVE_VERSION = 1;

export interface Migration {
  /** rewrites one cell's source written for the step's version */
  source?: (source: string) => string;
  /** rewrites the rest of the saved state (a renamed or restructured field) */
  state?: (state: SavedState) => SavedState;
}

/** MIGRATIONS[v] takes data saved at version v to version v + 1. */
export const MIGRATIONS: Record<number, Migration> = {};

/** The stored state as it comes out of JSON: only the worksheets' shape is relied on. */
export type SavedState = Record<string, unknown> & { workspaces?: SavedWorkspace[] };
interface SavedWorkspace {
  cells?: { source?: unknown }[];
  [key: string]: unknown;
}

/** A cell source written at version `from`, rewritten for the current version. */
export function migrateSource(
  source: string,
  from: number,
  migrations: Record<number, Migration> = MIGRATIONS,
  to: number = SAVE_VERSION
): string {
  let s = source;
  for (let v = from; v < to; v++) s = migrations[v]?.source?.(s) ?? s;
  return s;
}

/**
 * The stored state saved at version `from`, brought to the current version. A state saved
 * by a newer app (a tab left open over an update) is kept exactly as it is: this app can
 * not know what the newer version changed, and must not lose it.
 */
export function migrateState(
  state: unknown,
  from: number,
  migrations: Record<number, Migration> = MIGRATIONS,
  to: number = SAVE_VERSION
): unknown {
  if (from >= to || state === null || typeof state !== "object") return state;
  let s = state as SavedState;
  for (let v = from; v < to; v++) {
    const m = migrations[v];
    if (!m) continue;
    if (m.source && Array.isArray(s.workspaces)) {
      s = {
        ...s,
        workspaces: s.workspaces.map((w) => ({
          ...w,
          cells: (w.cells ?? []).map((c) =>
            typeof c.source === "string" ? { ...c, source: m.source!(c.source) } : c
          )
        }))
      };
    }
    if (m.state) s = m.state(s);
  }
  return s;
}

/** The version a stored value was saved at (zustand writes {"state": …, "version": n}); null if unknown. */
export function storedVersion(raw: string | null): number | null {
  if (!raw) return null;
  // the version is written last: reading the tail spares parsing the whole state on every save
  const m = /"version":(\d+)\}\s*$/.exec(raw);
  return m ? Number(m[1]) : null;
}

/* A newer app version saved the worksheets: this (outdated) page must not overwrite them. */
let newerSaved = false;
const listeners = new Set<() => void>();

export function newerVersionSaved(): boolean {
  return newerSaved;
}

export function markNewerVersionSaved(): void {
  if (newerSaved) return;
  newerSaved = true;
  listeners.forEach((l) => l());
}

export function onNewerVersionSaved(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * localStorage, except that a state saved by a newer app is never overwritten by this one:
 * an outdated tab stops saving (and says so) instead of throwing the newer work away.
 */
export function guardedStorage(storage: Storage) {
  return {
    getItem: (name: string) => storage.getItem(name),
    setItem: (name: string, value: string) => {
      const saved = storedVersion(storage.getItem(name));
      if (saved !== null && saved > SAVE_VERSION) {
        markNewerVersionSaved();
        return;
      }
      storage.setItem(name, value);
    },
    removeItem: (name: string) => storage.removeItem(name)
  };
}
