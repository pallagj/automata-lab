import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { generatedFiles } from "./generate";
import { openApiDocument } from "./document";

const committed = (path: string) => readFile(new URL(path, import.meta.url), "utf8");

describe("the generated contract files", () => {
  it("openapi.json is the document of the routes (run `npm run gen` after changing them)", async () => {
    expect(await committed("../openapi.json")).toBe((await generatedFiles()).openapi);
  });

  it("the client's types are generated from that document", async () => {
    expect(await committed("./generated/api.ts")).toBe((await generatedFiles()).types);
  });
});

describe("the OpenAPI document", () => {
  const doc = openApiDocument();

  it("names every operation, so generated clients get readable method names", () => {
    const ops = Object.values(doc.paths ?? {}).flatMap((p) =>
      Object.values(p as Record<string, { operationId?: string }>)
    );
    expect(ops.map((o) => o.operationId).sort()).toEqual(["health", "openSnapshot", "shareWorksheet"]);
  });

  it("keeps the shared schemas as named components", () => {
    expect(Object.keys(doc.components?.schemas ?? {}).sort()).toEqual(
      ["Error", "Health", "SharedLink", "Snapshot", "Worksheet", "WorksheetCell"].sort()
    );
  });
});
