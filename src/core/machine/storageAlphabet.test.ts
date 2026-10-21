import { describe, expect, it } from "vitest";
import { machineTransitionLabel, runMachine, TAPE_BLANK } from "./machine";
import { parseMachine } from "../parse/definitionParser";
import { serializeMachine } from "../parse/serialize";
import { grammarToPDA } from "../grammar/grammar";
import { parseGrammar } from "../parse/definitionParser";

/** Every word over the alphabet up to the given length, the empty word first. */
function words(alphabet: string[], max: number): string[] {
  const out = [""];
  let layer = [""];
  for (let n = 1; n <= max; n++) {
    layer = layer.flatMap((w) => alphabet.map((a) => w + a));
    out.push(...layer);
  }
  return out;
}

const key = (src: string) => parseMachine(src).diagnostics[0]?.title.key;

const pda = (storage: string, transitions: string[]) => `
Machine:
  charset: a, b
  states: q, f
  init: q
  accept: f
  storages:
${storage}
  transitions:
${transitions.map((t) => `    - ${t}`).join("\n")}
`;

const tm = (storage: string, transitions: string[], charset = "a, b") => `
Machine:
  charset: ${charset}
  states: q, f
  init: q
  accept: f
  input: t
  storages:
${storage}
  transitions:
${transitions.map((t) => `    - ${t}`).join("\n")}
`;

describe("a storage's alphabet Γ left out: the default one", () => {
  it("a stack's: the symbols it starts with, then those its operations use, in order", () => {
    const m = parseMachine(pda("    s: stack", ["(q, a, Z) -> (q, AZ)", "(q, b, A) -> (q, BB)", "(q, ε, B) -> (f, ε)"])).value!;
    expect(m.storages[0].alphabet).toEqual(["Z", "A", "B"]);
  });

  it("a queue's: the same, and nothing when it starts empty and stays untouched", () => {
    expect(parseMachine(pda("    s: queue", ["(q, a, ε) -> (q, A)", "(q, b, A) -> (f, ε)"])).value!.storages[0].alphabet).toEqual(["A"]);
    expect(parseMachine(pda("    s: queue", ["(q, a, ε) -> (f, ε)"])).value!.storages[0].alphabet).toEqual([]);
  });

  it("a tape's: Σ and the blank — what a tape could always hold", () => {
    const m = parseMachine(tm("    t: tape", ["(q, a) -> (q, b, R)", "(q, _) -> (f, _, S)"])).value!;
    expect(m.storages[0].alphabet).toEqual(["a", "b", TAPE_BLANK]);
  });

  it("so a tape may not write a symbol beyond Σ without its own alphabet", () => {
    expect(key(tm("    t: tape", ["(q, a) -> (q, x, R)"]))).toBe("definitionParser.machine.unknownStorageSymbol.title");
  });
});

