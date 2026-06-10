import { EPS } from "../types";
import { FSM } from "../fsm/fsm";
import { PDA } from "../pda/pda";
import { TM } from "../tm/tm";
import { Grammar } from "../grammar/grammar";
import { Definition } from "./definitionParser";

/** Definíció visszaírása a szerkeszthető YAML-formátumba. */
export function serializeDefinition(d: Definition): string {
  switch (d.kind) {
    case "fsm":
      return serializeFSM(d);
    case "pda":
      return serializePDA(d);
    case "tm":
      return serializeTM(d);
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

function serializePDA(p: PDA): string {
  const lines = [
    "PushdownMachine:",
    `  name: ${scalar(p.name)}`,
    `  charset: ${listLine(p.alphabet)}`,
    `  states: ${listLine(p.states)}`,
    `  init: ${scalar(p.start)}`,
    `  initStack: ${scalar(p.startStack)}`,
    `  acceptMode: ${p.acceptMode}`,
    `  accept: ${listLine(p.accept)}`,
    "  transitions:"
  ];
  for (const t of p.transitions) {
    const pop = t.pop === EPS ? "$" : t.pop;
    const push = t.push === "" ? "$" : t.push;
    lines.push(`    - ${scalar(`${t.from} ${t.input === EPS ? "$" : t.input} ${pop}/${push} ${t.to}`)}`);
  }
  return lines.join("\n");
}

function serializeTM(t: TM): string {
  const moveMap = { R: ">", L: "<", S: "=" } as const;
  const lines = [
    "TuringMachine:",
    `  name: ${scalar(t.name)}`,
    `  charset: ${listLine(t.alphabet)}`,
    `  states: ${listLine(t.states)}`,
    `  init: ${scalar(t.start)}`,
    `  accept: ${listLine(t.accept)}`,
    "  transitions:"
  ];
  for (const tr of t.transitions) {
    lines.push(`    - ${scalar(`${tr.from} ${tr.read}/${tr.write} ${moveMap[tr.move]} ${tr.to}`)}`);
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
