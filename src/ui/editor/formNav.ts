import type React from "react";
import { EditorView } from "@uiw/react-codemirror";

/**
 * Arrow keys across the form's fields: ← and → step to the previous / next field once the
 * caret is at the field's edge, ↑ and ↓ to the row above / below — between rows of one
 * kind (transitions, storages) in the same column, elsewhere to the nearest field.
 */

/** A field's place on the screen, and in its row if it is in one. */
export interface Box {
  top: number;
  bottom: number;
  left: number;
  right: number;
  /** the row the field is in (fields of one row share it), null outside rows */
  row: number | null;
  /** the row's kind: rows of one kind line up column by column */
  rowKind: string | null;
  /** the field's position within its row */
  col: number;
}

const midY = (b: Box) => (b.top + b.bottom) / 2;
const midX = (b: Box) => (b.left + b.right) / 2;

/** The field ↑ (dir -1) or ↓ (dir 1) goes to from boxes[from], or null at the edge. */
export function verticalTarget(boxes: Box[], from: number, dir: -1 | 1): number | null {
  const b = boxes[from];
  const y = midY(b);
  const ahead = boxes.map((_, i) => i).filter((i) => i !== from && (midY(boxes[i]) - y) * dir > 2);
  if (ahead.length === 0) return null;
  // the nearest line of fields in that direction
  const dist = (i: number) => Math.abs(midY(boxes[i]) - y);
  const nearest = Math.min(...ahead.map(dist));
  const line = ahead.filter((i) => dist(i) < nearest + 4);
  // a row of the same kind: the same column, or the row's last field if it is shorter
  if (b.rowKind !== null) {
    const same = line.filter((i) => boxes[i].rowKind === b.rowKind);
    if (same.length > 0) {
      const row = same.filter((i) => boxes[i].row === boxes[same[0]].row);
      return row.find((i) => boxes[i].col === b.col) ?? row.reduce((a, i) => (boxes[i].col > boxes[a].col ? i : a));
    }
  }
  return line.reduce((a, i) => (Math.abs(midX(boxes[i]) - midX(b)) < Math.abs(midX(boxes[a]) - midX(b)) ? i : a));
}

/* ----------------------------- the DOM side ----------------------------- */

const FIELD = ".cm-content, input, select";
const ROW = ".ef-row, .ef-storage-row";

const viewOf = (el: HTMLElement) => {
  const editor = el.closest<HTMLElement>(".cm-editor");
  return editor ? EditorView.findFromDOM(editor) : null;
};

/** Whether the caret is at the field's start (or end), with nothing selected; a select has no caret. */
function caretAt(el: HTMLElement, edge: "start" | "end"): boolean {
  const view = viewOf(el);
  if (view) {
    const sel = view.state.selection.main;
    return sel.empty && sel.head === (edge === "start" ? 0 : view.state.doc.length);
  }
  if (el instanceof HTMLInputElement) {
    const { selectionStart: a, selectionEnd: b } = el;
    if (a === null || a !== b) return a === null;
    return a === (edge === "start" ? 0 : el.value.length);
  }
  return true;
}

function focusField(el: HTMLElement, caret: "start" | "end"): void {
  const view = viewOf(el);
  if (view) {
    view.focus();
    view.dispatch({ selection: { anchor: caret === "start" ? 0 : view.state.doc.length } });
  } else {
    el.focus();
    if (el instanceof HTMLInputElement) {
      const at = caret === "start" ? 0 : el.value.length;
      el.setSelectionRange(at, at);
    }
  }
}

/** Handles an arrow key pressed in the form; true if it moved to another field. */
export function navigateFields(form: HTMLElement, target: HTMLElement, key: string): boolean {
  const el = target.closest<HTMLElement>(FIELD);
  if (!el || !form.contains(el)) return false;
  // a fixed value (the edge dialog's states) is shown, not stepped into
  const fields = [...form.querySelectorAll<HTMLElement>(FIELD)].filter(
    (f) => f.getClientRects().length > 0 && f.getAttribute("contenteditable") !== "false"
  );
  const i = fields.indexOf(el);
  if (i < 0) return false;

  if (key === "ArrowLeft" || key === "ArrowRight") {
    const back = key === "ArrowLeft";
    const next = fields[back ? i - 1 : i + 1];
    if (!next || !caretAt(el, back ? "start" : "end")) return false;
    focusField(next, back ? "end" : "start");
    return true;
  }

  if (key === "ArrowUp" || key === "ArrowDown") {
    const rows = [...form.querySelectorAll<HTMLElement>(ROW)];
    const boxes = fields.map((f): Box => {
      const r = (f.closest<HTMLElement>(".sym-field") ?? f).getBoundingClientRect();
      const row = f.closest<HTMLElement>(ROW);
      return {
        top: r.top,
        bottom: r.bottom,
        left: r.left,
        right: r.right,
        row: row ? rows.indexOf(row) : null,
        rowKind: row ? (row.classList.contains("ef-storage-row") ? "storage" : "row") : null,
        col: row ? [...row.querySelectorAll(FIELD)].indexOf(f) : 0
      };
    });
    const to = verticalTarget(boxes, i, key === "ArrowUp" ? -1 : 1);
    if (to === null) return false;
    focusField(fields[to], "end");
    return true;
  }
  return false;
}

/** The form's (and the edge dialog's) onKeyDownCapture: before a field takes ↑ / ↓ as a caret move. */
export function arrowKeysAcrossFields(e: React.KeyboardEvent<HTMLElement>): void {
  if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey || e.nativeEvent.isComposing) return;
  if (navigateFields(e.currentTarget, e.target as HTMLElement, e.key)) {
    e.preventDefault();
    e.stopPropagation();
  }
}
