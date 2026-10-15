import type React from "react";
import { EditorView } from "@uiw/react-codemirror";
import { EPS } from "../../core/types";

/**
 * Typing shortcuts for ε, like Desmos turns "pi" into π: a whole token "$", "eps" or
 * "epsilon" becomes ε as soon as it is typed. "eps" already turns into ε before
 * "epsilon" is finished, so the leftover "εilon" is folded back into ε as well.
 * Only definition fields use this — expression cells keep epsfree(...) and regexes intact.
 */
const EPS_WORDS = new Set(["$", "eps", "epsilon", "εilon"]);
const BOUNDARY = /[\s,|/]/;

export interface EpsilonEdit {
  text: string;
  caret: number;
  /** where the replaced token started */
  tokenStart: number;
}

/** Replaces the ε-alias token around `caret` with ε; null when there is nothing to replace. */
export function epsilonAt(text: string, caret: number): EpsilonEdit | null {
  let start = caret;
  while (start > 0 && !BOUNDARY.test(text[start - 1])) start--;
  let end = caret;
  while (end < text.length && !BOUNDARY.test(text[end])) end++;
  if (!EPS_WORDS.has(text.slice(start, end))) return null;
  return { text: text.slice(0, start) + EPS + text.slice(end), caret: start + EPS.length, tokenStart: start };
}

/** onChange helper for plain inputs: applies the shortcut and keeps the caret in place. */
export function epsilonChange(e: React.ChangeEvent<HTMLInputElement>, apply: (value: string) => void): void {
  const input = e.target;
  const edit = epsilonAt(input.value, input.selectionStart ?? input.value.length);
  if (!edit) {
    apply(input.value);
    return;
  }
  apply(edit.text);
  // the controlled value is re-rendered after this handler, which would park the caret at the end
  requestAnimationFrame(() => input.setSelectionRange(edit.caret, edit.caret));
}

/** "- " list rows in YAML: machine transitions and grammar rules. */
const LIST_ROW = /^\s*-\s+/;

/**
 * CodeMirror input handler for YAML definitions: applies the shortcut in transition and
 * rule rows, but never to a row's first token (the source state / the rule's left side).
 */
export const epsilonInputHandler = EditorView.inputHandler.of((view, from, to, text) => {
  if (BOUNDARY.test(text)) return false;
  const line = view.state.doc.lineAt(from);
  const row = LIST_ROW.exec(line.text);
  if (!row || from - line.from < row[0].length) return false;
  const before = line.text.slice(0, from - line.from) + text;
  const edit = epsilonAt(before + line.text.slice(to - line.from), before.length);
  if (!edit || edit.tokenStart === row[0].length) return false;
  view.dispatch({
    changes: { from: line.from, to: line.to, insert: edit.text },
    selection: { anchor: line.from + edit.caret },
    userEvent: "input.type"
  });
  return true;
});
