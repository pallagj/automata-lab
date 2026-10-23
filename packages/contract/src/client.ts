import createClient from "openapi-fetch";
import type { components, paths } from "./generated/api";

/** A typed client of the API, made from the generated OpenAPI types; `baseUrl` "" talks to the page's own origin. */
export function createApiClient(opts: { baseUrl?: string; fetch?: (request: Request) => Promise<Response> } = {}) {
  return createClient<paths>({ baseUrl: opts.baseUrl ?? "", fetch: opts.fetch });
}

export type ApiClient = ReturnType<typeof createApiClient>;
export type Worksheet = components["schemas"]["Worksheet"];
export type SharedLink = components["schemas"]["SharedLink"];
export type Snapshot = components["schemas"]["Snapshot"];
export type ApiError = components["schemas"]["Error"];
