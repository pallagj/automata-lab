/**
 * A kifejezésnyelv műveletei a cella-műveletmenühöz: leírás, csoport,
 * paraméterszám és pontos alkalmazhatóság-vizsgálat (dry-run a core
 * algoritmusokkal, így mindig ugyanazt mondja, mint a tényleges kiértékelés).
 */
import { Definition } from "../../core/parse/definitionParser";
import { FSM } from "../../core/fsm/fsm";
import {
  checkEquivalence,
  cleanFSM,
  complement,
  complete,
  concatFSM,
  determinize,
  minimize,
  product,
  reachable,
  removeEpsilon,
  reverseFSM,
  starFSM,
  unionEpsilon
} from "../../core/fsm/ops";
import { fsmToGrammar, grammarToFSM, grammarToPDA } from "../../core/grammar/grammar";
import { OpResult } from "../../core/types";
import { ExprValue } from "../../core/expr/expression";

export interface OpInfo {
  name: string;
  desc: string;
  args: 1 | 2;
  /** milyen értékre alkalmazható */
  input: "fsm" | "grammar";
  group: string;
}

export const OPS: OpInfo[] = [
  { group: "Normalizálás", name: "epsfree", desc: "ε-mentesítés", args: 1, input: "fsm" },
  { group: "Normalizálás", name: "det", desc: "determinizálás (hatványhalmaz-konstrukció)", args: 1, input: "fsm" },
  { group: "Normalizálás", name: "complete", desc: "teljessé tétel csapdaállapottal", args: 1, input: "fsm" },
  { group: "Normalizálás", name: "reachable", desc: "elérhetetlen állapotok elhagyása", args: 1, input: "fsm" },
  { group: "Normalizálás", name: "min", desc: "minimalizálás (partíciófinomítás)", args: 1, input: "fsm" },
  { group: "Normalizálás", name: "clean", desc: "állapotok átnevezése (A, B, C…)", args: 1, input: "fsm" },

  { group: "Nyelvműveletek", name: "complement", desc: "komplementer nyelv", args: 1, input: "fsm" },
  { group: "Nyelvműveletek", name: "union", desc: "unió (két automata)", args: 2, input: "fsm" },
  { group: "Nyelvműveletek", name: "intersect", desc: "metszet (két automata)", args: 2, input: "fsm" },
  { group: "Nyelvműveletek", name: "difference", desc: "különbség (két automata)", args: 2, input: "fsm" },
  { group: "Nyelvműveletek", name: "concat", desc: "összefűzés (két automata)", args: 2, input: "fsm" },
  { group: "Nyelvműveletek", name: "star", desc: "lezárás (Kleene-csillag)", args: 1, input: "fsm" },
  { group: "Nyelvműveletek", name: "reverse", desc: "megfordítás", args: 1, input: "fsm" },

  { group: "Konverzió", name: "toGrammar", desc: "automata → reguláris nyelvtan", args: 1, input: "fsm" },
  { group: "Konverzió", name: "toFsm", desc: "nyelvtan → véges automata", args: 1, input: "grammar" },
  { group: "Konverzió", name: "toPda", desc: "nyelvtan → veremautomata", args: 1, input: "grammar" },

  { group: "Vizsgálat", name: "equal", desc: "ekvivalencia-vizsgálat ellenpéldával", args: 2, input: "fsm" }
];

const KIND_HU: Record<string, string> = {
  fsm: "véges automata",
  pda: "veremautomata",
  tm: "Turing-gép",
  grammar: "nyelvtan",
  verdict: "összehasonlítás eredménye"
};

export interface Applicability {
  ok: boolean;
  reason?: string;
  /** működő javítási lánc, pl. min(complete(det(M))) */
  fixChain?: string;
}

/** Az op dry-run eredményéből olvassuk ki, miért nem alkalmazható. */
function fromDryRun(r: OpResult<unknown>): Applicability {
  if (r.ok) return { ok: true };
  const firstErr = r.diagnostics.find((d) => d.level === "error");
  return {
    ok: false,
    reason: firstErr?.title ?? "a művelet előfeltétele nem teljesül",
    fixChain: firstErr?.fix?.code
  };
}

function dryRunFsmOp(op: string, f: FSM): Applicability {
  switch (op) {
    case "det":
      return fromDryRun(determinize(f));
    case "min":
      return fromDryRun(minimize(f));
    case "epsfree":
      return fromDryRun(removeEpsilon(f));
    case "complete":
      return fromDryRun(complete(f));
    case "reachable":
      return fromDryRun(reachable(f));
    case "complement":
      return fromDryRun(complement(f));
    case "intersect":
    case "difference":
      // a szorzat-konstrukció előfeltételeit a cella saját gépén teszteljük
      return fromDryRun(product(f, f, op));
    case "union": {
      // teljes DFA-kra szorzat, egyébként ε-konstrukció — mindig megy
      const p = product(f, f, "union");
      return fromDryRun(p.ok ? p : unionEpsilon(f, f));
    }
    case "concat":
      return fromDryRun(concatFSM(f, f));
    case "star":
      return fromDryRun(starFSM(f));
    case "reverse":
      return fromDryRun(reverseFSM(f));
    case "clean":
      return fromDryRun(cleanFSM(f));
    case "toGrammar":
      return fromDryRun(fsmToGrammar(f));
    case "equal":
      return fromDryRun(checkEquivalence(f, f));
    default:
      return { ok: true };
  }
}

/**
 * Alkalmazható-e a művelet az adott cella értékére? Üres cellára minden
 * megengedett (sablon szúródik be); egyébként a tényleges core algoritmus
 * előfeltétel-ellenőrzése dönt, így a „min ε-átmenetekkel” is piros lesz.
 */
export function opApplicability(op: OpInfo, value: ExprValue | Definition | null): Applicability {
  if (value === null) return { ok: true };
  const kind = value.kind;
  if (kind === "verdict")
    return { ok: false, reason: "összehasonlítás eredményére nem alkalmazható" };

  if (op.input === "grammar") {
    if (kind !== "grammar")
      return { ok: false, reason: `nyelvtant vár — ez a cella: ${KIND_HU[kind]}` };
    return fromDryRun(op.name === "toPda" ? grammarToPDA(value) : grammarToFSM(value));
  }

  // op.input === "fsm"
  let fsm: FSM;
  if (kind === "fsm") {
    fsm = value;
  } else if (kind === "grammar") {
    // jobblineáris nyelvtan automatikusan automatává alakul
    const conv = grammarToFSM(value);
    if (!conv.ok)
      return { ok: false, reason: "véges automatát vár — ez a nyelvtan nem jobblineáris" };
    fsm = conv.value!;
  } else {
    return { ok: false, reason: `véges automatát vár — ez a cella: ${KIND_HU[kind]}` };
  }
  return dryRunFsmOp(op.name, fsm);
}
