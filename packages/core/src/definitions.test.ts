import { describe, expect, it } from "vitest";
import { makeFSM } from "./fsm/fsm";
import { parseGrammar, parseMachine } from "./parse/definitionParser";
import { DEFINITION_IDS, evaluateExpression, ExprValue, FUNCTION_NAMES } from "./expr/expression";
import enCore from "./i18n/en.json";
import deCore from "./i18n/de.json";
import huCore from "./i18n/hu.json";

const t = (from: string, symbol: string, to: string) => ({ from, symbol, to });

/** a*b over {a, b}: a complete DFA */
const A = makeFSM({
  name: "A",
  alphabet: ["a", "b"],
  states: ["p", "q", "r"],
  start: "p",
  accept: ["q"],
  transitions: [t("p", "a", "p"), t("p", "b", "q"), t("q", "a", "r"), t("q", "b", "r"), t("r", "a", "r"), t("r", "b", "r")]
});
/** words ending in b: a complete DFA */
const B = makeFSM({
  name: "B",
  alphabet: ["a", "b"],
  states: ["s", "f"],
  start: "s",
  accept: ["f"],
  transitions: [t("s", "a", "s"), t("s", "b", "f"), t("f", "a", "s"), t("f", "b", "f")]
});
/** an NFA with an ε-transition, missing transitions and an unreachable state u */
const N = makeFSM({
  name: "N",
  alphabet: ["a", "b"],
  states: ["n_0", "n_1", "u"],
  start: "n_0",
  accept: ["n_1"],
  transitions: [t("n_0", "a", "n_0"), t("n_0", "a", "n_1"), t("n_0", "ε", "n_1"), t("u", "b", "n_1")]
});

const grammar = (name: string, rules: string) => {
  const variables = [...new Set(["S", ...(rules.match(/[A-Z]/g) ?? [])])];
  const lines = rules.split("\n").map((r) => `    - ${r}`);
  const r = parseGrammar(
    `Grammar:\n  name: ${name}\n  charset: a, b\n  variables: ${variables.join(", ")}\n  init: S\n  rules:\n${lines.join("\n")}`
  );
  if (!r.ok) throw new Error(JSON.stringify(r.diagnostics));
  return r.value!;
};
/** context-free, with an ε-rule and a unit rule */
const G = grammar("G", "S -> aSb | A\nA -> ε | b");
/** right-linear */
const H = grammar("H", "S -> aS | b");

const P = parseMachine(`Machine:
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
    - (q_1, ε, Z) -> (q_2, Z)`).value!;

const ENV: [string, ExprValue][] = [
  ["A", A],
  ["B", B],
  ["N", N],
  ["G", G],
  ["H", H],
  ["P", P],
  ["R", { kind: "regex", name: "R", pattern: "(a+b)*a" }]
];

/** Each step group of the expression as [operation, definition id, its arguments]. */
const groups = (src: string) => {
  const r = evaluateExpression(src, new Map(ENV));
  expect(r.ok, `${src}: ${JSON.stringify(r.diagnostics)}`).toBe(true);
  return r.value!.stepGroups.map((g) => [g.operation, g.definition?.id, g.definition?.args]);
};

