/**
 * Beépített példák: teljes munkalapok (nem önálló cellák) — egy kattintással
 * betölthető, összefüggő feladatsorok.
 */
export interface ExampleWorksheet {
  name: string;
  cells: string[];
}

const NFA_M1 = `StateMachine:
  name: M1
  charset: a, b
  states: S, A, F
  init: S
  accept: F
  transitions:
    - S . S
    - S a A
    - A b F`;

const DFA_PAROS_A = `StateMachine:
  name: ParosA
  charset: a, b
  states: P, T
  init: P
  accept: P
  transitions:
    - P a T
    - T a P
    - P b P
    - T b T`;

const DFA_VEGE_B = `StateMachine:
  name: VegeB
  charset: a, b
  states: N, B
  init: N
  accept: B
  transitions:
    - N a N
    - N b B
    - B a N
    - B b B`;

const ENFA_A_VAGY_B = `StateMachine:
  name: AvagyB
  charset: a, b
  states: S, A, B
  init: S
  accept: A, B
  transitions:
    - S $ A
    - S $ B
    - A a A
    - B b B`;

export const EXAMPLE_WORKSHEETS: ExampleWorksheet[] = [
  {
    name: "Bemutató — determinizálás és minimalizálás",
    cells: [NFA_M1, "D = det(M1)", "K = min(D)", "E = equal(M1, K)"]
  },
  {
    name: "ε-mentesítés lépésről lépésre",
    cells: [
      ENFA_A_VAGY_B,
      "EM = epsfree(AvagyB)",
      "DM = det(EM)",
      "KM = min(complete(DM))"
    ]
  },
  {
    name: "Reguláris kifejezések és automaták",
    cells: [
      "R = regex((a|b)*abb)",
      "A = toFsm(R)",
      "DR = min(det(epsfree(A)))",
      NFA_M1,
      "Egyenlo = equal(A, M1)"
    ]
  },
  {
    name: "Halmazműveletek nyelveken",
    cells: [
      DFA_PAROS_A,
      DFA_VEGE_B,
      "Metszet = intersect(ParosA, VegeB)",
      "Unio = union(ParosA, VegeB)",
      "Kulonbseg = difference(ParosA, VegeB)",
      "Komplementer = complement(ParosA)"
    ]
  },
  {
    name: "Veremautomaták",
    cells: [
      `PushdownMachine:
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
    - q0 $ Z/Z q2`,
      `PushdownMachine:
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
    ]
  },
  {
    name: "Turing-gépek",
    cells: [
      `TuringMachine:
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
    - vissza _/& > start`,
      `TuringMachine:
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
    ]
  },
  {
    name: "Egyedi gépek — két verem, sor",
    cells: [
      `Machine:
  name: AnBnCn
  charset: a, b, c
  states: qa, qb, qc, ok
  init: qa
  accept: ok
  storages:
    v1: stack(Z)
    v2: stack(Z)
  transitions:
    - qa a $/A $/$ qa
    - qa $ $/$ $/$ qb
    - qb b A/$ $/B qb
    - qb $ $/$ $/$ qc
    - qc c $/$ B/$ qc
    - qc $ Z/$ Z/$ ok`,
      `Machine:
  name: AnBnSorral
  charset: a, b
  states: gyujt, fogyaszt
  init: gyujt
  acceptMode: emptyStorages
  storages:
    s: queue
  transitions:
    - gyujt a $/A gyujt
    - gyujt $ $/$ fogyaszt
    - fogyaszt b A/$ fogyaszt`
    ]
  },
  {
    name: "Nyelvtanok és konverziók",
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
    - S -> aSb | $`,
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

/** Cellasablonok az „+ Beszúrás” menühöz. */
export const CELL_TEMPLATES: Record<string, string> = {
  fsm: `StateMachine:
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
  pda: `PushdownMachine:
  name: P
  charset: a, b
  states: q0, q1
  init: q0
  initStack: Z
  accept: q1
  transitions:
    - q0 a Z/AZ q0
    - q0 $ Z/Z q1`,
  tm: `TuringMachine:
  name: T
  charset: a, b
  states: start, ok
  init: start
  accept: ok
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
  name: Gep
  charset: a, b
  states: q0, q1
  init: q0
  accept: q1
  storages:
    v1: stack(Z)
    v2: stack(Z)
  transitions:
    - q0 a Z/AZ $/$ q0
    - q0 $ Z/Z $/$ q1`
};

export const STARTER_CELLS: string[] = EXAMPLE_WORKSHEETS[0].cells;
