import { Decoration, DecorationSet, EditorView, RangeSetBuilder, ViewPlugin, ViewUpdate } from "@uiw/react-codemirror";
import { FUNCTION_NAMES } from "../../core/expr/expression";
import { readIdent } from "../../core/symbols";
import { EPS } from "../../core/types";

/**
 * Expression cells set as mathematics, like in the lecture notes: names in italic, function
 * names, digits and brackets upright, a little space around = and + — only
 * shown, never typed, so "D=det(M)" and "D = det(M)" look the same. Inside regex(…) the
 * letters are the symbols of the pattern, also italic; the Kleene star is raised.
 */

export interface MathToken {
  from: number;
  to: number;
  /** space-separated style names: var fn num op eq bin comma pl pr star paren const sub */
  cls: string;
}

const FUNCTIONS_LONGEST_FIRST = [...FUNCTION_NAMES].sort((a, b) => b.length - a.length);
const isLetter = (c: string | undefined) => c !== undefined && c !== EPS && /^\p{L}$/u.test(c);
const isDigit = (c: string | undefined) => c !== undefined && /^[0-9]$/.test(c);

export function mathTokens(text: string): MathToken[] {
  const out: MathToken[] = [];
  const blank = (i: number) => i < 0 || i >= text.length || /\s/.test(text[i]);
  /** an operator gets space on a side only where none was typed */
  const op = (i: number, kind: string, sides: "both" | "right" = "both") =>
    out.push({
      from: i,
      to: i + 1,
      cls: ["op", kind, sides === "both" && !blank(i - 1) ? "pl" : "", !blank(i + 1) ? "pr" : ""].filter(Boolean).join(" ")
    });
  /** a subscript's characters: letters italic, digits upright */
  const subscript = (from: number, to: number) => {
    for (let k = from; k < to; k++) out.push({ from: k, to: k + 1, cls: isDigit(text[k]) ? "num" : "var" });
  };

  let regexDepth = 0; // > 0 inside regex(…)
  let regexNext = false; // regex was just named: its "(" opens the pattern
  for (let i = 0; i < text.length; ) {
    const c = text[i];
    if (regexDepth > 0) {
      if (c === "(") regexDepth++;
      if (c === ")") regexDepth--;
      if (c === "(" || c === ")") out.push({ from: i, to: i + 1, cls: "paren" });
      else if (c === "\\" && i + 1 < text.length) {
        out.push({ from: i + 1, to: i + 2, cls: "var" });
        i += 2;
        continue;
      } else if (c === "+" || c === "|") op(i, "bin");
      else if (c === "*" || c === "?") out.push({ from: i, to: i + 1, cls: "star" });
      else if (c === EPS || c === "∅") out.push({ from: i, to: i + 1, cls: "const" });
      else if (isDigit(c)) out.push({ from: i, to: i + 1, cls: "num" });
      else if (!/\s/.test(c)) out.push({ from: i, to: i + 1, cls: "var" });
      i++;
      continue;
    }
    if (isLetter(c)) {
      const fn = FUNCTIONS_LONGEST_FIRST.find((f) => text.startsWith(f, i) && !/[\p{L}\p{N}_]/u.test(text[i + f.length] ?? ""));
      if (fn) {
        out.push({ from: i, to: i + fn.length, cls: "fn" });
        regexNext = fn === "regex";
        i += fn.length;
        continue;
      }
      const r = readIdent(text, i, true);
      if (!r) {
        out.push({ from: i, to: i + 1, cls: "var" });
        i++;
        continue;
      }
      let k = i + 1;
      while (text[k] === "′" || text[k] === "'") k++;
      out.push({ from: i, to: k, cls: "var" });
      if (text[k] === "_" && text[k + 1] === "{") subscript(k + 2, r.end - 1);
      else if (text[k] === "_") subscript(k + 1, r.end);
      // M1 typed without "_" is M₁ too: its digits are shown as a subscript
      else if (r.end > k) out.push({ from: k, to: r.end, cls: "num sub" });
      i = r.end;
      continue;
    }
    if (c === "(") {
      out.push({ from: i, to: i + 1, cls: "paren" });
      if (regexNext) regexDepth = 1;
    } else if (c === ")") out.push({ from: i, to: i + 1, cls: "paren" });
    else if (isDigit(c)) out.push({ from: i, to: i + 1, cls: "num" });
    else if (c === "=") op(i, "eq");
    else if (c === "+" || c === "|") op(i, "bin");
    else if (c === ",") op(i, "comma", "right");
    else if (c === "*") out.push({ from: i, to: i + 1, cls: "star" });
    if (!/\s/.test(c)) regexNext = false;
    i++;
  }
  return out;
}

function decorations(view: EditorView): DecorationSet {
  const b = new RangeSetBuilder<Decoration>();
  for (const t of mathTokens(view.state.doc.toString()))
    b.add(t.from, t.to, Decoration.mark({ class: t.cls.split(" ").map((c) => `cm-m-${c}`).join(" ") }));
  return b.finish();
}

export const mathStyle = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = decorations(view);
    }
    update(u: ViewUpdate) {
      if (u.docChanged) this.decorations = decorations(u.view);
    }
  },
  { decorations: (v) => v.decorations }
);
