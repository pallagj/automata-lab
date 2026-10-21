/**
 * Built-in examples: whole worksheets (not single cells) — coherent sets of
 * exercises that load with one click.
 *
 * Every machine uses the same Machine key; whether it is an automaton, a
 * pushdown automaton or a Turing machine is decided by its storages.
 */
export interface ExampleWorksheet {
  /** i18next key in the "ui" namespace, under examples.<key>.name */
  key: string;
  /** English fallback name, used if a translation is missing. */
  name: string;
  cells: string[];
}

const NFA_M1 = `Machine:
  name: M_1
  charset: a, b
  states: S, A, F
  init: S
  accept: F
  transitions:
    - (S, a) -> S
    - (S, b) -> S
    - (S, a) -> A
    - (A, b) -> F`;

const DFA_EVEN_A = `Machine:
  name: E
  charset: a, b
  states: E, O
  init: E
  accept: E
  transitions:
    - (E, a) -> O
    - (O, a) -> E
    - (E, b) -> E
    - (O, b) -> O`;

const DFA_ENDS_B = `Machine:
  name: B
  charset: a, b
  states: N, B
  init: N
  accept: B
  transitions:
    - (N, a) -> N
    - (N, b) -> B
    - (B, a) -> N
    - (B, b) -> B`;

const ENFA_A_OR_B = `Machine:
  name: N
  charset: a, b
  states: S, A, B
  init: S
  accept: A, B
  transitions:
    - (S, ε) -> A
    - (S, ε) -> B
    - (A, a) -> A
    - (B, b) -> B`;

const DFA_HAS_B = `Machine:
  name: H
  charset: a, b
  states: 1, 2
  init: "1"
  accept: "2"
  transitions:
    - (1, a) -> 1
    - (1, b) -> 2
    - (2, a) -> 2
    - (2, b) -> 2`;