describe("a storage's own alphabet Γ (charset)", () => {
  const stack = (charset: string, init?: string) =>
    `    s:\n      type: stack\n      charset: ${charset}` + (init ? `\n      init: ${init}` : "");

  it("is read symbol by symbol: names with subscripts and primes, digits, ranges", () => {
    const m = parseMachine(pda(stack('"Z_0, Z′, 0, A-C"', "Z_0"), ["(q, a, Z_0) -> (q, AZ_0)"])).value!;
    expect(m.storages[0].alphabet).toEqual(["Z_0", "Z′", "0", "A", "B", "C"]);
  });

  it("allows exactly its symbols in pops and pushes", () => {
    expect(parseMachine(pda(stack("Z, A"), ["(q, a, Z) -> (q, AZ)", "(q, b, A) -> (f, ε)"])).ok).toBe(true);
    const pushed = parseMachine(pda(stack("Z, A"), ["(q, a, Z) -> (q, BZ)"]));
    expect(pushed.ok).toBe(false);
    expect(pushed.diagnostics[0].title).toEqual({
      key: "definitionParser.machine.unknownStorageSymbol.title",
      params: { symbol: "B", storageId: "s" }
    });
    expect(pushed.diagnostics[0].detail!.params).toMatchObject({ line: "(q, a, Z) -> (q, BZ)", gamma: "{Z, A}" });
    expect(key(pda(stack("Z, A"), ["(q, a, B) -> (q, ε)"]))).toBe("definitionParser.machine.unknownStorageSymbol.title");
  });

  it("ε is never one of its symbols, but means nothing taken or put", () => {
    expect(parseMachine(pda(stack("Z"), ["(q, ε, ε) -> (f, ε)"])).ok).toBe(true);
    expect(key(pda(stack("Z, ε"), ["(q, ε, ε) -> (f, ε)"]))).toBe("definitionParser.machine.storageCharsetNotOneSymbol.title");
  });

  it("an entry that is more than one symbol is an error (Z0 is Z and 0: Z_0 is meant)", () => {
    expect(key(pda(stack("Z0"), ["(q, ε, ε) -> (f, ε)"]))).toBe("definitionParser.machine.storageCharsetNotOneSymbol.title");
    expect(key(pda(stack("Z, AB"), ["(q, ε, ε) -> (f, ε)"]))).toBe("definitionParser.machine.storageCharsetNotOneSymbol.title");
  });

  it("holds the initial content: Z₀ ∈ Γ", () => {
    expect(key(pda(stack("A"), ["(q, ε, ε) -> (f, ε)"]))).toBe("definitionParser.machine.initNotInStorageCharset.title");
    expect(parseMachine(pda(stack("A, $", "$"), ["(q, ε, $) -> (f, $)"])).ok).toBe(true);
  });

  it("a tape's holds the blank: _ ∈ Γ", () => {
    expect(key(tm("    t:\n      type: tape\n      charset: a, b", ["(q, a) -> (q, a, R)"]))).toBe(
      "definitionParser.machine.blankNotInTapeCharset.title"
    );
  });

  it("the input's tape holds Σ: Σ ⊆ Γ", () => {
    const r = parseMachine(tm("    t:\n      type: tape\n      charset: a, _", ["(q, a) -> (q, a, R)"]));
    expect(r.diagnostics[0].title).toEqual({
      key: "definitionParser.machine.inputNotInStorageCharset.title",
      params: { storageId: "t", symbols: "b" }
    });
  });

  it("the blank is no input symbol of a tape-input machine: _ ∈ Γ \\ Σ", () => {
    expect(key(tm("    t: tape", ["(q, a) -> (q, a, R)"], "a, _"))).toBe("definitionParser.machine.blankInInput.title");
  });

  it("lets a tape write symbols beyond Σ, and only those", () => {
    const src = (w: string) => tm("    t:\n      type: tape\n      charset: a, b, x, _", [`(q, a) -> (q, ${w}, R)`]);
    expect(parseMachine(src("x")).ok).toBe(true);
    expect(key(src("y"))).toBe("definitionParser.machine.unknownStorageSymbol.title");
  });

  it(". and & are ordinary symbols, no shorthands", () => {
    const m = parseMachine(
      tm("    t:\n      type: tape\n      charset: a, b, ., &, _", ["(q, .) -> (q, &, R)"], "a, b")
    ).value!;
    expect(m.transitions.map((t) => t.ops[0])).toEqual([{ type: "tape", read: ".", write: "&", move: "R" }]);
  });
});

describe("Γ in the YAML", () => {
  it("is written only where it is not the default one", () => {
    const own = parseMachine(pda("    s:\n      type: stack\n      charset: Z, A, B", ["(q, a, Z) -> (q, AZ)"])).value!;
    const yaml = serializeMachine(own);
    expect(yaml).toContain("    s:\n      type: stack\n      charset: Z, A, B\n");
    expect(yaml).not.toContain("      init:");
    const plain = parseMachine(pda("    s:\n      type: stack\n      charset: A, Z", ["(q, a, Z) -> (q, AZ)"])).value!;
    // the same set as the default {Z, A}: the short form
    expect(serializeMachine(plain)).toContain("    s: stack\n");
  });

  it("a tape's own alphabet and its blank read back unchanged", () => {
    const m = parseMachine(tm("    t:\n      type: tape\n      charset: a, b, x, _", ["(q, a) -> (q, x, R)", "(q, _) -> (f, _, S)"])).value!;
    const yaml = serializeMachine(m);
    expect(yaml).toContain("      charset: a, b, x, _\n");
    const back = parseMachine(yaml).value!;
    expect(back.storages).toEqual(m.storages);
    expect(back.transitions).toEqual(m.transitions);
  });

  it("toPda's stack holds the variables and the terminals", () => {
    const g = parseGrammar(`
Grammar:
  charset: a, b
  variables: S, A
  init: S
  rules:
    - S -> aSb | A
    - A -> ε
`).value!;
    const p = grammarToPDA(g).value!;
    expect(p.storages[0].alphabet).toEqual(["S", "A", "a", "b"]);
    const back = parseMachine(serializeMachine(p));
    expect(back.ok).toBe(true);
    for (const w of words(["a", "b"], 6)) expect(runMachine(back.value!, w).verdict).toBe(runMachine(p, w).verdict);
  });
});

