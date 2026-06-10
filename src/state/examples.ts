export interface Example {
  group: string;
  title: string;
  source: string;
}

export const EXAMPLES: Example[] = [
  {
    group: "Véges automata",
    title: "NFA — „ab”-re végződik",
    source: `StateMachine:
  name: M1
  charset: a, b
  states: S, A, F
  init: S
  accept: F
  transitions:
    - S . S
    - S a A
    - A b F`
  },
  {
    group: "Véges automata",
    title: "DFA — páros sok a",
    source: `StateMachine:
  name: ParosA
  charset: a, b
  states: P, T
  init: P
  accept: P
  transitions:
    - P a T
    - T a P
    - P b P
    - T b T`
  },
  {
    group: "Véges automata",
    title: "ε-NFA — a* vagy b*",
    source: `StateMachine:
  name: AvagyB
  charset: a, b
  states: S, A, B
  init: S
  accept: A, B
  transitions:
    - S $ A
    - S $ B
    - A a A
    - B b B`
  },
  {
    group: "Kifejezés",
    title: "Determinizálás lépésekkel",
    source: `D = det(M1)`
  },
  {
    group: "Kifejezés",
    title: "Minimalizálás (javítási lánccal)",
    source: `K = min(complete(det(epsfree(M1))))`
  },
  {
    group: "Kifejezés",
    title: "Reguláris kifejezésből automata",
    source: `R = regex((a|b)*abb)`
  },
  {
    group: "Kifejezés",
    title: "Két automata összehasonlítása",
    source: `E = equal(M1, D)`
  },
  {
    group: "Kifejezés",
    title: "Halmazműveletek",
    source: `U = union(D, det(epsfree(R)))`
  },
  {
    group: "Veremautomata",
    title: "aⁿbⁿ",
    source: `PushdownMachine:
  name: AnBn
  charset: a, b
  states: q0, q1, q2
  init: q0
  initStack: Z
  accept: q2
  transitions:
    - q0 a Z/AZ q0
    - q0 a A/AA q0
    - q0 b A/$ q1
    - q1 b A/$ q1
    - q1 $ Z/Z q2
    - q0 $ Z/Z q2`
  },
  {
    group: "Veremautomata",
    title: "Páros hosszú palindromok",
    source: `PushdownMachine:
  name: Palindrom
  charset: a, b
  states: olvas, parosit, kesz
  init: olvas
  initStack: Z
  accept: kesz
  transitions:
    - olvas a $/a olvas
    - olvas b $/b olvas
    - olvas $ $/$ parosit
    - parosit a a/$ parosit
    - parosit b b/$ parosit
    - parosit $ Z/Z kesz`
  },
  {
    group: "Turing-gép",
    title: "Palindróma-ellenőrző",
    source: `TuringMachine:
  name: Palindrom
  charset: a, b
  states: start, vanA, vanB, parA, parB, vissza, ok
  init: start
  accept: ok
  transitions:
    - start a/_ > vanA
    - start b/_ > vanB
    - start _/& = ok
    - vanA ./& > vanA
    - vanA _/& < parA
    - vanB ./& > vanB
    - vanB _/& < parB
    - parA a/_ < vissza
    - parA _/& = ok
    - parB b/_ < vissza
    - parB _/& = ok
    - vissza ./& < vissza
    - vissza _/& > start`
  },
  {
    group: "Turing-gép",
    title: "Bináris növelés (+1)",
    source: `TuringMachine:
  name: Novel
  charset: 0, 1
  states: jobbra, atvitel, kesz
  init: jobbra
  accept: kesz
  transitions:
    - jobbra ./& > jobbra
    - jobbra _/& < atvitel
    - atvitel 1/0 < atvitel
    - atvitel 0/1 = kesz
    - atvitel _/1 = kesz`
  },
  {
    group: "Nyelvtan",
    title: "Reguláris (3. típusú)",
    source: `Grammar:
  name: G3
  charset: a, b
  variables: S, A
  init: S
  rules:
    - S -> aS | bA
    - A -> bA | b`
  },
  {
    group: "Nyelvtan",
    title: "Környezetfüggetlen — aⁿbⁿ",
    source: `Grammar:
  name: G2
  charset: a, b
  variables: S
  init: S
  rules:
    - S -> aSb | $`
  },
  {
    group: "Nyelvtan",
    title: "Környezetfüggő — aⁿbⁿcⁿ",
    source: `Grammar:
  name: G1
  charset: a, b, c
  variables: S, B
  init: S
  rules:
    - S -> aSBc | abc
    - cB -> Bc
    - bB -> bb`
  }
];

export const STARTER_CELLS: string[] = [
  EXAMPLES[0].source,
  "D = det(M1)",
  "K = min(D)",
  "E = equal(M1, K)"
];