export const EXAMPLE_WORKSHEETS: ExampleWorksheet[] = [
  {
    key: "intro",
    name: "Intro — determinization and minimization",
    cells: [NFA_M1, "D = det(M_1)", "M_2 = min(D)", "E = equal(M_1, M_2)"]
  },
  {
    key: "epsilonFree",
    name: "ε-transitions — determinization and ε-removal",
    cells: [
      ENFA_A_OR_B,
      "# The subset construction handles ε-transitions itself (lecture notes 2.16): the start state is E({S}), and a letter leads to the ε-closure of where it goes.",
      "D = det(N)",
      "M = min(D)",
      "# ε-removal is another way: it keeps the states and makes every ε-step a direct transition.",
      "F = epsfree(N)",
      "E = equal(F, M)"
    ]
  },
  {
    key: "regex",
    name: "Regular expressions and automata",
    cells: [
      "R = regex((a|b)*abb)",
      "A = toFsm(R)",
      "D = min(det(A))",
      NFA_M1,
      "E = equal(A, M_1)",
      DFA_HAS_B,
      "R_H = toRegex(H)"
    ]
  },
  {
    key: "setOps",
    name: "Set operations on languages",
    cells: [
      DFA_EVEN_A,
      DFA_ENDS_B,
      "I = intersect(E, B)",
      "U = union(E, B)",
      "D = difference(E, B)",
      "C = complement(E)"
    ]
  },
  {
    key: "pda",
    name: "Pushdown automata",
    cells: [
      `Machine:
  name: P
  charset: a, b
  states: q_0, q_1, q_2
  init: q_0
  accept: q_2
  storages:
    stack: stack
  transitions:
    - (q_0, a, Z) -> (q_0, AZ)
    - (q_0, a, A) -> (q_0, AA)
    - (q_0, b, A) -> (q_1, ε)
    - (q_1, b, A) -> (q_1, ε)
    - (q_1, ε, Z) -> (q_2, Z)
    - (q_0, ε, Z) -> (q_2, Z)`,
      `Machine:
  name: P_{pal}
  charset: a, b
  states: read, match, done
  init: read
  accept: done
  storages:
    stack: stack
  transitions:
    - (read, a, ε) -> (read, a)
    - (read, b, ε) -> (read, b)
    - (read, ε, ε) -> (match, ε)
    - (match, a, a) -> (match, ε)
    - (match, b, b) -> (match, ε)
    - (match, ε, Z) -> (done, Z)`
    ]
  },
  {
    key: "turing",
    name: "Turing machines",
    cells: [
      `Machine:
  name: T
  charset: a, b
  states: start, sawA, sawB, matchA, matchB, back, ok
  init: start
  accept: ok
  input: tape
  storages:
    tape: tape
  transitions:
    - (start, a) -> (sawA, _, R)
    - (start, b) -> (sawB, _, R)
    - (start, _) -> (ok, _, S)
    - (sawA, a) -> (sawA, a, R)
    - (sawA, b) -> (sawA, b, R)
    - (sawA, _) -> (matchA, _, L)
    - (sawB, a) -> (sawB, a, R)
    - (sawB, b) -> (sawB, b, R)
    - (sawB, _) -> (matchB, _, L)
    - (matchA, a) -> (back, _, L)
    - (matchA, _) -> (ok, _, S)
    - (matchB, b) -> (back, _, L)
    - (matchB, _) -> (ok, _, S)
    - (back, a) -> (back, a, L)
    - (back, b) -> (back, b, L)
    - (back, _) -> (start, _, R)`,
      "# A tape is infinite to the right only, as in the lecture notes — a head stepping left off its first cell halts the machine with an error. Adding 1 to a binary number may need a new digit left of the word (11 + 1 = 100), so this tape is infinite both ways.",
      `Machine:
  name: T_{inc}
  charset: 0, 1
  states: right, carry, done
  init: right
  accept: done
  input: tape
  storages:
    tape:
      type: tape
      infinite: both
  transitions:
    - (right, 0) -> (right, 0, R)
    - (right, 1) -> (right, 1, R)
    - (right, _) -> (carry, _, L)
    - (carry, 1) -> (carry, 0, L)
    - (carry, 0) -> (done, 1, S)
    - (carry, _) -> (done, 1, S)`,
      "# The palindrome machine of the lecture notes (example 9.4): x and y are tape symbols beyond Σ, so the tape has its own alphabet Γ.",
      `Machine:
  name: T_{pal}
  charset: a, b
  states: q_0, q_1, q_2, q_3, q_4, q_5, q_6, q_7
  init: q_0
  accept: q_6, q_7
  input: tape
  storages:
    tape:
      type: tape
      charset: a, b, x, y, _
  transitions:
    - (q_0, a) -> (q_1, x, R)
    - (q_0, b) -> (q_2, x, R)
    - (q_0, y) -> (q_7, y, S)
    - (q_1, a) -> (q_1, a, R)
    - (q_1, b) -> (q_1, b, R)
    - (q_1, _) -> (q_3, _, L)
    - (q_1, y) -> (q_3, y, L)
    - (q_2, a) -> (q_2, a, R)
    - (q_2, b) -> (q_2, b, R)
    - (q_2, _) -> (q_4, _, L)
    - (q_2, y) -> (q_4, y, L)
    - (q_3, a) -> (q_5, y, L)
    - (q_3, x) -> (q_6, x, S)
    - (q_4, b) -> (q_5, y, L)
    - (q_4, x) -> (q_6, x, S)
    - (q_5, a) -> (q_5, a, L)
    - (q_5, b) -> (q_5, b, L)
    - (q_5, x) -> (q_0, x, R)`,
      "# A 2-tape Turing machine (lecture notes 9.9) for aⁿbⁿ: the input tape t1 is only read, so δ writes on t2 alone — δ(q, a₁a₂) = (q′, b₂, d₁d₂). The second tape counts the a's, then every b takes one back. Its tapes have a first cell too, so the first a is marked Y — that is where the head of tape 2 must stop.",
      `Machine:
  name: T_2
  charset: a, b
  states: q_0, q_1, q_2, q_3, ok
  init: q_0
  accept: ok
  input: t1
  storages:
    t1: tape
    t2:
      type: tape
      charset: X, Y, _
  transitions:
    - (q_0, _, _) -> (ok, _, S, S)
    - (q_0, a, _) -> (q_1, Y, R, R)
    - (q_1, a, _) -> (q_1, X, R, R)
    - (q_1, b, _) -> (q_2, _, S, L)
    - (q_2, b, X) -> (q_2, X, R, L)
    - (q_2, b, Y) -> (q_3, Y, R, S)
    - (q_3, _, Y) -> (ok, Y, S, S)`
    ]
  },
  {
    key: "customMachines",
    name: "Custom machines — two stacks, a queue",
    cells: [
      `Machine:
  name: M
  charset: a, b, c
  states: qa, qb, qc, ok
  init: qa
  accept: ok
  storages:
    v1: stack
    v2: stack
  transitions:
    - (qa, a, ε, ε) -> (qa, A, ε)
    - (qa, ε, ε, ε) -> (qb, ε, ε)
    - (qb, b, A, ε) -> (qb, ε, B)
    - (qb, ε, ε, ε) -> (qc, ε, ε)
    - (qc, c, ε, B) -> (qc, ε, ε)
    - (qc, ε, Z, Z) -> (ok, ε, ε)`,
      `Machine:
  name: Q
  charset: a, b
  states: collect, consume
  init: collect
  acceptMode: emptyStorages
  storages:
    s: queue
  transitions:
    - (collect, a, ε) -> (collect, A)
    - (collect, ε, ε) -> (consume, ε)
    - (consume, b, A) -> (consume, ε)`
    ]
  },
  {
    key: "grammars",
    name: "Grammars and conversions",
    cells: [
      `Grammar:
  name: G_3
  charset: a, b
  variables: S, A
  init: S
  rules:
    - S -> aS | bA
    - A -> bA | b`,
      "F = toFsm(G_3)",
      `Grammar:
  name: G_2
  charset: a, b
  variables: S
  init: S
  rules:
    - S -> aSb | ε`,
      "P = toPda(G_2)",
      "E = epsfree(G_2)",
      "# A type-1 grammar for aⁿbⁿcⁿ: every rule rewrites one variable in place, βAγ → βαγ (lecture notes 4.14) — so CB → BC is done in four such steps.",
      `Grammar:
  name: G_1
  charset: a, b, c
  variables: S, B, C, W, Z
  init: S
  rules:
    - S -> aSBC | aBC
    - CB -> CZ
    - CZ -> WZ
    - WZ -> WC
    - WC -> BC
    - aB -> ab
    - bB -> bb
    - bC -> bc
    - cC -> cc`,
      "# The non-contracting grammar of example 12.7: Ba → aB is no βAγ → βαγ rule, so it is of type 0 — yet no rule shortens, and its language is context-sensitive (12.6).",
      `Grammar:
  name: N
  charset: a, b, c
  variables: S, B
  init: S
  rules:
    - S -> aBSc | abc
    - Ba -> aB
    - Bb -> bb`
    ]
  },
  {
    key: "cfgNormalForms",
    name: "Context-free grammars — normal forms and CYK",
    cells: [
      "# The order of the lecture notes: ε-rules, unit rules, useless symbols, then the Chomsky normal form.",
      `Grammar:
  name: G
  charset: a, b
  variables: S, A, B, C, D
  init: S
  rules:
    - S -> ABCD
    - A -> CD | AC
    - B -> Cb
    - C -> a | ε
    - D -> bD | ε`,
      "E = epsfree(G)",
      "U = unitfree(E)",
      "T = trim(U)",
      "N = cnf(T)",
      "# A grammar in Chomsky normal form: type a word into its derivability test to see the CYK table (try baaba).",
      `Grammar:
  name: K
  charset: a, b
  variables: S, A, B, C
  init: S
  rules:
    - S -> AB | BC
    - A -> BA | a
    - B -> CC | b
    - C -> AB | a`
    ]
  }
];

