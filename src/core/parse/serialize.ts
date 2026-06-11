import { EPS } from "../types";
import { FSM } from "../fsm/fsm";
import { Machine, machineCaps, StorageOp } from "../machine/machine";
import { Grammar } from "../grammar/grammar";
import { Definition } from "./definitionParser";

/** Definíció visszaírása a szerkeszthető YAML-formátumba. */
export function serializeDefinition(d: Definition): string {
  switch (d.kind) {
    case "fsm":
      return serializeFSM(d);
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

function serializeFSM(f: FSM): string {
  const lines = [
    "StateMachine:",
    `  name: ${scalar(f.name)}`,
    `  charset: ${listLine(f.alphabet)}`,
    `  states: ${listLine(f.states)}`,
    `  init: ${scalar(f.start)}`,
    `  accept: ${listLine(f.accept)}`,
    "  transitions:"
  ];
  for (const t of f.transitions) {
    lines.push(`    - ${scalar(`${t.from} ${t.symbol === EPS ? "$" : t.symbol} ${t.to}`)}`);
  }
  return lines.join("\n");
}

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

export function serializeMachine(m: Machine): string {
  // a preset gépek a tankönyvi, tömör formájukban íródnak vissza
  const caps = machineCaps(m);
  if (m.preset === "pda" && caps.isPDALike) return serializePDAMachine(m);
  if (m.preset === "tm" && caps.isTMLike) return serializeTMMachine(m);
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
      lines.push(`    ${s.id}: ${s.type}${s.init !== "" ? `(${s.init})` : ""}`);
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

function serializePDAMachine(m: Machine): string {
  const lines = [
    "PushdownMachine:",
    `  name: ${scalar(m.name)}`,
    `  charset: ${listLine(m.alphabet)}`,
    `  states: ${listLine(m.states)}`,
    `  init: ${scalar(m.start)}`,
    `  initStack: ${scalar(m.storages[0].init)}`,
    `  acceptMode: ${m.acceptMode === "emptyStorages" ? "emptyStack" : "finalState"}`,
    `  accept: ${listLine(m.accept)}`,
    "  transitions:"
  ];
  for (const t of m.transitions) {
    const op = t.ops[0] as Extract<StorageOp, { type: "stack" }>;
    const pop = op.pop === EPS ? "$" : op.pop;
    const push = op.push === "" ? "$" : op.push;
    lines.push(`    - ${scalar(`${t.from} ${t.input === EPS ? "$" : t.input} ${pop}/${push} ${t.to}`)}`);
  }
  return lines.join("\n");
}

function serializeTMMachine(m: Machine): string {
  const lines = [
    "TuringMachine:",
    `  name: ${scalar(m.name)}`,
    `  charset: ${listLine(m.alphabet)}`,
    `  states: ${listLine(m.states)}`,
    `  init: ${scalar(m.start)}`,
    `  accept: ${listLine(m.accept)}`,
    "  transitions:"
  ];
  for (const t of m.transitions) {
    const op = t.ops[0] as Extract<StorageOp, { type: "tape" }>;
    lines.push(`    - ${scalar(`${t.from} ${op.read}/${op.write} ${MOVE_CHAR[op.move]} ${t.to}`)}`);
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
