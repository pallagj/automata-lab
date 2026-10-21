import { EPS } from "./types";

/**
 * The answers of the decision questions about languages: equality (lecture notes 5.3),
 * emptiness (5.2, 8.2), finiteness (5.5, 8.3) and disjointness (5.4). A verdict is a value
 * of its own — the cell shows it, but no operation takes it.
 */
export type Verdict = EquivalenceVerdict | EmptinessVerdict | FinitenessVerdict | DisjointnessVerdict;

interface VerdictBase {
  kind: "verdict";
  name: string;
}

export interface EquivalenceVerdict extends VerdictBase {
  question: "equal";
  machineA: string;
  machineB: string;
  equal: boolean;
  /** a word accepted by one but not the other */
  counterexample?: { word: string; acceptedBy: string; rejectedBy: string };
}

export interface EmptinessVerdict extends VerdictBase {
  question: "empty";
  /** what gives the language: a name, or the argument as written */
  subject: string;
  empty: boolean;
  /** a shortest word of the language when there is one ("" = ε) */
  word?: string;
}

/** A word of the language cut into parts by the pumping lemma (3.11: x = uvw, 6.32: z = uvwxy). */
export type Pumping =
  | { kind: "regular"; u: string; v: string; w: string; state: string }
  | { kind: "contextFree"; u: string; v: string; w: string; x: string; y: string; variable: string };

export interface FinitenessVerdict extends VerdictBase {
  question: "finite";
  subject: string;
  finite: boolean;
  /** finite: the words in shortlex order — all of them, or the first WORD_LIST_LIMIT */
  words?: string[];
  /** finite: the number of words in decimal (it can exceed 2⁵³); a lower bound when !countExact */
  count?: string;
  countExact?: boolean;
  /** infinite: a word of the language that pumps */
  pumping?: Pumping;
}

export interface DisjointnessVerdict extends VerdictBase {
  question: "disjoint";
  machineA: string;
  machineB: string;
  disjoint: boolean;
  /** a shortest word of both languages when they meet ("" = ε) */
  common?: string;
}

/** The most words a finiteness verdict lists. */
export const WORD_LIST_LIMIT = 200;

/** A word as shown: ε for the empty word. */
export const showWord = (w: string) => (w === "" ? EPS : w);

/** The words of a pumping for k = 0, 1, 2, …, upTo. */
export function pumpedWords(p: Pumping, upTo = 3): string[] {
  const out: string[] = [];
  for (let k = 0; k <= upTo; k++)
    out.push(p.kind === "regular" ? p.u + p.v.repeat(k) + p.w : p.u + p.v.repeat(k) + p.w + p.x.repeat(k) + p.y);
  return out;
}
