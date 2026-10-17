import {
  Decoration,
  DecorationSet,
  EditorState,
  EditorView,
  Extension,
  keymap,
  Prec,
  RangeSetBuilder,
  StateEffect,
  StateField,
  ViewPlugin,
  ViewUpdate,
  WidgetType
} from "@uiw/react-codemirror";
import { EPS } from "../../core/types";

/**
 * Desmos-style subscripts while typing (see core/symbols.ts for the text form):
 *   - "_" right after a letter opens a subscript — the text gets "_{}" and the caret
 *     goes inside; it stays there until → leaves it;
 *   - in a name context, a digit right after a letter opens a subscript by itself and
 *     the following digits stay in it; any other character leaves it (M1a → M_{1}a);
 *   - Backspace treats a subscript as one structure: at its start it unwraps it, at its
 *     end it deletes its last character, and an empty one disappears.
 * The "_{" and "}" are hidden and skipped by the caret, so it reads like Desmos.
 */

const isLetter = (c: string | undefined) => c !== undefined && c !== EPS && /^\p{L}$/u.test(c);

/** Is there a name (letter + primes) right before `pos`? */
function nameBefore(doc: string, pos: number): boolean {
  let i = pos - 1;
  while (i >= 0 && (doc[i] === "′" || doc[i] === "'")) i--;
  return i >= 0 && isLetter(doc[i]);
}

/** Is `pos` inside the braces of a subscript (after "_{", before its "}")? */
function insideSubscript(doc: string, pos: number): boolean {
  const open = doc.lastIndexOf("_{", pos - 1);
  if (open === -1) return false;
  const close = doc.indexOf("}", open);
  return close === -1 || close >= pos;
}

export interface Edit {
  from: number;
  to: number;
  insert: string;
  caret: number;
  /** the position of the "}" of a subscript opened by a digit, while the caret is at it */
  auto: number | null;
}

/**
 * What typing `ch` at `pos` does; null for an ordinary insert. `digits`: whether a digit
 * after a letter opens a subscript here; `auto`: the "}" of the subscript the last digit
 * opened (non-digits leave it).
 */
export function subscriptTyping(doc: string, pos: number, ch: string, digits: boolean, auto: number | null): Edit | null {
  if (auto === pos && doc[pos] === "}" && !/^[0-9]$/.test(ch)) {
    // leave the digit subscript, then type the character after it
    return { from: pos + 1, to: pos + 1, insert: ch, caret: pos + 1 + ch.length, auto: null };
  }
  if (auto === pos && /^[0-9]$/.test(ch)) return { from: pos, to: pos, insert: ch, caret: pos + 1, auto: pos + 1 };
  if (insideSubscript(doc, pos) || !nameBefore(doc, pos)) return null;
  if (ch === "_") return { from: pos, to: pos, insert: "_{}", caret: pos + 2, auto: null };
  if (digits && /^[0-9]$/.test(ch)) return { from: pos, to: pos, insert: `_{${ch}}`, caret: pos + 3, auto: pos + 3 };
  return null;
}

/** What Backspace at `pos` does to a subscript; null for an ordinary Backspace. */
export function subscriptBackspace(doc: string, pos: number): Edit | null {
  // at the start of a subscript: unwrap it (an empty one disappears)
  if (doc.slice(pos - 2, pos) === "_{" && nameBefore(doc, pos - 2)) {
    const close = doc.indexOf("}", pos);
    if (close === -1) return null;
    return { from: pos - 2, to: close + 1, insert: doc.slice(pos, close), caret: pos - 2, auto: null };
  }
  // right after a subscript: its last character goes (and the subscript, if it was the only one)
  if (doc[pos - 1] === "}") {
    const open = doc.lastIndexOf("_{", pos - 1);
    if (open !== -1 && nameBefore(doc, open) && doc.indexOf("}", open) === pos - 1) {
      const content = doc.slice(open + 2, pos - 1);
      if ([...content].length <= 1) return { from: open, to: pos, insert: "", caret: open, auto: null };
      const last = [...content].pop()!;
      return { from: pos - 1 - last.length, to: pos - 1, insert: "", caret: pos - 1 - last.length, auto: null };
    }
  }
  // the single-character form X_a: both the "_" and the character go
  if (doc[pos - 2] === "_" && doc[pos - 1] !== "{" && nameBefore(doc, pos - 2))
    return { from: pos - 2, to: pos, insert: "", caret: pos - 2, auto: null };
  return null;
}

/* ------------------------------------------------------------------ */
/* CodeMirror wiring                                                   */
/* ------------------------------------------------------------------ */

