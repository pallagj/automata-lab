import { EPS } from "./types";

/**
 * Regex: a whole "eps" / "epsilon" between operators means ε, e.g. (a|eps)* — inside
 * a longer run of letters they stay letters (aeps = a·e·p·s). Write (e)ps for the
 * literal word.
 */
export function regexEpsilonWords(pattern: string): string {
  return pattern.replace(/(?<![^()|+*?])(epsilon|eps)(?![^()|+*?])/g, EPS);
}

/**
 * Grammar right-hand side: ε is the identity of concatenation (εA = A), and "eps" or
 * "epsilon" — alone or inside a word — count as ε too, unless their letters are declared
 * symbols of the grammar, so a grammar over {e, p, s} keeps its letters. No escape is
 * needed: undeclared letters could not be symbols anyway.
 */
export function grammarEpsilon(right: string, declared: Set<string>): string {
  let s = right;
  for (const word of ["epsilon", "eps"]) {
    if (![...word].every((c) => declared.has(c))) s = s.replaceAll(word, EPS);
  }
  return s.replaceAll(EPS, "");
}
