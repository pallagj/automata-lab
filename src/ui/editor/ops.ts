/** A kifejezésnyelv műveletei a cella-súgóhoz: leírás + paraméterszám + elvárt bemenet. */
export interface OpInfo {
  name: string;
  desc: string;
  args: 1 | 2;
  /** milyen értékre alkalmazható */
  input: "fsm" | "grammar" | "empty";
}

export type CellKind = "fsm" | "pda" | "tm" | "grammar" | "verdict" | null;

const KIND_HU: Record<string, string> = {
  fsm: "véges automata",
  pda: "veremautomata",
  tm: "Turing-gép",
  grammar: "nyelvtan",
  verdict: "összehasonlítás eredménye"
};

/**
 * Alkalmazható-e a művelet az adott cellára?
 * (a jobblineáris nyelvtan automatikusan automatává alakul, ezért arra
 * az automata-műveletek is mennek)
 */
export function opApplicability(
  op: OpInfo,
  kind: CellKind,
  grammarIsRightLinear: boolean
): { ok: boolean; reason?: string } {
  if (kind === null) return { ok: true }; // üres cella: sablon beszúrható
  switch (op.input) {
    case "fsm":
      if (kind === "fsm") return { ok: true };
      if (kind === "grammar" && grammarIsRightLinear)
        return { ok: true };
      return {
        ok: false,
        reason: `véges automatát vár — ez a cella: ${KIND_HU[kind]}${
          kind === "grammar" ? " (nem jobblineáris)" : ""
        }`
      };
    case "grammar":
      return kind === "grammar"
        ? { ok: true }
        : { ok: false, reason: `nyelvtant vár — ez a cella: ${KIND_HU[kind]}` };
    case "empty":
      return { ok: false, reason: "csak üres cellába illeszthető (nyers szöveget vár)" };
  }
}

export const OPS: OpInfo[] = [
  { name: "det", desc: "determinizálás (hatványhalmaz-konstrukció)", args: 1, input: "fsm" },
  { name: "min", desc: "minimalizálás (partíciófinomítás)", args: 1, input: "fsm" },
  { name: "epsfree", desc: "ε-mentesítés", args: 1, input: "fsm" },
  { name: "complete", desc: "teljessé tétel csapdaállapottal", args: 1, input: "fsm" },
  { name: "reachable", desc: "elérhetetlen állapotok elhagyása", args: 1, input: "fsm" },
  { name: "complement", desc: "komplementer nyelv", args: 1, input: "fsm" },
  { name: "union", desc: "unió (két automata)", args: 2, input: "fsm" },
  { name: "intersect", desc: "metszet (két automata)", args: 2, input: "fsm" },
  { name: "difference", desc: "különbség (két automata)", args: 2, input: "fsm" },
  { name: "concat", desc: "összefűzés (két automata)", args: 2, input: "fsm" },
  { name: "star", desc: "lezárás (Kleene-csillag)", args: 1, input: "fsm" },
  { name: "reverse", desc: "megfordítás", args: 1, input: "fsm" },
  { name: "clean", desc: "állapotok átnevezése (A, B, C…)", args: 1, input: "fsm" },
  { name: "toGrammar", desc: "automata → reguláris nyelvtan", args: 1, input: "fsm" },
  { name: "toFsm", desc: "nyelvtan → véges automata", args: 1, input: "grammar" },
  { name: "toPda", desc: "nyelvtan → veremautomata", args: 1, input: "grammar" },
  { name: "equal", desc: "ekvivalencia-vizsgálat ellenpéldával", args: 2, input: "fsm" },
  { name: "regex", desc: "reguláris kifejezés → ε-NFA", args: 1, input: "empty" }
];