/** Cell templates for the "+ Insert" menu — all the same Machine, with different storages. */
export const CELL_TEMPLATES: Record<string, string> = {
  fsm: `Machine:
  name: M
  charset: a, b
  states: S, A
  init: S
  accept: A
  transitions:
    - (S, a) -> A
    - (S, b) -> S
    - (A, a) -> A
    - (A, b) -> S`,
  pda: `Machine:
  name: P
  charset: a, b
  states: q_0, q_1
  init: q_0
  accept: q_1
  storages:
    stack: stack
  transitions:
    - (q_0, a, Z) -> (q_0, AZ)
    - (q_0, ε, Z) -> (q_1, Z)`,
  tm: `Machine:
  name: T
  charset: a, b
  states: start, ok
  init: start
  accept: ok
  input: tape
  storages:
    tape: tape
  transitions:
    - (start, a) -> (start, a, R)
    - (start, _) -> (ok, _, S)`,
  grammar: `Grammar:
  name: G
  charset: a, b
  variables: S
  init: S
  rules:
    - S -> aS | b`,
  machine: `Machine:
  name: C
  charset: a, b
  states: q_0, q_1
  init: q_0
  accept: q_1
  storages:
    v1: stack
    v2: stack
  transitions:
    - (q_0, a, Z, ε) -> (q_0, AZ, ε)
    - (q_0, ε, Z, ε) -> (q_1, Z, ε)`
};

export const STARTER_CELLS: string[] = EXAMPLE_WORKSHEETS[0].cells;

/** Resolves an example worksheet's translated display name, falling back to the English source name. */
export function exampleWorksheetName(t: (key: string) => string, ws: ExampleWorksheet): string {
  const key = `examples.${ws.key}.name`;
  const translated = t(key);
  return translated === key ? ws.name : translated;
}
