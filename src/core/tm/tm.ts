/**
 * Turing-gép: egyszalagos, determinisztikus futtatással (nemdeterminizmus
 * esetén az első illeszkedő átmenetet választja, de a felület jelzi a többit).
 */
export const TM_BLANK = "_";

export interface TM {
  kind: "tm";
  name: string;
  alphabet: string[];
  states: string[];
  start: string;
  accept: string[];
  transitions: TMTransition[];
}

export interface TMTransition {
  from: string;
  /** olvasott szimbólum (TM_BLANK = üres cella) */
  read: string;
  write: string;
  move: "L" | "R" | "S";
  to: string;
}

export interface TMConfig {
  state: string;
  /** a szalag nem üres cellái */
  tape: Map<number, string>;
  head: number;
  status: "running" | "accepted" | "rejected" | "limit";
  steps: number;
}

export function initialTMConfig(t: TM, input: string): TMConfig {
  const tape = new Map<number, string>();
  [...input].forEach((c, i) => {
    if (c !== TM_BLANK) tape.set(i, c);
  });
  return { state: t.start, tape, head: 0, status: "running", steps: 0 };
}

export function readTape(c: TMConfig, pos: number): string {
  return c.tape.get(pos) ?? TM_BLANK;
}

export function matchingTransitions(t: TM, c: TMConfig): TMTransition[] {
  const sym = readTape(c, c.head);
  return t.transitions.filter((tr) => tr.from === c.state && tr.read === sym);
}

export function stepTM(t: TM, c: TMConfig, chosen?: TMTransition): TMConfig {
  if (c.status !== "running") return c;
  const options = matchingTransitions(t, c);
  const tr = chosen ?? options[0];
  if (!tr) {
    // nincs átmenet: megáll — elfogad, ha elfogadó állapotban van
    return { ...c, status: t.accept.includes(c.state) ? "accepted" : "rejected" };
  }
  const tape = new Map(c.tape);
  if (tr.write === TM_BLANK) tape.delete(c.head);
  else tape.set(c.head, tr.write);
  const head = c.head + (tr.move === "R" ? 1 : tr.move === "L" ? -1 : 0);
  const next: TMConfig = { state: tr.to, tape, head, status: "running", steps: c.steps + 1 };
  // ha az új állapot elfogadó és onnan nincs tovább lépés, azonnal jelezhetjük — de
  // tankönyvi módon csak megálláskor döntünk, ezt a következő step kezeli.
  return next;
}

export function runTM(t: TM, input: string, maxSteps = 10000): TMConfig {
  let c = initialTMConfig(t, input);
  while (c.status === "running" && c.steps < maxSteps) {
    const before = c;
    c = stepTM(t, c);
    if (c === before) break;
  }
  if (c.status === "running") c = { ...c, status: "limit" };
  return c;
}

/** A szalag látható szelete sztringként + a fej relatív pozíciója. */
export function tapeWindow(c: TMConfig, radius = 10): { cells: string[]; headIndex: number; startPos: number } {
  let min = c.head;
  let max = c.head;
  for (const k of c.tape.keys()) {
    if (k < min) min = k;
    if (k > max) max = k;
  }
  min = Math.max(min, c.head - radius);
  max = Math.min(max, c.head + radius);
  const cells: string[] = [];
  for (let i = min; i <= max; i++) cells.push(readTape(c, i));
  return { cells, headIndex: c.head - min, startPos: min };
}

export function tmTransitionLabel(tr: TMTransition): string {
  const r = tr.read === TM_BLANK ? "␣" : tr.read;
  const w = tr.write === TM_BLANK ? "␣" : tr.write;
  return r === w ? `${r}, ${tr.move}` : `${r} → ${w}, ${tr.move}`;
}

export function analyzeTM(t: TM): { nondeterministicAt: { state: string; read: string; count: number }[] } {
  const seen = new Map<string, number>();
  for (const tr of t.transitions) {
    const key = `${tr.from}|${tr.read}`;
    seen.set(key, (seen.get(key) ?? 0) + 1);
  }
  const nondeterministicAt: { state: string; read: string; count: number }[] = [];
  for (const [key, count] of seen) {
    if (count > 1) {
      const [state, read] = key.split("|");
      nondeterministicAt.push({ state, read, count });
    }
  }
  return { nondeterministicAt };
}
