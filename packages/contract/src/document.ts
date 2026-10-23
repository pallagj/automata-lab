import { OpenAPIHono } from "@hono/zod-openapi";
import { ROUTES } from "./routes";

export const OPENAPI_INFO: Parameters<OpenAPIHono["getOpenAPI31Document"]>[0] = {
  openapi: "3.1.0",
  info: {
    title: "AutomataLab API",
    version: "1.0.0",
    description:
      "Shares AutomataLab worksheets by short links. The same operations are offered to AI assistants over MCP at /mcp."
  },
  servers: [{ url: "https://automatalab.app" }]
};

/** The OpenAPI document of the contract, built from the routes alone. */
export function openApiDocument() {
  const app = new OpenAPIHono();
  for (const route of ROUTES) app.openAPIRegistry.registerPath(route);
  return app.getOpenAPI31Document(OPENAPI_INFO);
}