const NAME = /(\p{L}[′']*)_(?:\{([^{}\n]*)\}|([^\s{}_]))/gu;

class EmptySub extends WidgetType {
  toDOM() {
    const el = document.createElement("span");
    el.className = "cm-sub-empty";
    return el;
  }
  ignoreEvent() {
    return false;
  }
}

function buildDecorations(view: EditorView): { decorations: DecorationSet; atomic: DecorationSet } {
  const deco = new RangeSetBuilder<Decoration>();
  const atomic = new RangeSetBuilder<Decoration>();
  const hide = Decoration.replace({});
  const sub = Decoration.mark({ class: "cm-sub" });
  const doc = view.state.doc.toString();
  for (const m of doc.matchAll(NAME)) {
    const at = m.index! + m[1].length; // the "_"
    if (m[2] !== undefined) {
      const contentFrom = at + 2;
      const contentTo = contentFrom + m[2].length;
      deco.add(at, contentFrom, hide);
      atomic.add(at, contentFrom, hide);
      if (m[2] === "") deco.add(contentFrom, contentFrom, Decoration.widget({ widget: new EmptySub(), side: -1 }));
      else deco.add(contentFrom, contentTo, sub);
      deco.add(contentTo, contentTo + 1, hide);
      atomic.add(contentTo, contentTo + 1, hide);
    } else {
      deco.add(at, at + 1, hide);
      atomic.add(at, at + 1, hide);
      deco.add(at + 1, at + 1 + m[3].length, sub);
    }
  }
  return { decorations: deco.finish(), atomic: atomic.finish() };
}

const subscriptView = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    atomic: DecorationSet;
    constructor(view: EditorView) {
      ({ decorations: this.decorations, atomic: this.atomic } = buildDecorations(view));
    }
    update(u: ViewUpdate) {
      if (u.docChanged) ({ decorations: this.decorations, atomic: this.atomic } = buildDecorations(u.view));
    }
  },
  {
    decorations: (v) => v.decorations,
    provide: (plugin) => EditorView.atomicRanges.of((view) => view.plugin(plugin)?.atomic ?? Decoration.none)
  }
);

/** The "}" of the subscript the last typed digit opened, while the caret stays at it. */
const setAuto = StateEffect.define<number | null>();
const autoField = StateField.define<number | null>({
  create: () => null,
  update(value, tr) {
    for (const e of tr.effects) if (e.is(setAuto)) return e.value;
    if (value === null) return null;
    const mapped = tr.changes.mapPos(value, 1);
    return tr.state.selection.main.head === mapped ? mapped : null;
  }
});

function apply(view: EditorView, e: Edit): true {
  view.dispatch({
    changes: { from: e.from, to: e.to, insert: e.insert },
    selection: { anchor: e.caret },
    effects: setAuto.of(e.auto),
    userEvent: "input.type"
  });
  return true;
}

/**
 * The extension. `digitContext(state, pos)` tells whether a digit typed at `pos` right
 * after a letter goes to the subscript (name contexts) — elsewhere digits stay symbols.
 */
export function subscripts(digitContext: (state: EditorState, pos: number, ch: string) => boolean): Extension {
  return [
    autoField,
    subscriptView,
    EditorView.inputHandler.of((view, from, to, text) => {
      if (from !== to || [...text].length !== 1) return false;
      const doc = view.state.doc.toString();
      const e = subscriptTyping(doc, from, text, digitContext(view.state, from, text), view.state.field(autoField));
      return e ? apply(view, e) : false;
    }),
    Prec.high(
      keymap.of([
        {
          key: "Backspace",
          run: (view) => {
            const sel = view.state.selection.main;
            if (!sel.empty) return false;
            const e = subscriptBackspace(view.state.doc.toString(), sel.head);
            return e ? apply(view, e) : false;
          }
        }
      ])
    )
  ];
}

/* ------------------------------------------------------------------ */
/* Where digits go to the subscript                                    */
/* ------------------------------------------------------------------ */

/** The terminals of a grammar definition (its charset line). */
function charsetOf(doc: string): string[] {
  const m = /^\s*charset\s*:\s*(.*)$/m.exec(doc);
  return m ? m[1].replace(/["']/g, "").split(",").map((s) => s.trim()) : [];
}

/**
 * Digits in a YAML definition: in the name, the lists of states and variables, the
 * start and accepting states, the first state of a transition row, and in grammar rules
 * unless the digit is a terminal (S → 0S1 keeps its 1).
 */
export function yamlDigits(state: EditorState, pos: number, ch: string): boolean {
  const line = state.doc.lineAt(pos);
  const head = line.text.slice(0, pos - line.from);
  if (/^\s*(name|variables|init|states|accept)\s*:/.test(head)) return true;
  const row = /^\s*-\s+/.exec(head);
  if (!row) return false;
  const doc = state.doc.toString();
  if (/^\s*(Grammar|grammar)\s*:/.test(doc)) return !charsetOf(doc).includes(ch);
  return !/\s/.test(head.slice(row[0].length));
}
