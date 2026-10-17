/**
 * Names and symbols, as in Desmos: a name is a single letter, optionally with primes
 * and a subscript — M, M′, M_1, X_a, C_{12}, M_{even}. Names of worksheet cells, grammar
 * variables and stack symbols all follow this rule; state names are free labels.
 *
 * Text form: `_x` puts the single character x into the subscript, `_{…}` any longer
 * subscript, and ' or ′ adds a prime. Where only a name can stand (a cell name, a list
 * of grammar variables), digits right after the letter go to the subscript like in
 * Desmos: M1 is M_1, q10 is q_{10}.
 */

import { EPS } from "./types";

export interface Ident {
  /** the letter */
  base: string;
  primes: number;
  /** "" = no subscript */
  sub: string;
}

const PRIME = "′";
const isLetter = (c: string | undefined) => c !== undefined && c !== EPS && /^\p{L}$/u.test(c);
const isDigit = (c: string | undefined) => c !== undefined && /^[0-9]$/.test(c);
const isPrime = (c: string | undefined) => c === PRIME || c === "'";
/** characters that cannot be inside a subscript: they separate the parts of rules, stack operations and lists */
const NOT_IN_SUB = /[\s{}_|/\\>→]/;

/** The canonical text of an identifier: X, X′, X_a, X_{ab}. */
export function formatIdent(i: Ident): string {
  const sub = [...i.sub].length === 0 ? "" : [...i.sub].length === 1 ? `_${i.sub}` : `_{${i.sub}}`;
  return i.base + PRIME.repeat(i.primes) + sub;
}

/**
 * Reads one identifier starting at `pos` (which must be a letter). With
 * `digitSubscript`, digits right after the letter (and its primes) are its subscript.
 * Returns null when there is no letter at `pos` or the subscript is malformed.
 */
export function readIdent(text: string, pos: number, digitSubscript: boolean): { ident: Ident; end: number } | null {
  const chars = [...text.slice(pos)];
  if (!isLetter(chars[0])) return null;
  let i = 1;
  let primes = 0;
  while (isPrime(chars[i])) {
    primes++;
    i++;
  }
  let sub = "";
  if (chars[i] === "_") {
    if (chars[i + 1] === "{") {
      const close = chars.indexOf("}", i + 2);
      if (close === -1) return null;
      sub = chars.slice(i + 2, close).join("");
      if (sub === "" || NOT_IN_SUB.test(sub)) return null;
      i = close + 1;
    } else if (chars[i + 1] !== undefined && !NOT_IN_SUB.test(chars[i + 1])) {
      sub = chars[i + 1];
      i += 2;
    }
    // a lone "_" is not part of the name
  } else if (digitSubscript) {
    while (isDigit(chars[i])) sub += chars[i++];
  }
  const end = pos + chars.slice(0, i).join("").length;
  return { ident: { base: chars[0], primes, sub }, end };
}

/** Parses a canonical or typed identifier text; null when it is not exactly one identifier. */
export function parseIdent(text: string, digitSubscript = true): Ident | null {
  const t = text.trim();
  const r = readIdent(t, 0, digitSubscript);
  return r && r.end === t.length ? r.ident : null;
}

/** The canonical form of a name (M1 → M_1, X_{a} → X_a), or null when it is not a name. */
export function canonicalName(text: string): string | null {
  const i = parseIdent(text);
  return i ? formatIdent(i) : null;
}

/** The characters of a text a subscript can hold (the rest is dropped). */
export const subscriptText = (text: string) => [...text].filter((c) => !NOT_IN_SUB.test(c)).join("");

/**
 * A state's label in one form: a label that is a name is written canonically (q0, q_0
 * and q_{0} are all q_0); any other label (AB, 00, {A,B}) stays as it is, with a
 * one-character subscript written without braces.
 */
export function canonicalLabel(text: string): string {
  const t = text.trim();
  return canonicalName(t) ?? t.replace(/_\{([^{}\s])\}/gu, "_$1");
}

/**
 * A name for something that is not one: the first letter, the rest in the subscript
 * (EvenA → E_{venA}, HasB → H_{asB}). Characters a subscript cannot hold are dropped.
 */
export function suggestName(raw: string): string {
  const chars = [...raw.trim()].filter((c) => !NOT_IN_SUB.test(c));
  const first = chars.findIndex((c) => isLetter(c));
  if (first === -1) return "N";
  const rest = chars.slice(first + 1).filter((c) => !isPrime(c));
  return formatIdent({ base: chars[first], primes: 0, sub: rest.join("") });
}

/**
 * The name with something appended to its subscript: (M, det) → M_{det},
 * (M_1, det) → M_{1det}. Used for the names the app makes up.
 */
export function withSubscript(name: string, suffix: string): string {
  const i = parseIdent(name) ?? parseIdent(suggestName(name))!;
  return formatIdent({ ...i, sub: i.sub + [...suffix].filter((c) => !NOT_IN_SUB.test(c)).join("") });
}

/**
 * Splits a string of symbols (a grammar right-hand side, a stack push) into symbols:
 * a letter with its primes and subscript is one symbol, any other character is one
 * symbol. Spaces only separate; ε and the words eps / epsilon stand for nothing; a
 * backslash makes the next character a literal symbol (\eps is e, p, s; \_ is _).
 * Digits are never a subscript here: in S → 0S1 the 1 is a symbol of its own.
 */
export function symbolTokens(text: string): string[] {
  const out: string[] = [];
  const chars = [...text];
  for (let i = 0; i < chars.length; ) {
    const c = chars[i];
    if (/\s/.test(c) || c === EPS) {
      i++;
      continue;
    }
    if (c === "\\") {
      if (i + 1 < chars.length) out.push(chars[i + 1]);
      i += 2;
      continue;
    }
    const rest = chars.slice(i).join("");
    if (rest.startsWith("epsilon")) {
      i += 7;
      continue;
    }
    if (rest.startsWith("eps")) {
      i += 3;
      continue;
    }
    const r = isLetter(c) ? readIdent(rest, 0, false) : null;
    if (r) {
      out.push(formatIdent(r.ident));
      i += [...rest.slice(0, r.end)].length;
      continue;
    }
    out.push(c);
    i++;
  }
  return out;
}

/** True for a symbol that has to be escaped to read back as itself. */
const needsEscape = (s: string) => s === "_" || isPrime(s) || s === "\\" || s === EPS || /\s/.test(s);

/**
 * The text of a symbol string that symbolTokens reads back unchanged ("" for none):
 * symbols are written side by side, with a backslash where they would merge or read
 * as something else.
 */
export function symbolsText(tokens: string[]): string {
  let out = "";
  tokens.forEach((t, i) => {
    // a plain letter followed by _ or a prime would take it; e, p, s in a row would read as ε
    const eps = t === "e" && tokens[i + 1] === "p" && tokens[i + 2]?.startsWith("s");
    out += needsEscape(t) || eps ? `\\${t}` : t;
  });
  return out;
}

/** Symbols written side by side, for display: ε for none. */
export const showSymbols = (tokens: string[]) => (tokens.length === 0 ? EPS : tokens.join(""));
