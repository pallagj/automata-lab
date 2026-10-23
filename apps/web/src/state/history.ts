import type { Cell, Layouts } from "./store";

/**
 * Undo and redo of a worksheet's cells. Every edit first remembers the cells as they were;
 * one user action is one step, and so is a word typed on in the same cell.
 * The history lives in memory only: a reload starts it afresh.
 */

/** A worksheet's cells at one point — with the active cell and the cells' pinned graph positions. */
export interface CellsSnapshot {
  cells: Cell[];
  activeCellId: string | null;
  layouts: Layouts;
}

export interface CellHistory {
  past: CellsSnapshot[];
  future: CellsSnapshot[];
  /** the cell typed into last, and when: typing on in it without a pause is the same step */
  typing?: { cellId: string; at: number };
}

export const EMPTY_HISTORY: CellHistory = { past: [], future: [] };
/** a pause this long in typing starts a new step */
export const TYPING_PAUSE_MS = 1000;
/** the oldest steps beyond this many are forgotten */
export const HISTORY_LIMIT = 200;

export interface Edit {
  /** when the edit happens (ms) */
  at: number;
  /** the edit is part of a user action already remembered (another change of the same event) */
  sameAction: boolean;
  /** the cell whose text is being typed — only for edits of one cell's text */
  typingIn?: string;
}

/** The history with `before` remembered as a new step, unless the edit goes on with the last one. */
export function remember(h: CellHistory, before: CellsSnapshot, edit: Edit): CellHistory {
  const typingOn =
    edit.typingIn !== undefined && h.typing?.cellId === edit.typingIn && edit.at - h.typing.at < TYPING_PAUSE_MS;
  const past = edit.sameAction || typingOn ? h.past : [...h.past, before].slice(-HISTORY_LIMIT);
  return { past, future: [], typing: edit.typingIn !== undefined ? { cellId: edit.typingIn, at: edit.at } : undefined };
}

/** The snapshot to go back to and the history after it; null when there is nothing to undo. */
export function undoStep(h: CellHistory, current: CellsSnapshot): { to: CellsSnapshot; history: CellHistory } | null {
  const to = h.past[h.past.length - 1];
  if (!to) return null;
  return { to, history: { past: h.past.slice(0, -1), future: [...h.future, current] } };
}

/** The snapshot to go forward to and the history after it; null when there is nothing to redo. */
export function redoStep(h: CellHistory, current: CellsSnapshot): { to: CellsSnapshot; history: CellHistory } | null {
  const to = h.future[h.future.length - 1];
  if (!to) return null;
  return { to, history: { past: [...h.past, current], future: h.future.slice(0, -1) } };
}

/** The pinned graph positions after going to `snap`: a cell it brings back gets its own again. */
export function restoredLayouts(current: Layouts, snap: CellsSnapshot): Layouts {
  const layouts = { ...current };
  for (const c of snap.cells) if (!layouts[c.id] && snap.layouts[c.id]) layouts[c.id] = snap.layouts[c.id];
  return layouts;
}

/**
 * Tells whether an edit belongs to a user action already being remembered: every change made
 * while one event is handled (Backspace deleting a cell and moving to the one above) is one step.
 */
export function createActionGate(): () => boolean {
  let open = false;
  return () => {
    if (open) return true;
    open = true;
    queueMicrotask(() => (open = false));
    return false;
  };
}
