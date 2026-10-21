import { describe, expect, it, vi } from "vitest";
import { parseEntityDraft, serializeEntityDraft } from "./EntityForm";
import { parseGrammar } from "../../core/parse/definitionParser";

// the draft is plain data; the store (and the i18n it loads) wants a browser
vi.mock("../../state/store", () => ({ useAppStore: () => undefined }));

const grammar = (rules: string[]) =>
  ["Grammar:", "  name: G", "  charset: a, b", "  variables: S, A", "  init: S", "  rules:", ...rules.map((r) => `    - ${r}`)].join("\n");

describe("a grammar's rules in the form", () => {
  it("are the left-hand side, then each alternative", () => {
    const d = parseEntityDraft(grammar(["S -> aS | b|ε", "A -> a"]))!;
    expect(d.rows).toEqual([
      ["S", "aS", "b", "ε"],
      ["A", "a"]
    ]);
  });

  it("are written back as one line each, as the notes write them", () => {
    const d = parseEntityDraft(grammar(["S -> aS | b|ε", "A -> a"]))!;
    expect(serializeEntityDraft(d)).toBe(grammar(["S -> aS | b | ε", "A -> a"]));
    expect(parseGrammar(serializeEntityDraft(d)).ok).toBe(true);
  });

  it("leave out an alternative left empty, so it never means ε", () => {
    const d = parseEntityDraft(grammar(["S -> aS"]))!;
    d.rows = [["S", "", "aS", " ", "b"]];
    expect(serializeEntityDraft(d)).toBe(grammar(["S -> aS | b"]));
  });

  it("an empty right-hand side stays empty, and the parser asks for ε", () => {
    const d = parseEntityDraft(grammar(["S -> aS"]))!;
    d.rows = [["S", ""]];
    const yaml = serializeEntityDraft(d);
    expect(yaml).toBe(grammar(["S -> "]));
    expect(parseGrammar(yaml).diagnostics[0].title.key).toBe("definitionParser.grammar.emptyAlternative.title");
  });
});
