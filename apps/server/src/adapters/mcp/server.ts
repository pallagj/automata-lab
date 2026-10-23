import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { z } from "zod";
import { WORKSHEET_LIMITS as L } from "@automatalab/core/worksheet/document";
import { EXAMPLE_WORKSHEETS, ExampleWorksheet } from "@automatalab/core/worksheet/examples";
import { SAVE_VERSION } from "@automatalab/core/worksheet/migrations";
import { shareIdFrom } from "@automatalab/core/worksheet/shareLink";
import type { SharingUseCases } from "../../application/sharing";

const INSTRUCTIONS = `AutomataLab is a workshop for formal languages and automata: finite automata, pushdown automata, Turing machines, regular expressions and grammars.
A worksheet is a list of cells. A cell either defines something in YAML (a Machine:, a Grammar:, …) or computes with what is defined, e.g. \`D = det(M)\`, \`min(D)\`, \`equal(A, B)\`; a cell starting with # is a note.
Before writing a worksheet, read one or two of the example resources (automatalab://examples/…): they show the notation the app reads.
share_worksheet stores a worksheet and returns a short link that opens it in the app; open_shared_worksheet reads one back from its link.`;

const Link = z.object({ id: z.string(), url: z.string() });

/** One example worksheet as Markdown: its cells in order, each as it is written in the editor. */
export function exampleMarkdown(ex: ExampleWorksheet): string {
  const cells = ex.cells.map((c, i) => `## Cell ${i + 1}\n\n\`\`\`\n${c}\n\`\`\``).join("\n\n");
  return `# ${ex.name}\n\nAn AutomataLab example worksheet of ${ex.cells.length} cells.\n\n${cells}\n`;
}

/** The MCP face of the use cases: tools to share and open worksheets, and the examples to learn the notation from. */
export function createMcpServer(deps: { sharing: SharingUseCases; requester: string }): McpServer {
  const server = new McpServer({ name: "automatalab", title: "AutomataLab", version: "1.0.0" }, { instructions: INSTRUCTIONS });

  server.registerTool(
    "share_worksheet",
    {
      title: "Share a worksheet",
      description:
        "Stores a worksheet and returns a short link (https://automatalab.app/w/…) that opens a copy of it in AutomataLab. The link never changes: later edits are not in it.",
      inputSchema: {
        name: z.string().max(L.name).describe("The worksheet's title"),
        cells: z
          .array(z.string().max(L.source))
          .min(1)
          .max(L.cells)
          .describe("The cells in order, each as it is written in the editor")
      },
      outputSchema: Link.shape,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true }
    },
    async ({ name, cells }) => {
      const worksheet = { version: SAVE_VERSION, name, cells: cells.map((source) => ({ source })) };
      const r = await deps.sharing.share(worksheet, deps.requester);
      if (!r.ok)
        return {
          isError: true,
          content: [
            {
              type: "text",
              text:
                r.error === "rate_limited"
                  ? `Too many worksheets shared; try again in ${r.retryAfterSeconds} s.`
                  : "The worksheet could not be shared."
            }
          ]
        };
      return { content: [{ type: "text", text: r.url }], structuredContent: { id: r.id, url: r.url } };
    }
  );

  server.registerTool(
    "open_shared_worksheet",
    {
      title: "Open a shared worksheet",
      description: "Reads the worksheet behind a share link, its cells as they are written in the editor.",
      inputSchema: {
        link: z.string().max(300).describe("The share link, e.g. https://automatalab.app/w/k3x9pq2mzt, or its last ten characters")
      },
      outputSchema: { ...Link.shape, createdAt: z.string(), name: z.string(), cells: z.array(z.string()) },
      annotations: { readOnlyHint: true, openWorldHint: false }
    },
    async ({ link }) => {
      const id = shareIdFrom(link);
      const r = id ? await deps.sharing.open(id) : null;
      if (!r?.ok) return { isError: true, content: [{ type: "text", text: "No worksheet was shared with this link." }] };
      const { url, createdAt, worksheet } = r.shared;
      const shared = {
        id: r.shared.id,
        url,
        createdAt: createdAt.toISOString(),
        name: worksheet.name,
        cells: worksheet.cells.map((c) => c.source)
      };
      return { content: [{ type: "text", text: JSON.stringify(shared, null, 2) }], structuredContent: shared };
    }
  );

  for (const ex of EXAMPLE_WORKSHEETS) {
    const uri = `automatalab://examples/${ex.key}`;
    server.registerResource(
      `example-${ex.key}`,
      uri,
      { title: ex.name, description: `Example worksheet: ${ex.name}`, mimeType: "text/markdown" },
      async () => ({ contents: [{ uri, mimeType: "text/markdown", text: exampleMarkdown(ex) }] })
    );
  }

  return server;
}

/**
 * The MCP endpoint over Streamable HTTP, stateless: each request gets its own server and
 * transport, so nothing is kept between requests and any number of clients can call it.
 */
export function mcpHandler(deps: { sharing: SharingUseCases }) {
  return async (request: Request, requester: string): Promise<Response> => {
    const server = createMcpServer({ sharing: deps.sharing, requester });
    const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    await server.connect(transport);
    return transport.handleRequest(request);
  };
}
