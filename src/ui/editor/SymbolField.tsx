import React, { useMemo, useRef } from "react";
import CodeMirror, { EditorState, EditorView, keymap, Prec } from "@uiw/react-codemirror";
import { useAppStore } from "../../state/store";
import { subscripts } from "./subscript";
import { epsilonAt } from "./epsilon";

/**
 * A one-line field of the form that types like the cells: names get Desmos-style
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
  const extensions = useMemo(
    () => [
      singleLine,
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
      onChange={onChange}
      theme={theme}
      extensions={extensions}
      placeholder={placeholder}
      autoFocus={autoFocus}
      indentWithTab={false}
      basicSetup={{
        lineNumbers: false,
        foldGutter: false,
        highlightActiveLine: false,
        highlightActiveLineGutter: false,
        autocompletion: false,
        closeBrackets: false,
        bracketMatching: false,
        highlightSelectionMatches: false,
        searchKeymap: false
      }}
    />
  );
};
