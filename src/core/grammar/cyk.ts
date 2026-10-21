import { err, failResult, OpResult, okResult, tx } from "../types";
import { classify, Grammar, removeEpsilonRules } from "./grammar";
import { isCNF, toCNF } from "./normalForm";

/**
 * The Cocke–Younger–Kasami algorithm (lecture notes, 8.1): for a grammar in Chomsky
 * normal form, cell T[j][i] holds the variables that derive the j + 1 long subword
 * starting at position i. Next to every variable we count its derivation trees, so a
 * word with more than one tree shows that the grammar is ambiguous.
 */
export interface CykTable {
  word: string[];
  /** cells[j][i]: variable → number of derivation trees of word[i … i + j] from it */
  cells: Map<string, bigint>[][];
  /**
   * why[j][i]: variable → how it got into the cell, in the notes' indexing T[length, start]:
   * "A → a" on the bottom row, "A → BC: B ∈ T[ℓ,i], C ∈ T[j−ℓ,i+ℓ]" above it
   */
  why: Map<string, string[]>[][];
  accepted: boolean;
  /** number of derivation trees of the whole word from the start symbol */
  trees: bigint;
}

export function cyk(g: Grammar, input: string): OpResult<CykTable> {
  if (!isCNF(g)) return failResult([err(tx("grammar.cyk.needsCNF.title"), tx("grammar.cyk.needsCNF.detail"))]);
  const word = [...input];
  const n = word.length;
  const order = new Map(g.nonterminals.map((A, i) => [A, i]));
  const sortCell = (m: Map<string, bigint>) =>
    new Map([...m].sort((a, b) => (order.get(a[0]) ?? 0) - (order.get(b[0]) ?? 0)));
  const add = (m: Map<string, bigint>, A: string, k: bigint) => m.set(A, (m.get(A) ?? 0n) + k);

  const note = (m: Map<string, string[]>, A: string, text: string) => m.set(A, [...(m.get(A) ?? []), text]);
  const cells: Map<string, bigint>[][] = [];
  const why: Map<string, string[]>[][] = [];
  const bottomWhy = word.map(() => new Map<string, string[]>());
  cells.push(
    word.map((c, i) => {
      const m = new Map<string, bigint>();
      for (const r of g.rules)
        if (r.right.length === 1 && r.right[0] === c) {
          add(m, r.left[0], 1n);
          note(bottomWhy[i], r.left[0], `${r.left[0]} → ${c}`);
        }
      return sortCell(m);
    })
  );
  why.push(bottomWhy);
  const binary = g.rules.filter((r) => r.right.length === 2);
  for (let j = 1; j < n; j++) {
    const row: Map<string, bigint>[] = [];
    const whyRow: Map<string, string[]>[] = [];
    for (let i = 0; i + j < n; i++) {
      const m = new Map<string, bigint>();
      const w = new Map<string, string[]>();
      // split: the first part has length l, the second j + 1 − l
      for (let l = 1; l <= j; l++) {
        const left = cells[l - 1][i];
        const right = cells[j - l][i + l];
        for (const r of binary) {
          const b = left.get(r.right[0]);
          const c = right.get(r.right[1]);
          if (b !== undefined && c !== undefined) {
            add(m, r.left[0], b * c);
            // T[length, start], 1-based as in the notes: the parts have lengths l and j + 1 − l
            note(w, r.left[0], `${r.left[0]} → ${r.right.join("")}: ${r.right[0]} ∈ T[${l},${i + 1}], ${r.right[1]} ∈ T[${j + 1 - l},${i + 1 + l}]`);
          }
        }
      }
      row.push(sortCell(m));
      whyRow.push(w);
    }
    cells.push(row);
    why.push(whyRow);
  }
  const trees = n === 0 ? 0n : cells[n - 1][0].get(g.start) ?? 0n;
  return okResult({ word, cells, why, accepted: trees > 0n, trees });
}

export interface Membership {
  accepted: boolean;
  /** null for the empty word: ε ∈ L(G) exactly when the start symbol is nullable */
  table: CykTable | null;
  /** the grammar the table was computed on */
  cnf: Grammar | null;
  /** true when that is a converted grammar, cnf(epsfree(G)), not G itself */
  converted: boolean;
}

/** Exact membership test for a context-free grammar, with the CYK table. */
export function cykMembership(g: Grammar, input: string): OpResult<Membership> {
  const cls = classify(g);
  if (!cls.contextFreeForm)
    return failResult([
      err(tx("grammar.needsContextFree.title", { opKey: "opNames.cyk" }), tx("grammar.needsContextFree.detail"))
    ]);
  const epsFree = cls.epsilonFree ? g : removeEpsilonRules(g).value!;
  if (input === "") {
    const accepted = epsFree.rules.some((r) => r.left[0] === epsFree.start && r.right.length === 0);
    return okResult({ accepted, table: null, cnf: null, converted: false });
  }
  const converted = !isCNF(g);
  const cnf = converted ? toCNF(epsFree).value! : g;
  const table = cyk(cnf, input).value!;
  return okResult({ accepted: table.accepted, table, cnf, converted });
}
