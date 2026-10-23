import { describe, expect, it } from "vitest";
import { subscriptBackspace, subscriptTyping } from "./subscript";

/** Types the characters one by one, as the editor would (caret at the end). */
function type(start: string, chars: string, digits = true): { text: string; caret: number } {
  let text = start;
  let caret = start.length;
  let auto: number | null = null;
  for (const ch of chars) {
    const e = subscriptTyping(text, caret, ch, digits, auto);
    if (e) {
      text = text.slice(0, e.from) + e.insert + text.slice(e.to);
      caret = e.caret;
      auto = e.auto;
    } else {
      text = text.slice(0, caret) + ch + text.slice(caret);
      caret += ch.length;
      auto = null;
    }
  }
  return { text, caret };
}

describe("typing subscripts", () => {
  it("digits after a letter go to the subscript, the next letter leaves it", () => {
    expect(type("", "M1").text).toBe("M_{1}");
    expect(type("", "M12").text).toBe("M_{12}");
    expect(type("", "M1a").text).toBe("M_{1}a");
    expect(type("", "det(M1)").text).toBe("det(M_{1})");
    expect(type("", "q10 ").text).toBe("q_{10} ");
  });

  it("_ opens a subscript that keeps everything until the caret leaves it", () => {
    const r = type("", "M_even");
    expect(r.text).toBe("M_{even}");
    expect(r.caret).toBe("M_{even".length); // still inside, before the hidden }
    expect(type("", "C_1a").text).toBe("C_{1a}");
  });

  it("digits stay symbols where names are not expected", () => {
    expect(type("", "S1", false).text).toBe("S1");
    expect(type("", "0S1", false).text).toBe("0S1");
  });

  it("_ that does not follow a letter is a plain character (the tape blank)", () => {
    expect(type("a/", "_").text).toBe("a/_");
    expect(type("", "_").text).toBe("_");
  });

  it("inside a subscript a digit or _ is just a character", () => {
    expect(type("", "M_a1").text).toBe("M_{a1}");
    expect(type("", "M_a_").text).toBe("M_{a_}");
  });

  it("primes stay with the letter", () => {
    expect(type("S′", "1").text).toBe("S′_{1}");
  });
});

describe("Backspace and subscripts", () => {
  it("at the start of a subscript it unwraps it", () => {
    expect(subscriptBackspace("M_{ab}", 3)).toMatchObject({ from: 1, to: 6, insert: "ab", caret: 1 });
  });

  it("an empty subscript disappears", () => {
    expect(subscriptBackspace("M_{}", 3)).toMatchObject({ from: 1, to: 4, insert: "", caret: 1 });
  });

  it("right after a subscript the last character goes", () => {
    expect(subscriptBackspace("M_{ab}", 6)).toMatchObject({ from: 4, to: 5, insert: "" });
    expect(subscriptBackspace("M_{a}", 5)).toMatchObject({ from: 1, to: 5, insert: "" });
  });

  it("X_a loses both characters", () => {
    expect(subscriptBackspace("X_a", 3)).toMatchObject({ from: 1, to: 3, insert: "" });
  });

  it("ordinary text is left to the editor", () => {
    expect(subscriptBackspace("abc", 3)).toBeNull();
    expect(subscriptBackspace("{A,B}", 5)).toBeNull();
    expect(subscriptBackspace("a/_", 3)).toBeNull();
  });
});