describe("every operation says what it means before its steps", () => {
  it("the automaton operations", () => {
    expect(groups("det(N)")).toEqual([["det(N)", "det", ["N"]]]);
    expect(groups("min(det(N))")).toEqual([
      ["det(N)", "det", ["N"]],
      ["min(det(N))", "min", ["det(N)"]]
    ]);
    expect(groups("epsfree(N)")).toEqual([["epsfree(N)", "epsfree.fsm", ["N"]]]);
    expect(groups("complete(N)")).toEqual([["complete(N)", "complete", ["N"]]]);
    expect(groups("complete(N, T_1)")).toEqual([["complete(N, T_1)", "complete", ["N", "T_1"]]]);
    expect(groups("reachable(N)")).toEqual([["reachable(N)", "reachable", ["N"]]]);
    expect(groups("complement(A)")).toEqual([["complement(A)", "complement", ["A"]]]);
    expect(groups("concat(A, N)")).toEqual([["concat(A, N)", "concat", ["A", "N"]]]);
    expect(groups("star(N)")).toEqual([["star(N)", "star", ["N"]]]);
    expect(groups("reverse(A)")).toEqual([["reverse(A)", "reverse", ["A"]]]);
    expect(groups("clean(A)")).toEqual([["clean(A)", "clean", ["A"]]]);
    expect(groups("toRegex(A)")).toEqual([["toRegex(A)", "toRegex", ["A"]]]);
  });

  it("union by the product for complete DFAs, by a new start state otherwise", () => {
    expect(groups("union(A, B)")).toEqual([["union(A, B)", "union.product", ["A", "B"]]]);
    expect(groups("union(A, N)")).toEqual([["union(A, N)", "union.epsilon", ["A", "N"]]]);
    expect(groups("intersect(A, B)")).toEqual([["intersect(A, B)", "intersect", ["A", "B"]]]);
    expect(groups("difference(B, A)")).toEqual([["difference(B, A)", "difference", ["B", "A"]]]);
  });

  it("the operators are named as written, a longer chain step by step", () => {
    expect(groups("A B")).toEqual([["A B", "concat", ["A", "B"]]]);
    expect(groups("A B N")).toEqual([
      ["A B", "concat", ["A", "B"]],
      ["A B N", "concat", ["A B", "N"]]
    ]);
    expect(groups("A + B + N")).toEqual([
      ["A + B", "union.epsilon", ["A", "B"]],
      ["A + B + N", "union.epsilon", ["A + B", "N"]]
    ]);
    expect(groups("(A + B)*")).toEqual([
      ["A + B", "union.epsilon", ["A", "B"]],
      ["(A + B)*", "star", ["A + B"]]
    ]);
    expect(groups("(A + B) N")).toEqual([
      ["A + B", "union.epsilon", ["A", "B"]],
      ["(A + B) N", "concat", ["A + B", "N"]]
    ]);
    expect(groups("(A B)* det(N)*")).toEqual([
      ["A B", "concat", ["A", "B"]],
      ["(A B)*", "star", ["A B"]],
      ["det(N)", "det", ["N"]],
      ["det(N)*", "star", ["det(N)"]],
      ["(A B)* det(N)*", "concat", ["(A B)*", "det(N)*"]]
    ]);
  });

  it("the grammar operations", () => {
    expect(groups("epsfree(G)")).toEqual([["epsfree(G)", "epsfree.grammar", ["G"]]]);
    expect(groups("unitfree(epsfree(G))")).toEqual([
      ["epsfree(G)", "epsfree.grammar", ["G"]],
      ["unitfree(epsfree(G))", "unitfree", ["epsfree(G)"]]
    ]);
    expect(groups("trim(G)")).toEqual([["trim(G)", "trim", ["G"]]]);
    expect(groups("cnf(epsfree(G))")).toEqual([
      ["epsfree(G)", "epsfree.grammar", ["G"]],
      ["cnf(epsfree(G))", "cnf", ["epsfree(G)"]]
    ]);
    expect(groups("toPda(G)")).toEqual([["toPda(G)", "toPda", ["G"]]]);
  });

  it("a conversion done in two ways has a definition for each", () => {
    expect(groups("toGrammar(A)")).toEqual([["toGrammar(A)", "toGrammar.fsm", ["A"]]]);
    expect(groups("toGrammar(P)")).toEqual([["toGrammar(P)", "toGrammar.pda", ["P"]]]);
    expect(groups("toFsm(R)")).toEqual([["toFsm(R)", "toFsm.regex", ["R"]]]);
    expect(groups("toFsm(H)")).toEqual([["toFsm(H)", "toFsm.grammar", ["H"]]]);
    // the automatic conversions say what they did too
    expect(groups("det(R)")).toEqual([
      ["toFsm(R)", "toFsm.regex", ["R"]],
      ["det(R)", "det", ["R"]]
    ]);
    expect(groups("det(H)")).toEqual([
      ["toFsm(H)", "toFsm.grammar", ["H"]],
      ["det(H)", "det", ["H"]]
    ]);
  });

  it("the pushdown automaton's acceptance", () => {
    expect(groups("toEmptyStack(P)")).toEqual([["toEmptyStack(P)", "toEmptyStack", ["P"]]]);
    expect(groups("toFinalState(toEmptyStack(P))")).toEqual([
      ["toEmptyStack(P)", "toEmptyStack", ["P"]],
      ["toFinalState(toEmptyStack(P))", "toFinalState", ["toEmptyStack(P)"]]
    ]);
  });

  it("the decisions", () => {
    expect(groups("equal(A, B)")).toEqual([["equal(A, B)", "equal", ["A", "B"]]]);
    expect(groups("disjoint(A, N)")).toEqual([["disjoint(A, N)", "disjoint", ["A", "N"]]]);
    expect(groups("empty(A)")).toEqual([["empty(A)", "empty", ["A"]]]);
    expect(groups("empty(G)")).toEqual([["empty(G)", "empty", ["G"]]]);
    expect(groups("finite(R)")).toEqual([
      ["toFsm(R)", "toFsm.regex", ["R"]],
      ["finite(R)", "finite", ["R"]]
    ]);
    expect(groups("finite(P)")).toEqual([
      ["toGrammar(P)", "toGrammar.pda", ["P"]],
      ["finite(P)", "finite", ["P"]]
    ]);
  });

  it("an operation with nothing to do still has its definition, without steps", () => {
    const r = evaluateExpression("complete(A)", new Map(ENV));
    expect(r.value!.stepGroups).toEqual([{ operation: "complete(A)", definition: { id: "complete", args: ["A"] }, steps: [] }]);
    expect(groups("reachable(A)")).toEqual([["reachable(A)", "reachable", ["A"]]]);
  });

  it("a regular expression written down is no operation; a failed operation shows no definition", () => {
    expect(groups("regex(ab*)")).toEqual([]);
    expect(groups("A")).toEqual([]);
    const r = evaluateExpression("min(N)", new Map(ENV));
    expect(r.ok).toBe(false);
    expect(r.value).toBeUndefined();
  });

  it("every function but regex() has a definition, and every definition belongs to a function", () => {
    const bases = new Set(DEFINITION_IDS.map((id) => id.split(".")[0]));
    expect([...bases].sort()).toEqual(FUNCTION_NAMES.filter((f) => f !== "regex").sort());
  });
});

