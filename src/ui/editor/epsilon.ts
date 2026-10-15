import type React from "react";
import { EditorView } from "@uiw/react-codemirror";
import { EPS } from "../../core/types";

/**
 * Typing shortcuts for ε, like Desmos turns "pi" into π: a whole token "eps" or
 * "epsilon" becomes ε as soon as it is typed. "eps" already turns into ε before
 * "epsilon" is finished, so the leftover "εilon" is folded back into ε as well.
 * Expression cells never use this, so epsfree(...) stays intact.
 */
const EPS_WORDS = new Set(["eps", "epsilon", "εilon"]);
/** what separates tokens in definitions: transition parts, stack ops, grammar alternatives */
const DEFINITION_BOUNDARY = /[\s,|/]/;
/** in regexes the operators separate the parts */
export const REGEX_BOUNDARY = /[\s()|+*?]/;

export interface EpsilonOptions {
  boundary?: RegExp;
  /**
   * Declared grammar symbols. When given, the shortcut works inside a word too (Aeps → Aε),
   * except for words made only of declared symbols — mirroring grammarEpsilon in the parser.
   */
  declared?: Set<string>;
}

export interface EpsilonEdit {
  text: string;
  caret: number;
  /** where the replaced text started */
  tokenStart: number;
}

/** Replaces the ε-alias around `caret` with ε; null when there is nothing to replace. */
export function epsilonAt(text: string, caret: number, options: EpsilonOptions = {}): EpsilonEdit | null {
  const { boundary = DEFINITION_BOUNDARY, declared } = options;
  const replace = (start: number, end: number): EpsilonEdit => ({
    text: text.slice(0, start) + EPS + text.slice(end),
    caret: start + EPS.length,
    tokenStart: start
  });

  // in grammars a word made only of declared symbols stays letters, alone or not
  const isDeclared = (word: string) => !!declared && [...word].every((c) => c === EPS || declared.has(c));

  let start = caret;
  while (start > 0 && !boundary.test(text[start - 1])) start--;
  let end = caret;
  while (end < text.length && !boundary.test(text[end])) end++;
  const token = text.slice(start, end);
  if (EPS_WORDS.has(token) && !isDeclared(token)) return replace(start, end);

  if (declared) {
    const before = text.slice(0, caret);
    for (const word of EPS_WORDS) {
      if (before.endsWith(word) && !isDeclared(word)) return replace(caret - word.length, caret);
    }
  }
  return null;
}

/** onChange helper for plain inputs: applies the shortcut and keeps the caret in place. */
export function epsilonChange(
  e: React.ChangeEvent<HTMLInputElement>,
  apply: (value: string) => void,
  options?: EpsilonOptions
): void {
  const input = e.target;
  const edit = epsilonAt(input.value, input.selectionStart ?? input.value.length, options);
  if (!edit) {
    apply(input.value);
    return;
  }
  apply(edit.text);
  // the controlled value is re-rendered after this handler, which would park the caret at the end
  requestAnimationFrame(() => input.setSelectionRange(edit.caret, edit.caret));
}

/** The symbols declared in a charset/variables list ("a, b", "[S, A]", ranges like "a-d"). */
export function declaredSymbols(...lists: string[]): Set<string> {
  const out = new Set<string>();
  for (const list of lists) {
    for (const item of list.replace(/[[\]]/g, "").split(",")) {
      const s = item.trim();
      const range = /^(.)-(.)$/.exec(s);
      if (range) {
        for (let c = range[1].charCodeAt(0); c <= range[2].charCodeAt(0); c++) out.add(String.fromCharCode(c));
      } else if (s) out.add(s);
    }
  }
  return out;
}

/** "- " list rows in YAML: machine transitions and grammar rules. */
const LIST_ROW = /^\s*-\s+/;
const GRAMMAR_DOC = /^\s*(Grammar|grammar)\s*:/;

function grammarDeclared(doc: string): Set<string> {
  const field = (key: string) => new RegExp(`^\\s*${key}\\s*:\\s*(.*)$`, "m").exec(doc)?.[1] ?? "";
  return declaredSymbols(field("charset"), field("variables"));
}

/**
 * CodeMirror input handler for YAML definitions. Machine transition rows get the
 * whole-token shortcut except in their first token (the source state); grammar rule
 * rows get the full grammar behaviour, but only on the right of "->".
 */
export const epsilonInputHandler = EditorView.inputHandler.of((view, from, to, text) => {
  if (DEFINITION_BOUNDARY.test(text)) return false;
  const line = view.state.doc.lineAt(from);
  const row = LIST_ROW.exec(line.text);
  if (!row || from - line.from < row[0].length) return false;
  const before = line.text.slice(0, from - line.from) + text;
  const lineText = before + line.text.slice(to - line.from);

  const doc = view.state.doc.toString();
  let edit: EpsilonEdit | null;
  if (GRAMMAR_DOC.test(doc)) {
    const arrow = /->|→/.exec(lineText);
    if (!arrow || before.length <= arrow.index + arrow[0].length) return false;
    edit = epsilonAt(lineText, before.length, { declared: grammarDeclared(doc) });
  } else {
    edit = epsilonAt(lineText, before.length);
    if (edit?.tokenStart === row[0].length) edit = null;
  }
  if (!edit) return false;
  view.dispatch({
    changes: { from: line.from, to: line.to, insert: edit.text },
    selection: { anchor: line.from + edit.caret },
    userEvent: "input.type"
  });
  return true;
});
