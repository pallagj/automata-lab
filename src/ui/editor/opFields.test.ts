import { describe, expect, it } from "vitest";
import { fieldsToTokens, tokensToFields } from "./opFields";

const stack = [{ id: "s", type: "stack" as const }];
const tape = [{ id: "t", type: "tape" as const }];
const queue = [{ id: "q", type: "queue" as const }];

describe("storage operations as fields", () => {
  it("a stack's Z/AZ is the fields Z and AZ", () => {
    expect(tokensToFields(true, stack, ["a", "Z/AZ"])).toEqual(["a", "Z", "AZ"]);
    expect(fieldsToTokens(true, stack, ["a", "Z", "AZ"])).toEqual(["a", "Z/AZ"]);
  });

  it("a tape's a/b > is the fields a, b, >", () => {
    expect(tokensToFields(false, tape, ["a/b", ">"])).toEqual(["a", "b", ">"]);
    expect(fieldsToTokens(false, tape, ["a", "b", ">"])).toEqual(["a/b", ">"]);
  });

  it("round trips, also with empty fields and subscripts", () => {
    const cases: [boolean, typeof stack | typeof tape | typeof queue, string[]][] = [
      [true, stack, ["ε", "Z_0/X_aZ_0"]],
      [true, stack, ["", "/"]],
      [false, tape, ["_/&", "="]],
      [true, queue, ["a", "A/BA"]]
    ];
    for (const [head, storages, tokens] of cases)
      expect(fieldsToTokens(head, storages, tokensToFields(head, storages, tokens))).toEqual(tokens);
  });
});
