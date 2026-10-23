import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { WORKSHEET_LIMITS as L } from "@automatalab/core/worksheet/document";
import { SAVE_VERSION } from "@automatalab/core/worksheet/migrations";
import { OPENAPI_INFO, openApiDocument } from "@automatalab/contract/document";
import { sharingUseCases } from "../../application/sharing";
import type { RateLimiter } from "../../application/ports";
import { memorySnapshotRepository } from "../persistence/memory/snapshotRepository";
import { unlimited } from "../system/rateLimiter";
import { createHttpApp, MAX_BODY_BYTES } from "./app";

const WORKSHEET = {
  version: SAVE_VERSION,
  name: "Házi 1",
  cells: [{ source: "Machine:\n  name: M", layout: { q_0: { x: 1, y: 2 } } }, { source: "D = det(M)" }]
};

function setup(rateLimiter: RateLimiter = unlimited) {
  const snapshots = memorySnapshotRepository();
  let n = 0;
  const sharing = sharingUseCases({
    snapshots,
    rateLimiter,
    clock: { now: () => new Date("2026-10-23T12:00:00Z") },
    randomBytes: (k) => Uint8Array.from({ length: k }, () => n++ % 36),
    publicUrl: "https://automatalab.app"
  });
  const requesters: string[] = [];
  const app = createHttpApp({
    sharing,
    requester: (c) => {
      const r = c.req.header("x-test-requester") ?? "test";
      requesters.push(r);
      return r;
    },
    mcp: async (_req, requester) => new Response(`mcp for ${requester}`)
  });
  const post = (body: unknown, headers: Record<string, string> = {}) =>
    app.request("/api/snapshots", {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: typeof body === "string" ? body : JSON.stringify(body)
    });
  return { app, post, snapshots, requesters };
}

describe("POST /api/snapshots", () => {
  it("stores the worksheet and answers 201 with its link", async () => {
    const { post, snapshots } = setup();
    const res = await post(WORKSHEET);
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ id: "abcdefghij", url: "https://automatalab.app/w/abcdefghij" });
    expect(snapshots.all()[0].worksheet).toEqual(WORKSHEET);
  });

  it("counts the request against its requester", async () => {
    const { post, requesters } = setup();
    await post(WORKSHEET, { "x-test-requester": "1.2.3.4" });
    expect(requesters).toEqual(["1.2.3.4"]);
  });

  const tooMany = <T>(n: number, x: T) => Array.from({ length: n }, () => x);
  const invalid: [string, unknown][] = [
    ["no cells", { ...WORKSHEET, cells: [] }],
    ["no cell list", { version: 1, name: "x" }],
    ["a cell without source", { ...WORKSHEET, cells: [{}] }],
    ["too many cells", { ...WORKSHEET, cells: tooMany(L.cells + 1, { source: "" }) }],
    ["a cell too long", { ...WORKSHEET, cells: [{ source: "a".repeat(L.source + 1) }] }],
    ["a name too long", { ...WORKSHEET, name: "n".repeat(L.name + 1) }],
    ["version 0", { ...WORKSHEET, version: 0 }],
    ["a fractional version", { ...WORKSHEET, version: 1.5 }],
    ["a version as text", { ...WORKSHEET, version: "1" }],
    ["a layout point without y", { ...WORKSHEET, cells: [{ source: "", layout: { q: { x: 1 } } }] }],
    [
      "a layout of too many states",
      {
        ...WORKSHEET,
        cells: [{ source: "", layout: Object.fromEntries(tooMany(L.layoutNodes + 1, 0).map((_, i) => [`q${i}`, { x: 0, y: 0 }])) }]
      }
    ],
    ["an array", [WORKSHEET]],
    ["not JSON", "{"]
  ];
  it.each(invalid)("refuses %s with 400 and stores nothing", async (_, body) => {
    const { post, snapshots } = setup();
    const res = await post(body);
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("invalid");
    expect(snapshots.all()).toEqual([]);
  });

  it("accepts a worksheet at every limit", async () => {
    const { post } = setup();
    const cells = tooMany(L.cells, { source: "" });
    cells[0] = {
      source: "a".repeat(L.source),
      layout: Object.fromEntries(tooMany(L.layoutNodes, 0).map((_, i) => [`q${i}`, { x: i, y: -i }]))
    } as never;
    const res = await post({ version: SAVE_VERSION, name: "n".repeat(L.name), cells });
    expect(res.status).toBe(201);
  });

  it("refuses a body over the size limit with 413, without reading it into a worksheet", async () => {
    const { post, snapshots } = setup();
    const res = await post({ ...WORKSHEET, name: "x".repeat(MAX_BODY_BYTES) });
    expect(res.status).toBe(413);
    expect((await res.json()).error.code).toBe("too_large");
    expect(snapshots.all()).toEqual([]);
  });

  it("refuses a worksheet of a newer app with 422", async () => {
    const res = await setup().post({ ...WORKSHEET, version: SAVE_VERSION + 1 });
    expect(res.status).toBe(422);
    expect((await res.json()).error.code).toBe("newer_version");
  });

  it("answers 429 with Retry-After over the rate limit", async () => {
    const { post } = setup({ take: () => ({ ok: false, retryAfterSeconds: 42 }) });
    const res = await post(WORKSHEET);
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("42");
    expect((await res.json()).error.code).toBe("rate_limited");
  });
});

