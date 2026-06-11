import { EPS } from "../types";
import { Machine, StorageOp } from "../machine/machine";
import { Grammar } from "../grammar/grammar";
import { Definition } from "./definitionParser";

/** Definíció visszaírása a szerkeszthető YAML-formátumba. */
export function serializeDefinition(d: Definition): string {
  switch (d.kind) {
    case "machine":
      return serializeMachine(d);
    case "grammar":
      return serializeGrammar(d);
  }
}

/** YAML-veszélyes karakterek esetén az egész skalárt idézőjelbe tesszük */
const NEEDS_QUOTE = /[{}[\]:#'"&*?|>%@`]|^[\s-]|^$/;
const scalar = (s: string) => (NEEDS_QUOTE.test(s) ? `"${s.replaceAll('"', '\\"')}"` : s);
const listLine = (items: string[]) => scalar(items.join(", "));

const MOVE_CHAR = { R: ">", L: "<", S: "=" } as const;

function storageOpToken(op: StorageOp): string {
  switch (op.type) {
    case "stack":
      return `${op.pop === EPS ? "$" : op.pop}/${op.push === "" ? "$" : op.push}`;
    case "queue":
      return `${op.take === EPS ? "$" : op.take}/${op.put === "" ? "$" : op.put}`;
    case "tape":
      return `${op.read}/${op.write} ${MOVE_CHAR[op.move]}`;
  }
}

/** a tároló alapértelmezett kezdőtartalma (l. parseStorageEntry) */
const defaultInit = (type: string) => (type === "stack" ? "Z" : "");

export function serializeMachine(m: Machine): string {
  const lines = [
    "Machine:",
    `  name: ${scalar(m.name)}`,
    `  charset: ${listLine(m.alphabet)}`,
    `  states: ${listLine(m.states)}`,
    `  init: ${scalar(m.start)}`,
    `  accept: ${listLine(m.accept)}`
  ];
  if (m.acceptMode !== "finalState") lines.push(`  acceptMode: ${m.acceptMode}`);
  if (m.input !== "head") lines.push(`  input: ${scalar(m.input)}`);
  if (m.storages.length > 0) {
    lines.push("  storages:");
    for (const s of m.storages) {
      if (s.init === defaultInit(s.type)) {
        lines.push(`    ${s.id}: ${s.type}`);
      } else {
        lines.push(`    ${s.id}:`);
        lines.push(`      type: ${s.type}`);
        lines.push(`      init: ${scalar(s.init)}`);
      }
    }
  }
  lines.push("  transitions:");
  for (const t of m.transitions) {
    const tokens = [
      t.from,
      ...(m.input === "head" ? [t.input === EPS ? "$" : t.input] : []),
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
    `  name: ${scalar(g.name)}`,
    `  charset: ${listLine(g.terminals)}`,
    `  variables: ${listLine(g.nonterminals)}`,
    `  init: ${scalar(g.start)}`,
    "  rules:"
  ];
  // azonos bal oldalak összevonása
  const byLeft = new Map<string, string[]>();
  for (const r of g.rules) {
    if (!byLeft.has(r.left)) byLeft.set(r.left, []);
    byLeft.get(r.left)!.push(r.right === "" ? "$" : r.right);
  }
  for (const [left, rights] of byLeft) {
    lines.push(`    - ${left} -> ${rights.join(" | ")}`);
  }
  return lines.join("\n");
}