describe("the lecture notes' machines", () => {
  // example 9.4: the palindromes over {a, b}; x and y are tape symbols beyond Σ
  const PALINDROMES = `
Machine:
  name: T
  charset: a, b
  states: q0, q1, q2, q3, q4, q5, q6, q7
  init: q0
  accept: q6, q7
  input: tape
  storages:
    tape:
      type: tape
      charset: a, b, x, y, _
  transitions:
    - (q0, a) -> (q1, x, R)
    - (q0, b) -> (q2, x, R)
    - (q0, y) -> (q7, y, S)
    - (q1, a) -> (q1, a, R)
    - (q1, b) -> (q1, b, R)
    - (q1, _) -> (q3, _, L)
    - (q1, y) -> (q3, y, L)
    - (q2, a) -> (q2, a, R)
    - (q2, b) -> (q2, b, R)
    - (q2, _) -> (q4, _, L)
    - (q2, y) -> (q4, y, L)
    - (q3, a) -> (q5, y, L)
    - (q3, x) -> (q6, x, S)
    - (q4, b) -> (q5, y, L)
    - (q4, x) -> (q6, x, S)
    - (q5, a) -> (q5, a, L)
    - (q5, b) -> (q5, b, L)
    - (q5, x) -> (q0, x, R)
`;

  it("9.4: accepts exactly the nonempty palindromes over {a, b}", () => {
    const m = parseMachine(PALINDROMES).value!;
    for (const w of words(["a", "b"], 8).slice(1)) {
      const palindrome = w === [...w].reverse().join("");
      expect(runMachine(m, w).verdict, w).toBe(palindrome ? "accepted" : "rejected");
    }
  });

  it("9.4: its labels are the figure's, with J, B, H", () => {
    const m = parseMachine(PALINDROMES).value!;
    const hu = { R: "J", L: "B", S: "H" };
    // state labels that are names are canonical: q0 is q_0
    const label = (from: string, to: string) =>
      m.transitions.filter((t) => t.from === from && t.to === to).map((t) => machineTransitionLabel(m, t, hu));
    expect(label("q_0", "q_1")).toEqual(["a → x, J"]);
    expect(label("q_1", "q_3")).toEqual(["_ → _, B", "y → y, B"]);
    expect(label("q_3", "q_6")).toEqual(["x → x, H"]);
    expect(label("q_5", "q_0")).toEqual(["x → x, J"]);
  });

  // example 7.10: accepting with an empty stack, Γ = {0, Z, Z′}, Z′ at the bottom
  const EMPTY_STACK = `
Machine:
  name: M
  charset: 0, 1
  states: p, q0, q1, q2, q3, q4
  init: p
  acceptMode: emptyStorages
  storages:
    stack:
      type: stack
      charset: 0, Z, Z′
      init: Z′
  transitions:
    - (p, ε, Z′) -> (q0, ZZ′)
    - (q0, 0, Z) -> (q1, 0Z)
    - (q1, 0, ε) -> (q1, 0)
    - (q1, 1, 0) -> (q2, ε)
    - (q2, 1, 0) -> (q2, ε)
    - (q2, ε, Z) -> (q3, Z)
    - (q0, ε, 0) -> (q4, ε)
    - (q0, ε, Z) -> (q4, ε)
    - (q3, ε, 0) -> (q4, ε)
    - (q3, ε, Z) -> (q4, ε)
    - (q3, ε, Z′) -> (q4, ε)
    - (q4, ε, 0) -> (q4, ε)
    - (q4, ε, Z) -> (q4, ε)
    - (q4, ε, Z′) -> (q4, ε)
`;

  it("7.10: accepts exactly 0ⁿ1ⁿ (n ≥ 0) with an empty stack", () => {
    const m = parseMachine(EMPTY_STACK).value!;
    for (const w of words(["0", "1"], 8)) {
      const n = w.length / 2;
      const inLanguage = w === "0".repeat(n) + "1".repeat(n);
      expect(runMachine(m, w).verdict, w).toBe(inLanguage ? "accepted" : "rejected");
    }
  });

  it("7.10: its labels are the figure's", () => {
    const m = parseMachine(EMPTY_STACK).value!;
    const label = (from: string, to: string) =>
      m.transitions.filter((t) => t.from === from && t.to === to).map((t) => machineTransitionLabel(m, t));
    expect(label("p", "q_0")).toEqual(["ε; Z′ → ZZ′"]);
    expect(label("q_0", "q_1")).toEqual(["0; Z → 0Z"]);
    expect(label("q_1", "q_1")).toEqual(["0; ε → 0"]);
    expect(label("q_1", "q_2")).toEqual(["1; 0 → ε"]);
    expect(label("q_3", "q_4")).toEqual(["ε; 0 → ε", "ε; Z → ε", "ε; Z′ → ε"]);
  });
});