/* ------------------------------------------------------------------ */

const LOCALES = { en: enCore, de: deCore, hu: huCore };
const FIELDS = ["summary", "input", "output", "guarantee"] as const;

/** The text of core:definition.<id>.<field>. */
function definitionText(core: unknown, id: string, field: string): unknown {
  return ["definition", ...id.split("."), field].reduce<unknown>(
    (node, key) => (typeof node === "object" && node !== null ? (node as Record<string, unknown>)[key] : undefined),
    core
  );
}
const placeholders = (text: string) => [...text.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]).sort();
const fill = (text: string, params: Record<string, string>) => text.replace(/\{\{(\w+)\}\}/g, (_m, k: string) => params[k]);

describe("the definitions' texts", () => {
  for (const [lang, core] of Object.entries(LOCALES)) {
    it(`${lang}: every definition has all four texts, with no other placeholder than the operation and its arguments`, () => {
      for (const id of DEFINITION_IDS) {
        for (const field of FIELDS) {
          const text = definitionText(core, id, field);
          expect(typeof text, `${id}.${field}`).toBe("string");
          expect((text as string).trim().length, `${id}.${field}`).toBeGreaterThan(0);
          for (const p of placeholders(text as string)) expect(["op", "a", "b"], `${id}.${field}: {{${p}}}`).toContain(p);
        }
      }
    });

    it(`${lang}: the same placeholders as in English`, () => {
      for (const id of DEFINITION_IDS)
        for (const field of FIELDS)
          expect(placeholders(definitionText(core, id, field) as string), `${id}.${field}`).toEqual(
            placeholders(definitionText(enCore, id, field) as string)
          );
    });
  }

  it("a definition of two arguments names both of them, one of one argument only the first", () => {
    const binary = new Set(["union.product", "union.epsilon", "intersect", "difference", "concat", "equal", "disjoint"]);
    for (const id of DEFINITION_IDS) {
      const all = FIELDS.flatMap((f) => placeholders(definitionText(enCore, id, f) as string));
      expect(all.includes("a"), id).toBe(true);
      expect(all.includes("b"), id).toBe(binary.has(id));
    }
  });

  it("the guarantee is a claim about the language", () => {
    for (const [lang, core] of Object.entries(LOCALES))
      for (const id of DEFINITION_IDS) expect(definitionText(core, id, "guarantee"), `${lang}: ${id}`).toMatch(/L\(\{\{a\}\}\)/);
    const params = { op: "det(M_1)", a: "M_1", b: "" };
    expect(fill(definitionText(enCore, "det", "guarantee") as string, params)).toBe("L(det(M_1)) = L(M_1)");
    expect(fill(definitionText(huCore, "cnf", "guarantee") as string, { op: "cnf(G)", a: "G", b: "" })).toBe("L(cnf(G)) = L(G) \\ {ε}");
    expect(fill(definitionText(deCore, "complement", "guarantee") as string, { op: "complement(A)", a: "A", b: "" })).toBe(
      "L(complement(A)) = Σ* \\ L(A)"
    );
    expect(fill(definitionText(enCore, "union.product", "guarantee") as string, { op: "union(A, B)", a: "A", b: "B" })).toBe(
      "L(union(A, B)) = L(A) ∪ L(B)"
    );
  });
});
