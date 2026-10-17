import { describe, expect, it } from "vitest";
import { canonicalName, formatIdent, parseIdent, subscriptText, suggestName, symbolsText, symbolTokens, withSubscript } from "./symbols";
import { rng } from "./testing";

describe("names: one letter, primes, a subscript", () => {
  it("canonical forms", () => {
    expect(canonicalName("M")).toBe("M");
    expect(canonicalName("M1")).toBe("M_1");
    expect(canonicalName("q10")).toBe("q_{10}");
    expect(canonicalName("M_1")).toBe("M_1");
    expect(canonicalName("M_{1}")).toBe("M_1");
    expect(canonicalName("M_{even}")).toBe("M_{even}");
    expect(canonicalName("S'")).toBe("S′");
    expect(canonicalName("S′′_1")).toBe("S′′_1");
    expect(canonicalName("S'2")).toBe("S′_2");
    expect(canonicalName("Γ_0")).toBe("Γ_0");
    expect(canonicalName("  X_a ")).toBe("X_a");
  });

  it("everything else is not a name", () => {
    for (const bad of ["", "EvenA", "M1a", "1M", "M_", "M_{}", "M_{a b}", "M_{a", "M__a", "ε", "M_{a_b}", "M_ab", "_a"])
      expect(canonicalName(bad), bad).toBeNull();
  });

  it("a subscript never holds the separators of rules, stack operations and lists", () => {
    for (const bad of ["X_{a|b}", "X_{a/b}", "X_{a>b}", "X_{a→b}", "X_{a\\b}"]) expect(canonicalName(bad), bad).toBeNull();
    expect(subscriptText("p|q/r>s→t\\u v{w}_x")).toBe("pqrstuvwx");
    expect(canonicalName("A_{A,B}")).toBe("A_{A,B}");
  });

  it("suggests a name for a word", () => {
    expect(suggestName("EvenA")).toBe("E_{venA}");
    expect(suggestName("HasB")).toBe("H_{asB}");
    expect(suggestName("M1")).toBe("M_1");
    expect(suggestName("x")).toBe("x");
    expect(suggestName("12ab")).toBe("a_b");
    expect(suggestName("my name")).toBe("m_{yname}");
    expect(suggestName("123")).toBe("N");
    for (const raw of ["EvenA", "Custom", "a_b c", "Z{x}"]) expect(canonicalName(suggestName(raw)), raw).not.toBeNull();
  });

  it("appends to the subscript", () => {
    expect(withSubscript("M", "det")).toBe("M_{det}");
    expect(withSubscript("M_1", "det")).toBe("M_{1det}");
    expect(withSubscript("G", "2")).toBe("G_2");
    expect(withSubscript("S′", "0")).toBe("S′_0");
  });

  it("formatIdent and parseIdent round-trip", () => {
    for (const i of [
      { base: "X", primes: 0, sub: "" },
      { base: "X", primes: 2, sub: "a" },
      { base: "q", primes: 0, sub: "10" },
      { base: "A", primes: 0, sub: "A,B" }
    ])
      expect(parseIdent(formatIdent(i))).toEqual(i);
  });
});

describe("symbol strings", () => {
  it("a letter with its primes and subscript is one symbol", () => {
    expect(symbolTokens("aX_aS")).toEqual(["a", "X_a", "S"]);
    expect(symbolTokens("X_{ab}c")).toEqual(["X_{ab}", "c"]);
    expect(symbolTokens("X_{a}c")).toEqual(["X_a", "c"]);
    expect(symbolTokens("S′aS'")).toEqual(["S′", "a", "S′"]);
    expect(symbolTokens("Z_0")).toEqual(["Z_0"]);
  });

  it("digits stay symbols of their own", () => {
    expect(symbolTokens("0S1")).toEqual(["0", "S", "1"]);
    expect(symbolTokens("AZ0")).toEqual(["A", "Z", "0"]);
  });

  it("spaces separate, ε and eps are nothing, a backslash is literal", () => {
    expect(symbolTokens("a S b")).toEqual(["a", "S", "b"]);
    expect(symbolTokens("ε")).toEqual([]);
    expect(symbolTokens("eps")).toEqual([]);
    expect(symbolTokens("aepsb")).toEqual(["a", "b"]);
    expect(symbolTokens("epsilon")).toEqual([]);
    expect(symbolTokens("\\eps")).toEqual(["e", "p", "s"]);
    expect(symbolTokens("a\\_b")).toEqual(["a", "_", "b"]);
    expect(symbolTokens("+*()")).toEqual(["+", "*", "(", ")"]);
  });

  it("a malformed subscript does not swallow the letter", () => {
    expect(symbolTokens("X_{a")).toEqual(["X", "_", "{", "a"]);
    expect(symbolTokens("X_")).toEqual(["X", "_"]);
  });

  it("symbolsText reads back exactly, for 3000 random symbol strings", () => {
    const random = rng(42);
    const pool = ["a", "b", "e", "p", "s", "S", "X_a", "X_{ab}", "C_1", "S′", "S′_2", "0", "1", "_", "′", "\\", "+", "(", "{", "}", "s_1", "Γ"];
    expect(symbolsText([])).toBe("");
    for (let n = 0; n < 3000; n++) {
      const len = Math.floor(random() * 7);
      const tokens = Array.from({ length: len }, () => pool[Math.floor(random() * pool.length)]);
      expect(symbolTokens(symbolsText(tokens)), JSON.stringify(tokens)).toEqual(tokens);
    }
  });

  it("e, p, s in a row stay letters", () => {
    expect(symbolsText(["e", "p", "s"])).toBe("\\eps");
    expect(symbolsText(["e", "p", "s_1"])).toBe("\\eps_1");
    expect(symbolsText(["e", "p"])).toBe("ep");
  });
});
