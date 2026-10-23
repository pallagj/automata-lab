import { Migration, MIGRATIONS, migrateSource, SAVE_VERSION } from "./migrations";

/**
 * A worksheet as it leaves a browser: an exported file or a shared snapshot. It names the
 * version it was written at, so a reader of a later version can bring it up to date.
 */
export interface WorksheetDocument {
  version: number;
  name: string;
  cells: WorksheetCell[];
}

export interface WorksheetCell {
  source: string;
  /** the graph positions pinned by hand: state name → coordinate */
  layout?: Record<string, { x: number; y: number }>;
}

/** What one shared worksheet may hold: far more than any exercise needs, little enough to keep every one. */
export const WORKSHEET_LIMITS = {
  name: 200,
  cells: 100,
  source: 20_000,
  layoutNodes: 500,
  /** a state name in a layout */
  layoutKey: 100
} as const;

/**
 * The document rewritten for the current version: every cell's source goes through the
 * migrations since its version. Null when a newer app wrote it — this one can not know
 * what that version changed.
 */
export function upToDate(
  doc: WorksheetDocument,
  migrations: Record<number, Migration> = MIGRATIONS,
  to: number = SAVE_VERSION
): WorksheetDocument | null {
  if (doc.version > to) return null;
  return {
    ...doc,
    version: to,
    cells: doc.cells.map((c) => ({ ...c, source: migrateSource(c.source, doc.version, migrations, to) }))
  };
}
