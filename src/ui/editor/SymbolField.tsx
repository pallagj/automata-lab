import React, { useCallback, useMemo, useRef } from "react";
import CodeMirror, { EditorState, EditorView, keymap, Prec } from "@uiw/react-codemirror";
import { useAppStore } from "../../state/store";
import { subscripts } from "./subscript";
import { fieldStyle } from "./mathStyle";
import { epsilonAt } from "./epsilon";

/**
 * A one-line field of the form that types like the cells: names get
 * subscripts (M1 → M₁, _ opens a subscript, → leaves it), and symbol fields turn eps
 * into ε. Looks like the other inputs of the form.
 */

/** One line only: a transaction that would add a line break is dropped. */
const singleLine = EditorState.transactionFilter.of((tr) => (tr.newDoc.lines > 1 ? [] : tr));

/** eps → ε anywhere in the field (see core/epsilon.ts). */
const epsilonEverywhere = EditorView.inputHandler.of((view, from, to, text) => {
  const doc = view.state.doc.toString();
  const head = doc.slice(0, from) + text;
  const edit = epsilonAt(head + doc.slice(to), head.length);
  if (!edit) return false;
  view.dispatch({ changes: { from: 0, to: doc.length, insert: edit.text }, selection: { anchor: edit.caret }, userEvent: "input.type" });
  return true;
});

/**
 * The editor is reconfigured whenever its basicSetup object or onChange function is a
 * new one (see @uiw/react-codemirror's useCodeMirror) — with dozens of fields in a form
 * that happened on every keystroke. So both stay the same objects for the field's life.
 */
const BASIC_SETUP = {
  lineNumbers: false,
  foldGutter: false,
  highlightActiveLine: false,
  highlightActiveLineGutter: false,
  autocompletion: false,
  closeBrackets: false,
  bracketMatching: false,
  highlightSelectionMatches: false,
  searchKeymap: false
};

export const SymbolField: React.FC<{
  value: string;
  onChange: (value: string) => void;
  /** whether a digit typed after a letter goes to the subscript (a function gets the digit) */
  digits: boolean | ((ch: string) => boolean);
  /** eps → ε while typing (symbol fields) */
  epsilon?: boolean;
  placeholder?: string;
  className?: string;
  /** Enter in the field (e.g. to save a dialog) */
  onEnter?: () => void;
  autoFocus?: boolean;
}> = ({ value, onChange, digits, epsilon = false, placeholder, className, onEnter, autoFocus }) => {
  const theme = useAppStore((s) => s.theme);
  // the latest rule, without rebuilding the editor's extensions on every render
  const digitsRef = useRef(digits);
  digitsRef.current = digits;
  const enterRef = useRef(onEnter);
  enterRef.current = onEnter;
  const changeRef = useRef(onChange);
  changeRef.current = onChange;
  const change = useCallback((v: string) => changeRef.current(v), []);
  const extensions = useMemo(
    () => [
      singleLine,
      fieldStyle,
      subscripts((_state, _pos, ch) => {
        const d = digitsRef.current;
        return typeof d === "function" ? d(ch) : d;
      }),
      ...(epsilon ? [epsilonEverywhere] : []),
      Prec.high(keymap.of([{ key: "Enter", run: () => (enterRef.current?.(), true) }]))
    ],
    [epsilon]
  );
  return (
    <CodeMirror
      className={`sym-field ${className ?? ""}`}
      value={value}
      onChange={change}
      theme={theme}
      extensions={extensions}
      placeholder={placeholder}
      autoFocus={autoFocus}
      indentWithTab={false}
      basicSetup={BASIC_SETUP}
    />
  );
};
