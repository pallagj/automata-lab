import { EPS } from "./types";

/**
 * The ε rule, the same wherever symbols are written — transition symbols, stack and
 * queue operations, grammar right-hand sides and regexes: "eps" and "epsilon" always
 * mean ε, even inside a word. A backslash keeps the next character literal, so \eps is
 * the letters e, p, s. Names (states, variables, machines) are never touched.
 */

/** Replaces eps/epsilon with ε; escapes are kept for the caller to resolve. */
export function epsilonWords(text: string): string {
  return text.replace(/\\.|epsilon|eps/gs, (m) => (m.startsWith("\\") ? m : EPS));
}

/** Removes the escaping backslashes: \e → e. */
export function unescapeSymbols(text: string): string {
  return text.replace(/\\(.)/gs, "$1");
}

/** Escapes text so that it reads back literally: the inverse of symbolString for ε-free text. */
export function escapeSymbols(text: string): string {
  return text.replaceAll("\\", "\\\\").replaceAll("eps", "\\eps");
}

/**
 * A string of symbols with ε as the identity of concatenation:
 * "εA" and "Aeps" are "A", and "ε" or "eps" alone is "" (the empty word).
 */
export function symbolString(text: string): string {
  return unescapeSymbols(epsilonWords(text).replace(/(?<!\\)ε/g, ""));
}
