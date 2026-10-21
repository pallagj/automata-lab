import { EPS } from "../types";
import { escapeSymbols } from "../epsilon";
import { symbolsText } from "../symbols";

/** a symbol position: ε stays ε, literal text is escaped so eps-like letters read back unchanged */
const sym = (s: string) => (s === EPS || s === "" ? EPS : escapeSymbols(s));
/** a string of stack/queue/grammar symbols, ε for none */
const syms = (s: string[]) => (s.length === 0 ? EPS : symbolsText(s));
import { defaultStorageAlphabet, Machine, StorageOp, TAPE_BLANK } from "../machine/machine";
import { Grammar } from "../grammar/grammar";
import { Definition } from "./definitionParser";

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

function storageOpToken(op: StorageOp): string {
  switch (op.type) {
    case "stack":
      return `${op.pop === EPS ? EPS : symbolsText([op.pop])}/${syms(op.push)}`;
    case "queue":
      return `${op.take === EPS ? EPS : symbolsText([op.take])}/${syms(op.put)}`;
    case "tape":
      return `${op.read}/${op.write} ${op.move}`;
  }
}

/** the storage's default initial content (see parseStorageEntry) */
const isDefaultInit = (type: string, init: string[]) =>
  type === "stack" ? init.length === 1 && init[0] === "Z" : init.length === 0;

const sameSet = (a: string[], b: string[]) => a.length === b.length && a.every((x) => b.includes(x));
/** an alphabet's symbols one by one; a lone blank needs no escape */
const alphabetLine = (symbols: string[]) => listLine(symbols.map((x) => (x === TAPE_BLANK ? x : symbolsText([x]))));

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
      if (!ownAlphabet && isDefaultInit(s.type, s.init)) {
        lines.push(`    ${s.id}: ${s.type}`);
        return;
      }
      lines.push(`    ${s.id}:`);
      lines.push(`      type: ${s.type}`);
      if (ownAlphabet) lines.push(`      charset: ${alphabetLine(s.alphabet)}`);
      if (!isDefaultInit(s.type, s.init)) lines.push(`      init: ${scalar(syms(s.init))}`);
    });
  }
  lines.push("  transitions:");
  for (const t of m.transitions) {
    const tokens = [
      t.from,
      ...(m.input === "head" ? [sym(t.input)] : []),
      ...t.ops.map(storageOpToken),
      t.to
    ];
    lines.push(`    - ${scalar(tokens.join(" "))}`);
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
    lines.push(`    - ${left} -> ${rights.join(" | ")}`);
  }
  return lines.join("\n");
}
