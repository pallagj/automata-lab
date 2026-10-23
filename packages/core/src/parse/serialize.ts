import { EPS } from "../types";
import { escapeSymbols } from "../epsilon";
import { symbolsText } from "../symbols";

/** a symbol position: ε stays ε, literal text is escaped so eps-like letters read back unchanged */
const sym = (s: string) => (s === EPS || s === "" ? EPS : escapeSymbols(s));
/** a string of stack/queue/grammar symbols, ε for none */
const syms = (s: string[]) => (s.length === 0 ? EPS : symbolsText(s));
import {
  defaultStorageAlphabet,
  isReadOnlyTape,
  Machine,
  readOnlyByDefault,
  StorageOp,
  StorageSpec,
  TAPE_BLANK
} from "../machine/machine";
import { Grammar } from "../grammar/grammar";
import { Definition } from "./definitionParser";
import { transitionScalar, writeDelta } from "./delta";

/** Writes a definition back to the editable YAML format. */
export function serializeDefinition(d: Definition): string {
  switch (d.kind) {
    case "machine":
      return serializeMachine(d);
    case "grammar":
      return serializeGrammar(d);
  }
}

/** the whole scalar is quoted when it contains YAML-unsafe characters */
const NEEDS_QUOTE = /[{}[\]:#'"&*?|>%@`]|^[\s-]|^$/;
const scalar = (s: string) => (NEEDS_QUOTE.test(s) ? `"${s.replaceAll('"', '\\"')}"` : s);
const listLine = (items: string[]) => scalar(items.join(", "));

/**
 * A list item, single-quoted when it starts with a YAML indicator — a rule of bracketed
 * variables, [qAp] → a[pBr], would read as a flow list. Single quotes escape nothing, so a
 * backslash of the symbols stays as it is.
 */
export const yamlItem = (s: string) => (/^[[\]{}&*!|>'"%@`#?]/.test(s) ? `'${s.replaceAll("'", "''")}'` : s);

/** one symbol, read back as itself; a lone blank needs no escape */
const one = (x: string) => (x === TAPE_BLANK ? x : symbolsText([x]));

/**
 * A storage operation's parts of δ (see parse/delta.ts): what it reads, what is written —
 * nothing on a read-only tape — and a head's move.
 */
function storageOpParts(op: StorageOp, spec: StorageSpec): { arg: string; write: string[]; move: string[] } {
  switch (op.type) {
    case "stack":
      return { arg: op.pop === EPS ? EPS : one(op.pop), write: [syms(op.push)], move: [] };
    case "queue":
      return { arg: op.take === EPS ? EPS : one(op.take), write: [syms(op.put)], move: [] };
    case "tape":
      return { arg: one(op.read), write: isReadOnlyTape(spec) ? [] : [one(op.write)], move: [op.move] };
  }
}

/** the storage's default initial content (see parseStorageEntry) */
const isDefaultInit = (type: string, init: string[]) =>
  type === "stack" ? init.length === 1 && init[0] === "Z" : init.length === 0;

const sameSet = (a: string[], b: string[]) => a.length === b.length && a.every((x) => b.includes(x));
/** an alphabet's symbols one by one */
const alphabetLine = (symbols: string[]) => listLine(symbols.map(one));

export function serializeMachine(m: Machine): string {
  const lines = [
    "Machine:",
    // an unnamed definition stays unnamed
    ...(m.name ? [`  name: ${scalar(m.name)}`] : []),
    `  charset: ${listLine(m.alphabet)}`,
    `  states: ${listLine(m.states)}`,
    `  init: ${scalar(m.start)}`,
    `  accept: ${listLine(m.accept)}`
  ];
  if (m.acceptMode !== "finalState") lines.push(`  acceptMode: ${m.acceptMode}`);
  if (m.input !== "head") lines.push(`  input: ${scalar(m.input)}`);
  if (m.storages.length > 0) {
    lines.push("  storages:");
    m.storages.forEach((s, i) => {
      // the alphabet is written only where it is not the default one
      const ownAlphabet = !sameSet(s.alphabet, defaultStorageAlphabet(m.alphabet, s, m.transitions.map((t) => t.ops[i])));
      // a tape is infinite to the right by default: only the other way is written out
      const bothWays = s.type === "tape" && s.infinite === "both";
      // whether a tape is written is said only where it is not the default (readOnlyByDefault)
      const access = s.type === "tape" && isReadOnlyTape(s) !== readOnlyByDefault(m.input, m.storages, s.id);
      if (!ownAlphabet && isDefaultInit(s.type, s.init) && !bothWays && !access) {
        lines.push(`    ${s.id}: ${s.type}`);
        return;
      }
      lines.push(`    ${s.id}:`);
      lines.push(`      type: ${s.type}`);
      if (bothWays) lines.push("      infinite: both");
      if (access) lines.push(`      writable: ${!isReadOnlyTape(s)}`);
      if (ownAlphabet) lines.push(`      charset: ${alphabetLine(s.alphabet)}`);
      if (!isDefaultInit(s.type, s.init)) lines.push(`      init: ${scalar(syms(s.init))}`);
    });
  }
  lines.push("  transitions:");
  for (const t of m.transitions) {
    const parts = t.ops.map((op, i) => storageOpParts(op, m.storages[i]));
    const args = [t.from, ...(m.input === "head" ? [sym(t.input)] : []), ...parts.map((p) => p.arg)];
    const values = [t.to, ...parts.flatMap((p) => p.write), ...parts.flatMap((p) => p.move)];
    lines.push(`    - ${transitionScalar(writeDelta(args, values))}`);
  }
  return lines.join("\n");
}

function serializeGrammar(g: Grammar): string {
  const lines = [
    "Grammar:",
    ...(g.name ? [`  name: ${scalar(g.name)}`] : []),
    `  charset: ${listLine(g.terminals)}`,
    `  variables: ${listLine(g.nonterminals)}`,
    `  init: ${scalar(g.start)}`,
    "  rules:"
  ];
  // merge rules with identical left-hand sides
  const byLeft = new Map<string, string[]>();
  for (const r of g.rules) {
    const left = symbolsText(r.left);
    if (!byLeft.has(left)) byLeft.set(left, []);
    byLeft.get(left)!.push(syms(r.right));
  }
  for (const [left, rights] of byLeft) {
    lines.push(`    - ${yamlItem(`${left} -> ${rights.join(" | ")}`)}`);
  }
  return lines.join("\n");
}
