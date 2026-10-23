import { OpenAPIHono, z } from "@hono/zod-openapi";
import type { Context } from "hono";
import { bodyLimit } from "hono/body-limit";
import { HTTPException } from "hono/http-exception";
import { Scalar } from "@scalar/hono-api-reference";
import { SAVE_VERSION } from "@automatalab/core/worksheet/migrations";
import { openApiDocument } from "@automatalab/contract/document";
import { health, openSnapshot, shareWorksheet } from "@automatalab/contract/routes";
import type { ErrorCode } from "@automatalab/contract/schemas";
import type { SharingUseCases } from "../../application/sharing";

/**
 * A request's body may be this large: a cell at its every limit fits, and a real worksheet many
 * times over (the largest example takes 3 KB). Anything larger is refused unread.
 */
export const MAX_BODY_BYTES = 128 * 1024;

export interface HttpDeps {
  sharing: SharingUseCases;
  /** whom a request comes from, for the rate limit */
  requester: (c: Context) => string;
  /** answers the MCP endpoint (Streamable HTTP); `requester` as above */
  mcp: (request: Request, requester: string) => Promise<Response>;
}

const error = <C extends ErrorCode>(code: C, message: string) => ({ error: { code, message } });

/** The REST API of the contract, its OpenAPI document and reference page, and the MCP endpoint. */
export function createHttpApp(deps: HttpDeps) {
  const app = new OpenAPIHono({
    defaultHook: (result, c) => {
      if (!result.success) return c.json(error("invalid", z.prettifyError(result.error)), 400);
    }
  });

  app.use(
    "*",
    bodyLimit({
      maxSize: MAX_BODY_BYTES,
      onError: (c) => c.json(error("too_large", `The request is larger than ${MAX_BODY_BYTES / 1024} KiB.`), 413)
    })
  );

  app.openapi(shareWorksheet, async (c) => {
    const r = await deps.sharing.share(c.req.valid("json"), deps.requester(c));
    if (r.ok) return c.json({ id: r.id, url: r.url }, 201);
    if (r.error === "newer_version")
      return c.json(error("newer_version", "A newer version of the app wrote this worksheet."), 422);
    if (r.error === "storage_full")
      return c.json(error("storage_full", "No new worksheets can be stored now; the links made still work."), 503);
    c.header("Retry-After", String(r.retryAfterSeconds));
    return c.json(error("rate_limited", `Too many worksheets shared; try again in ${r.retryAfterSeconds} s.`), 429);
  });

  app.openapi(openSnapshot, async (c) => {
    const r = await deps.sharing.open(c.req.valid("param").id);
    if (!r.ok) return c.json(error("not_found", "No worksheet was shared with this id."), 404);
    const { id, url, createdAt, worksheet } = r.shared;
    c.header("Cache-Control", "public, max-age=31536000, immutable");
    return c.json({ id, url, createdAt: createdAt.toISOString(), worksheet }, 200);
  });

  app.openapi(health, (c) => c.json({ ok: true as const, saveVersion: SAVE_VERSION }, 200));

  const document = openApiDocument();
  app.get("/api/openapi.json", (c) => c.json(document));
  app.get("/api/docs", Scalar({ url: "/api/openapi.json", pageTitle: "AutomataLab API" }));

  app.all("/mcp", (c) => deps.mcp(c.req.raw, deps.requester(c)));

  app.notFound((c) => c.json(error("not_found", "There is nothing here."), 404));
  app.onError((err, c) => {
    // a body that is not JSON at all never reaches the schema
    if (err instanceof HTTPException && err.status === 400) return c.json(error("invalid", err.message), 400);
    console.error(err);
    return c.json(error("internal", "Something went wrong on the server."), 500);
  });

  return app;
}
