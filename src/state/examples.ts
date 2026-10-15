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
  name: M1
  charset: a, b
  states: S, A, F
  init: S
  accept: F
  transitions:
    - S . S
    - S a A
    - A b F`;

const DFA_EVEN_A = `Machine:
  name: EvenA
  charset: a, b
  states: E, O
  init: E
  accept: E
  transitions:
    - E a O
    - O a E
    - E b E
    - O b O`;

const DFA_ENDS_B = `Machine:
  name: EndsB
  charset: a, b
  states: N, B
  init: N
  accept: B
  transitions:
    - N a N
    - N b B
    - B a N
    - B b B`;

const ENFA_A_OR_B = `Machine:
  name: AorB
  charset: a, b
  states: S, A, B
  init: S
  accept: A, B
  transitions:
    - S ε A
    - S ε B
    - A a A
    - B b B`;

export const EXAMPLE_WORKSHEETS: ExampleWorksheet[] = [
  {
    key: "intro",
    name: "Intro — determinization and minimization",
    cells: [NFA_M1, "D = det(M1)", "Min = min(D)", "E = equal(M1, Min)"]
  },
  {
    key: "epsilonFree",
    name: "ε-removal step by step",
    cells: [
      ENFA_A_OR_B,
      "F = epsfree(AorB)",
      "D = det(F)",
      "Min = min(complete(D))"
    ]
  },
  {
    key: "regex",
    name: "Regular expressions and automata",
    cells: [
      "R = regex((a|b)*abb)",
      "A = toFsm(R)",
      "DR = min(det(epsfree(A)))",
      NFA_M1,
      "Same = equal(A, M1)"
    ]
  },
  {
    key: "setOps",
    name: "Set operations on languages",
    cells: [
      DFA_EVEN_A,
      DFA_ENDS_B,
      "Intersection = intersect(EvenA, EndsB)",
      "Union = union(EvenA, EndsB)",
      "Difference = difference(EvenA, EndsB)",
      "Complement = complement(EvenA)"
    ]
  },
  {
    key: "pda",
    name: "Pushdown automata",
    cells: [
      `Machine:
  name: AnBn
  charset: a, b
  states: q0, q1, q2
  init: q0
  accept: q2
  storages:
    stack: stack
  transitions:
    - q0 a Z/AZ q0
    - q0 a A/AA q0
    - q0 b A/ε q1
    - q1 b A/ε q1
    - q1 ε Z/Z q2
    - q0 ε Z/Z q2`,
      `Machine:
  name: Palindrome
  charset: a, b
  states: read, match, done
  init: read
  accept: done
  storages:
    stack: stack
  transitions:
    - read a ε/a read
    - read b ε/b read
    - read ε ε/ε match
    - match a a/ε match
    - match b b/ε match
    - match ε Z/Z done`
    ]
  },
  {
    key: "turing",
    name: "Turing machines",
    cells: [
      `Machine:
  name: Palindrome
  charset: a, b
  states: start, sawA, sawB, matchA, matchB, back, ok
  init: start
  accept: ok
  input: tape
  storages:
    tape: tape
  transitions:
    - start a/_ > sawA
    - start b/_ > sawB
    - start _/& = ok
    - sawA ./& > sawA
    - sawA _/& < matchA
    - sawB ./& > sawB
    - sawB _/& < matchB
    - matchA a/_ < back
    - matchA _/& = ok
    - matchB b/_ < back
    - matchB _/& = ok
    - back ./& < back
    - back _/& > start`,
      `Machine:
  name: Increment
  charset: 0, 1
  states: right, carry, done
  init: right
  accept: done
  input: tape
  storages:
    tape: tape
  transitions:
    - right ./& > right
    - right _/& < carry
    - carry 1/0 < carry
    - carry 0/1 = done
    - carry _/1 = done`
    ]
  },
  {
    key: "customMachines",
    name: "Custom machines — two stacks, a queue",
    cells: [
      `Machine:
  name: AnBnCn
  charset: a, b, c
  states: qa, qb, qc, ok
  init: qa
  accept: ok
  storages:
    v1: stack
    v2: stack
  transitions:
    - qa a ε/A ε/ε qa
    - qa ε ε/ε ε/ε qb
    - qb b A/ε ε/B qb
    - qb ε ε/ε ε/ε qc
    - qc c ε/ε B/ε qc
    - qc ε Z/ε Z/ε ok`,
      `Machine:
  name: AnBnQueue
  charset: a, b
  states: collect, consume
  init: collect
  acceptMode: emptyStorages
  storages:
    s: queue
  transitions:
    - collect a ε/A collect
    - collect ε ε/ε consume
    - consume b A/ε consume`
    ]
  },
  {
    key: "grammars",
    name: "Grammars and conversions",
    cells: [
      `Grammar:
  name: G3
  charset: a, b
  variables: S, A
  init: S
  rules:
    - S -> aS | bA
    - A -> bA | b`,
      "F = toFsm(G3)",
      `Grammar:
  name: G2
  charset: a, b
  variables: S
  init: S
  rules:
    - S -> aSb | ε`,
      "P = toPda(G2)",
      `Grammar:
  name: G1
  charset: a, b, c
  variables: S, B
  init: S
  rules:
    - S -> aSBc | abc
    - cB -> Bc
    - bB -> bb`
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
    - S a A
    - S b S
    - A a A
    - A b S`,
  pda: `Machine:
  name: P
  charset: a, b
  states: q0, q1
  init: q0
  accept: q1
  storages:
    stack: stack
  transitions:
    - q0 a Z/AZ q0
    - q0 ε Z/Z q1`,
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
    - start a/a > start
    - start _/_ = ok`,
  grammar: `Grammar:
  name: G
  charset: a, b
  variables: S
  init: S
  rules:
    - S -> aS | b`,
  machine: `Machine:
  name: Custom
  charset: a, b
  states: q0, q1
  init: q0
  accept: q1
  storages:
    v1: stack
    v2: stack
  transitions:
    - q0 a Z/AZ ε/ε q0
    - q0 ε Z/Z ε/ε q1`
};

export const STARTER_CELLS: string[] = EXAMPLE_WORKSHEETS[0].cells;

/** Resolves an example worksheet's translated display name, falling back to the English source name. */
export function exampleWorksheetName(t: (key: string) => string, ws: ExampleWorksheet): string {
  const key = `examples.${ws.key}.name`;
  const translated = t(key);
  return translated === key ? ws.name : translated;
}
