import { describe, expect, it } from "vitest";
import { mathTokens } from "./mathStyle";

/** "text|cls" pairs, for readable expectations. */
const show = (text: string) => mathTokens(text).map((t) => `${text.slice(t.from, t.to)}|${t.cls}`);

describe("expression cells set as mathematics", () => {
  it("names italic, function names and brackets upright, space around =", () => {
    expect(show("D=det(M)")).toEqual(["D|var", "=|op eq pl pr", "det|fn", "(|paren", "M|var", ")|paren"]);
  });

  it("typed spaces are not doubled: = only gets the missing side", () => {
    expect(show("D = det(M)")[1]).toBe("=|op eq");
    expect(show("D =det(M)")[1]).toBe("=|op eq pr");
  });

  it("subscripts: letters italic, digits upright; M1 shows its digits as a subscript", () => {
    expect(show("M_{1a}")).toEqual(["M|var", "1|num", "a|var"]);
    expect(show("X_a")).toEqual(["X|var", "a|var"]);
    expect(show("M12")).toEqual(["M|var", "12|num sub"]);
    expect(show("S′_2")).toEqual(["S′|var", "2|num"]);
  });

  it("juxtaposed names and operators between names", () => {
    expect(show("AB+C*")).toEqual(["A|var", "B|var", "+|op bin pl pr", "C|var", "*|star"]);
    expect(show("union(A, B)")).toEqual(["union|fn", "(|paren", "A|var", ",|op comma", "B|var", ")|paren"]);
  });

  it("inside regex(…) the letters are the pattern's symbols", () => {
    expect(show("regex((a|b)*a1ε)")).toEqual([
      "regex|fn",
      "(|paren",
      "(|paren",
      "a|var",
      "||op bin pl pr",
      "b|var",
      ")|paren",
      "*|star",
      "a|var",
      "1|num",
      "ε|const",
      ")|paren"
    ]);
    // after the regex, names again
    expect(show("regex(ab)M")).toContain("M|var");
  });

  it("a name that starts like a function is still a name", () => {
    expect(show("determ")).toEqual(["d|var", "e|var", "t|var", "e|var", "r|var", "m|var"]);
  });
});
