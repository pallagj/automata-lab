import { describe, expect, it } from "vitest";
import { CELL_TEMPLATES, EXAMPLE_WORKSHEETS } from "./examples";
import { parseDefinition } from "../core/parse/definitionParser";

describe("example worksheets and templates", () => {
  const definitions = [...EXAMPLE_WORKSHEETS.flatMap((w) => w.cells), ...Object.values(CELL_TEMPLATES)].filter(
    (c) => parseDefinition(c) !== null
  );

  it("every definition in them parses without an error", () => {
    expect(definitions.length).toBeGreaterThan(10);
    for (const c of definitions) {
      const r = parseDefinition(c)!;
      expect(r.ok, c).toBe(true);
      expect(r.diagnostics.filter((d) => d.level === "error"), c).toEqual([]);
    }
  });
});
