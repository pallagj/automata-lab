import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";
import { EXAMPLE_WORKSHEETS } from "@automatalab/core/worksheet/examples";
import { SAVE_VERSION } from "@automatalab/core/worksheet/migrations";
import type { RateLimiter } from "../../application/ports";
import { sharingUseCases } from "../../application/sharing";
import { createHttpApp } from "../http/app";
import { memorySnapshotRepository } from "../persistence/memory/snapshotRepository";
import { unlimited } from "../system/rateLimiter";
import { createMcpServer, exampleMarkdown, mcpHandler } from "./server";

function sharing(rateLimiter: RateLimiter = unlimited) {
  const snapshots = memorySnapshotRepository();
  let n = 0;
  const useCases = sharingUseCases({
    snapshots,
    rateLimiter,
    clock: { now: () => new Date("2026-10-23T12:00:00Z") },
    randomBytes: (k) => Uint8Array.from({ length: k }, () => n++ % 36),
    publicUrl: "https://automatalab.app"
  });
  return { useCases, snapshots };
}

async function connect(rateLimiter?: RateLimiter, requester = "1.2.3.4") {
  const { useCases, snapshots } = sharing(rateLimiter);
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await createMcpServer({ sharing: useCases, requester }).connect(serverSide);
  const client = new Client({ name: "test", version: "0" });
  await client.connect(clientSide);
  return { client, snapshots };
}

const text = (r: unknown) => (r as { content: { type: string; text: string }[] }).content[0].text;

describe("the MCP server", () => {
  it("introduces itself and tells how to learn the notation", async () => {
    const { client } = await connect();
    expect(client.getServerVersion()?.name).toBe("automatalab");
    expect(client.getInstructions()).toMatch(/automatalab:\/\/examples\//);
  });

  it("offers the two tools, marked for what they do", async () => {
    const { client } = await connect();
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(["open_shared_worksheet", "share_worksheet"]);
    const share = tools.find((t) => t.name === "share_worksheet")!;
    expect(share.annotations).toMatchObject({ readOnlyHint: false, destructiveHint: false, openWorldHint: true });
    expect(share.inputSchema.required?.sort()).toEqual(["cells", "name"]);
    expect(tools.find((t) => t.name === "open_shared_worksheet")!.annotations?.readOnlyHint).toBe(true);
  });

  it("shares a worksheet written at the current version and returns its link", async () => {
    const { client, snapshots } = await connect();
    const r = await client.callTool({ name: "share_worksheet", arguments: { name: "Házi", cells: ["Machine:\n  name: M", "det(M)"] } });
    expect(r.isError).toBeFalsy();
    expect(r.structuredContent).toEqual({ id: "abcdefghij", url: "https://automatalab.app/w/abcdefghij" });
    expect(text(r)).toBe("https://automatalab.app/w/abcdefghij");
    expect(snapshots.all()[0].worksheet).toEqual({
      version: SAVE_VERSION,
      name: "Házi",
      cells: [{ source: "Machine:\n  name: M" }, { source: "det(M)" }]
    });
  });

  it("refuses a worksheet without cells, and stores nothing", async () => {
    const { client, snapshots } = await connect();
    const r = await client.callTool({ name: "share_worksheet", arguments: { name: "x", cells: [] } }).catch((e: Error) => e);
    expect(r instanceof Error || (r as { isError?: boolean }).isError).toBe(true);
    expect(snapshots.all()).toEqual([]);
  });

  it("is held to the same rate limit as the REST API, by its requester", async () => {
    const asked: string[] = [];
    const { client } = await connect({ take: (k) => (asked.push(k), { ok: false, retryAfterSeconds: 7 }) }, "5.6.7.8");
    const r = await client.callTool({ name: "share_worksheet", arguments: { name: "x", cells: ["a"] } });
    expect(r.isError).toBe(true);
    expect(text(r)).toMatch(/try again in 7 s/);
    expect(asked).toEqual(["5.6.7.8"]);
  });

  it("opens a shared worksheet from its link or its id", async () => {
    const { client } = await connect();
    await client.callTool({ name: "share_worksheet", arguments: { name: "Házi", cells: ["a", "b"] } });
    for (const link of ["https://automatalab.app/w/abcdefghij", "abcdefghij"]) {
      const r = await client.callTool({ name: "open_shared_worksheet", arguments: { link } });
      expect(r.structuredContent, link).toEqual({
        id: "abcdefghij",
        url: "https://automatalab.app/w/abcdefghij",
        createdAt: "2026-10-23T12:00:00.000Z",
        name: "Házi",
        cells: ["a", "b"]
      });
    }
  });

  it("says so when a link leads nowhere", async () => {
    const { client } = await connect();
    for (const link of ["https://automatalab.app/w/zzzzzzzzzz", "not a link"]) {
      const r = await client.callTool({ name: "open_shared_worksheet", arguments: { link } });
      expect(r.isError, link).toBe(true);
      expect(text(r)).toMatch(/No worksheet/);
    }
  });

  it("offers every example worksheet as a resource to learn the notation from", async () => {
    const { client } = await connect();
    const { resources } = await client.listResources();
    expect(resources.map((r) => r.uri).sort()).toEqual(EXAMPLE_WORKSHEETS.map((e) => `automatalab://examples/${e.key}`).sort());
    const intro = EXAMPLE_WORKSHEETS[0];
    const read = await client.readResource({ uri: `automatalab://examples/${intro.key}` });
    expect(read.contents[0]).toMatchObject({ mimeType: "text/markdown", text: exampleMarkdown(intro) });
  });
});

describe("an example as Markdown", () => {
  it("lists every cell in order, exactly as written", () => {
    const md = exampleMarkdown({ key: "k", name: "Intro", cells: ["Machine:\n  name: M", "det(M)"] });
    expect(md).toBe(
      "# Intro\n\nAn AutomataLab example worksheet of 2 cells.\n\n## Cell 1\n\n```\nMachine:\n  name: M\n```\n\n## Cell 2\n\n```\ndet(M)\n```\n"
    );
  });
});

describe("the MCP endpoint over HTTP", () => {
  it("serves a real client through the REST app's /mcp, statelessly", async () => {
    const { useCases, snapshots } = sharing();
    const app = createHttpApp({ sharing: useCases, requester: () => "9.9.9.9", mcp: mcpHandler({ sharing: useCases }) });
    const transport = new StreamableHTTPClientTransport(new URL("http://test/mcp"), {
      fetch: async (url, init) => app.request(url instanceof URL ? url.href : String(url), init)
    });
    const client = new Client({ name: "test", version: "0" });
    await client.connect(transport);
    const r = await client.callTool({ name: "share_worksheet", arguments: { name: "Web", cells: ["x"] } });
    expect(r.structuredContent).toEqual({ id: "abcdefghij", url: "https://automatalab.app/w/abcdefghij" });
    expect(snapshots.all()).toHaveLength(1);
    // every request has its own server: a second call works the same
    expect((await client.listTools()).tools).toHaveLength(2);
    await client.close();
  });
});