describe("GET /api/snapshots/{id}", () => {
  it("gives the worksheet back, cacheable for good since it never changes", async () => {
    const { app, post } = setup();
    await post(WORKSHEET);
    const res = await app.request("/api/snapshots/abcdefghij");
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
    expect(await res.json()).toEqual({
      id: "abcdefghij",
      url: "https://automatalab.app/w/abcdefghij",
      createdAt: "2026-10-23T12:00:00.000Z",
      worksheet: WORKSHEET
    });
  });

  it("answers 404 for an id nothing was shared with, and 400 for what is not an id", async () => {
    const { app } = setup();
    expect((await app.request("/api/snapshots/zzzzzzzzzz")).status).toBe(404);
    for (const bad of ["ABCDEFGHIJ", "abc", "abcdefghijk"]) {
      const res = await app.request(`/api/snapshots/${bad}`);
      expect(res.status, bad).toBe(400);
      expect((await res.json()).error.code).toBe("invalid");
    }
  });
});

describe("the rest of the service", () => {
  it("says it is up, and which save version it reads", async () => {
    const res = await setup().app.request("/api/health");
    expect(await res.json()).toEqual({ ok: true, saveVersion: SAVE_VERSION });
  });

  it("implements exactly the contract's operations", () => {
    expect(setup().app.getOpenAPI31Document(OPENAPI_INFO)).toEqual(openApiDocument());
  });

  it("serves the committed OpenAPI document and a reference page for it", async () => {
    const { app } = setup();
    const served = await (await app.request("/api/openapi.json")).json();
    const committed = JSON.parse(await readFile(new URL("../../../../../packages/contract/openapi.json", import.meta.url), "utf8"));
    expect(served).toEqual(committed);
    const docs = await app.request("/api/docs");
    expect(docs.status).toBe(200);
    expect(docs.headers.get("content-type")).toMatch(/text\/html/);
    expect(await docs.text()).toContain("/api/openapi.json");
  });

  it("hands /mcp to the MCP endpoint with the requester", async () => {
    const res = await setup().app.request("/mcp", { method: "POST", headers: { "x-test-requester": "5.6.7.8" } });
    expect(await res.text()).toBe("mcp for 5.6.7.8");
  });

  it("answers anything else with a JSON 404", async () => {
    const res = await setup().app.request("/api/nothing");
    expect(res.status).toBe(404);
    expect((await res.json()).error.code).toBe("not_found");
  });
});
