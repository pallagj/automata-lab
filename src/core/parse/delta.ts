import { StorageType } from "../machine/machine";

/**
 * A transition in the YAML is written as the lecture notes write δ: its arguments in
 * parentheses, an arrow, then its value — a state alone for an automaton, a tuple otherwise:
 *
 *   (q, a) -> p                  automaton: δ(q, a) = p
 *   (q, a, Z) -> (p, AZ)         pushdown automaton: (p, AZ) ∈ δ(q, a, Z)
 *   (q, a) -> (p, b, R)          Turing machine: δ(q, a) = (p, b, D)
 *   (q, a, Z, Y) -> (p, AZ, ε)   one argument and one result per storage, in their order
 *
 * → may stand for ->. The parts are separated by commas; the states come first and may be
 * set names with commas of their own ({A,B}).
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

/** The parts a storage adds to δ's arguments and to its value. */
const ARG_PARTS = 1;
const VALUE_PARTS: Record<StorageType, number> = { stack: 1, queue: 1, tape: 2 };

/** How many fields a storage has in a transition: a stack's pop and push, a tape's read, write and move. */
export const fieldCount = (type: StorageType) => ARG_PARTS + VALUE_PARTS[type];

/**
 * δ's parts as the fields of a form row — the state, the input symbol, each storage's fields
 * one after the other (pop, push · read, write, move), the next state — padded to the shape.
 */
export function deltaToRow(d: Pick<DeltaText, "args" | "values">, hasHead: boolean, types: StorageType[]): string[] {
  const arg = (i: number) => d.args[i] ?? "";
  const value = (i: number) => d.values[i] ?? "";
  let a = 1;
  let v = 1;
  const fields: string[] = [];
  if (hasHead) fields.push(arg(a++));
  for (const t of types) {
    fields.push(arg(a++));
    for (let k = 0; k < VALUE_PARTS[t]; k++) fields.push(value(v++));
  }
  return [arg(0), ...fields, value(0)];
}

/** A form row back to δ's arguments and value. */
export function rowToDelta(row: string[], hasHead: boolean, types: StorageType[]): Pick<DeltaText, "args" | "values"> {
  const args = [row[0] ?? ""];
  const values = [row[row.length - 1] ?? ""];
  let i = 1;
  if (hasHead) args.push(row[i++] ?? "");
  for (const t of types) {
    args.push(row[i++] ?? "");
    for (let k = 0; k < VALUE_PARTS[t]; k++) values.push(row[i++] ?? "");
  }
  return { args, values };
}

/** The shape this machine's transitions take, for an error message: (q, a, Z) -> (p, γ). */
export function deltaShape(hasHead: boolean, types: StorageType[]): string {
  const args = ["q", ...(hasHead ? ["a"] : []), ...types.map((t) => (t === "tape" ? "a" : "Z"))];
  const values = ["p", ...types.flatMap((t) => (t === "tape" ? ["b", "D"] : ["γ"]))];
  return writeDelta(args, values);
}

/**
 * A transition line as a YAML scalar: plain where YAML reads it back as it is (a line
 * starts with its parenthesis), single-quoted where ": " or " #" would cut it — single
 * quotes keep a backslash (\eps) literal.
 */
export function transitionScalar(line: string): string {
  return /: |:$| #|^[^(]/.test(line) ? `'${line.replaceAll("'", "''")}'` : line;
}
