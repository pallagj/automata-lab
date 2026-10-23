/**
 * The browser side of saved work: the worksheets in localStorage carry the version they
 * were saved at, and a tab of an older app never overwrites what a newer one saved.
 * The versions and the migrations themselves are shared (core worksheet/migrations).
 */

import { SAVE_VERSION } from "@automatalab/core/worksheet/migrations";

export {
  MIGRATIONS,
  migrateSource,
  migrateState,
  SAVE_VERSION,
  type Migration,
  type SavedState
} from "@automatalab/core/worksheet/migrations";

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
