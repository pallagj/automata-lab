import { EditorView, keymap, Prec } from "@uiw/react-codemirror";
import { useAppStore } from "../../state/store";

/**
 * Ctrl+Z / Ctrl+Shift+Z (Ctrl+Y) in an editor of a cell — its code, or a field of its form — step
 * through the worksheet's history, not the editor's own: one history for the whole worksheet, the
 * same the undo buttons walk. An editor outside the cells (a dialog's field) keeps its own.
 */
export const worksheetUndoKeys = Prec.highest(
  keymap.of([
    { key: "Mod-z", run: (view) => travel(view, "undo"), preventDefault: true },
    { key: "Mod-Shift-z", run: (view) => travel(view, "redo"), preventDefault: true },
    { key: "Mod-y", run: (view) => travel(view, "redo"), preventDefault: true }
  ])
);

function travel(view: EditorView, direction: "undo" | "redo"): boolean {
  if (!view.dom.closest(".cell-list")) return false;
  const before = view.state.doc.toString();
  useAppStore.getState()[direction]();
  // the text reaches the editor once React has rendered it; the caret then goes where it changed
  requestAnimationFrame(() => {
    if (!view.dom.isConnected) return;
    const after = view.state.doc.toString();
    if (after !== before) view.dispatch({ selection: { anchor: changeEnd(before, after) } });
  });
  return true;
}

/** Where the text that differs ends in `after`, `before` changed into it: the caret's place after an undo. */
export function changeEnd(before: string, after: string): number {
  let prefix = 0;
  while (prefix < before.length && prefix < after.length && before[prefix] === after[prefix]) prefix++;
  let suffix = 0;
  while (
    suffix < before.length - prefix &&
    suffix < after.length - prefix &&
    before[before.length - 1 - suffix] === after[after.length - 1 - suffix]
  )
    suffix++;
  return after.length - suffix;
}
