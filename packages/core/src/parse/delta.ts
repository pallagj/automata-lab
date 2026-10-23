import { StorageSpec } from "../machine/machine";

/**
 * A transition in the YAML is written as the lecture notes write δ: its arguments in
 * parentheses, an arrow, then its value — a state alone for an automaton, a tuple otherwise:
 *
 *   (q, a) -> p                  automaton: δ(q, a) = p
 *   (q, a, Z) -> (p, AZ)         pushdown automaton: (p, AZ) ∈ δ(q, a, Z)
 *   (q, a) -> (p, b, R)          Turing machine: δ(q, a) = (p, b, D)
 *   (q, a, c) -> (p, d, R, L)    k-tape Turing machine: δ(q, a₁a₂) = (p, b₂, d₁d₂) (9.9) —
 *                                its input tape is read-only, nothing is written on it
 *   (q, a, Z, Y) -> (p, AZ, ε)   one argument per storage, in their order
 *
 * The value is the next state, then what is written on each storage in their order (a
 * stack's word, a writable tape's symbol), then each tape's move — the notes' order of
 * (q′, b₂…b_k, d₁…d_k). → may stand for ->. The parts are separated by commas; the states
 * come first and may be set names with commas of their own ({A,B}).
 */

export interface DeltaText {
  /** the state, then the symbols read */
  args: string[];
  /** the next state, then what is written (and how a head moves) */
  values: string[];
  /** whether the arguments were in parentheses, and a value of several parts too */
  wellFormed: boolean;
}

const ARROW = /->|→/;

/** A part list: the first part is a state and may hold commas inside braces ({A,B}). */
function splitParts(text: string): string[] {
  let depth = 0;
  let i = 0;
  for (; i < text.length; i++) {
    const c = text[i];
    if (c === "{") depth++;
    else if (c === "}") depth = Math.max(0, depth - 1);
    else if (c === "," && depth === 0) break;
  }
  const rest = i < text.length ? text.slice(i + 1).split(",") : [];
  return [text.slice(0, i), ...rest].map((s) => s.trim());
}

/** Reads a transition line, also an unfinished one (for the form): see wellFormed. */
export function readDelta(line: string): DeltaText {
  const m = ARROW.exec(line);
  const left = (m ? line.slice(0, m.index) : line).trim();
  const right = m ? line.slice(m.index + m[0].length).trim() : "";
  // an opening parenthesis without its closing one is an unfinished line: still the tuple
  const unwrap = (s: string) => {
    if (!s.startsWith("(")) return { inner: s, closed: false };
    const closed = s.length > 1 && s.endsWith(")");
    return { inner: s.slice(1, closed ? -1 : undefined), closed };
  };
  const l = unwrap(left);
  const r = unwrap(right);
  const args = splitParts(l.inner);
  const values = splitParts(r.inner);
  const valueOk = right.startsWith("(") ? r.closed : values.length === 1;
  return { args, values, wellFormed: m !== null && l.closed && valueOk };
}

/** Writes a transition line: a value of one part (a state) stands alone. */
export function writeDelta(args: string[], values: string[]): string {
  const value = values.length === 1 ? values[0] : `(${values.join(", ")})`;
  return `(${args.join(", ")}) -> ${value}`;
}

/** A storage as δ sees it: its type, and whether a tape is only read. */
export type StorageShape = Pick<StorageSpec, "type" | "readOnly">;

/** The parts a storage adds to δ's value: what is written on it, how its head moves. */
const writeParts = (s: StorageShape) => (s.type === "tape" && s.readOnly ? 0 : 1);
const moveParts = (s: StorageShape) => (s.type === "tape" ? 1 : 0);

/**
 * How many fields a storage has in a transition: a stack's pop and push, a tape's read,
 * write and move — a read-only tape's read and move.
 */
export const fieldCount = (s: StorageShape) => 1 + writeParts(s) + moveParts(s);

/** How many parts δ's value has: the next state, what is written, the moves. */
export const valueCount = (storages: StorageShape[]) =>
  1 + storages.reduce((n, s) => n + writeParts(s) + moveParts(s), 0);

/**
 * δ's parts as the fields of a form row — the state, the input symbol, each storage's fields
 * one after the other (pop, push · read, write, move), the next state — padded to the shape.
 */
export function deltaToRow(d: Pick<DeltaText, "args" | "values">, hasHead: boolean, storages: StorageShape[]): string[] {
  const arg = (i: number) => d.args[i] ?? "";
  const value = (i: number) => d.values[i] ?? "";
  let a = 1;
  // the writes come first in the value, the moves after them
  let w = 1;
  let m = 1 + storages.reduce((n, s) => n + writeParts(s), 0);
  const fields: string[] = [];
  if (hasHead) fields.push(arg(a++));
  for (const s of storages) {
    fields.push(arg(a++));
    if (writeParts(s)) fields.push(value(w++));
    if (moveParts(s)) fields.push(value(m++));
  }
  return [arg(0), ...fields, value(0)];
}

/** A form row back to δ's arguments and value. */
export function rowToDelta(row: string[], hasHead: boolean, storages: StorageShape[]): Pick<DeltaText, "args" | "values"> {
  const args = [row[0] ?? ""];
  const writes: string[] = [];
  const moves: string[] = [];
  let i = 1;
  if (hasHead) args.push(row[i++] ?? "");
  for (const s of storages) {
    args.push(row[i++] ?? "");
    if (writeParts(s)) writes.push(row[i++] ?? "");
    if (moveParts(s)) moves.push(row[i++] ?? "");
  }
  return { args, values: [row[row.length - 1] ?? "", ...writes, ...moves] };
}

const SUBSCRIPT_DIGITS = "₀₁₂₃₄₅₆₇₈₉";

/**
 * The shape this machine's transitions take, for an error message: (q, a, Z) -> (p, γ);
 * with several storages each part has the storage's number, (q, a₁, a₂) -> (p, b₂, D₁, D₂).
 */
export function deltaShape(hasHead: boolean, storages: StorageShape[]): string {
  const n = (i: number) =>
    storages.length > 1 ? [...String(i + 1)].map((c) => SUBSCRIPT_DIGITS[Number(c)]).join("") : "";
  const args = ["q", ...(hasHead ? ["a"] : []), ...storages.map((s, i) => (s.type === "tape" ? "a" : "Z") + n(i))];
  const writes = storages.flatMap((s, i) => (writeParts(s) ? [(s.type === "tape" ? "b" : "γ") + n(i)] : []));
  const moves = storages.flatMap((s, i) => (moveParts(s) ? ["D" + n(i)] : []));
  return writeDelta(args, ["p", ...writes, ...moves]);
}

/**
 * A transition line as a YAML scalar: plain where YAML reads it back as it is (a line
 * starts with its parenthesis), single-quoted where ": " or " #" would cut it — single
 * quotes keep a backslash (\eps) literal.
 */
export function transitionScalar(line: string): string {
  return /: |:$| #|^[^(]/.test(line) ? `'${line.replaceAll("'", "''")}'` : line;
}
