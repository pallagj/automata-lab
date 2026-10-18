import type React from "react";
import { EditorView } from "@uiw/react-codemirror";
import { EPS } from "../../core/types";

/**
 * Typing shortcut for the ε rule (see core/epsilon.ts), as math editors turn "pi" into π:
 * in symbol fields "eps" becomes ε as soon as it is typed, anywhere — unless it follows
 * a backslash (\eps = the letters e, p, s). Typing on to "epsilon" folds the leftover
 * "ilon" back into ε. Names and expression cells never use this.
 */
const WORDS = ["εilon", "eps"];

export interface EpsilonEdit {
  text: string;
  caret: number;
}

/** Replaces the eps just before `caret` with ε; null when there is nothing to replace. */
export function epsilonAt(text: string, caret: number): EpsilonEdit | null {
  const before = text.slice(0, caret);
  for (const word of WORDS) {
    const start = caret - word.length;
    if (before.endsWith(word) && text[start - 1] !== "\\") {
      return { text: text.slice(0, start) + EPS + text.slice(caret), caret: start + EPS.length };
    }
  }
  return null;
}

/** onChange helper for plain symbol inputs: applies the shortcut and keeps the caret in place. */
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

/** Whether the end of `text` is inside an unclosed regex(…) — where the shortcut applies in expressions. */
export function insideRegex(text: string): boolean {
  const opens = [...text.matchAll(/\bregex\s*\(/g)];
  if (opens.length === 0) return false;
  const last = opens[opens.length - 1];
  let depth = 0;
  for (let i = last.index! + last[0].length - 1; i < text.length; i++) {
    if (text[i] === "(") depth++;
    else if (text[i] === ")" && --depth === 0) return false;
  }
  return depth > 0;
}

/**
 * CodeMirror input handler for expression cells: the shortcut only inside regex(…),
 * so function names such as epsfree(…) are never touched.
 */
export const regexEpsilonInputHandler = EditorView.inputHandler.of((view, from, to, text) => {
  const doc = view.state.doc.toString();
  const head = doc.slice(0, from) + text;
  if (!insideRegex(head)) return false;
  const edit = epsilonAt(head + doc.slice(to), head.length);
  if (!edit) return false;
  view.dispatch({
    changes: { from: 0, to: doc.length, insert: edit.text },
    selection: { anchor: edit.caret },
    userEvent: "input.type"
  });
  return true;
});

/** "- " list rows in YAML: machine transitions and grammar rules. */
const LIST_ROW = /^\s*-\s+/;
const GRAMMAR_DOC = /^\s*(Grammar|grammar)\s*:/;
/** characters that complete a token in a transition row */
const TOKEN_END = /^[ /]$/;

/**
 * CodeMirror input handler for YAML definitions. In grammar rules everything right of
 * "->" is symbols, so eps converts as you type. In machine transitions the first and
 * last tokens are state names, so a token converts only once a space or "/" completes
 * it, and never the first one — the target state at the end of a row is never completed.
 */
export const epsilonInputHandler = EditorView.inputHandler.of((view, from, to, text) => {
  const line = view.state.doc.lineAt(from);
  const row = LIST_ROW.exec(line.text);
  const offset = from - line.from;
  if (!row || offset < row[0].length) return false;
  const head = line.text.slice(0, offset);
  const tail = line.text.slice(to - line.from);

  let edit: EpsilonEdit | null = null;
  if (GRAMMAR_DOC.test(view.state.doc.toString())) {
    const arrow = /->|→/.exec(head);
    if (!arrow) return false;
    edit = epsilonAt(head + text + tail, head.length + text.length);
  } else {
    if (!TOKEN_END.test(text) || head.search(/\S+$/) === row[0].length) return false;
    const done = epsilonAt(head, head.length);
    if (done) edit = { text: done.text + text + tail, caret: done.caret + text.length };
  }
  if (!edit) return false;
  view.dispatch({
    changes: { from: line.from, to: line.to, insert: edit.text },
    selection: { anchor: line.from + edit.caret },
    userEvent: "input.type"
  });
  return true;
});
