import { createRoute, z } from "@hono/zod-openapi";
import { ApiError, Health, SharedLink, Snapshot, SnapshotId, Worksheet } from "./schemas";

const json = <T extends z.ZodType>(schema: T, description: string) => ({
  content: { "application/json": { schema } },
  description
});

export const shareWorksheet = createRoute({
  method: "post",
  path: "/api/snapshots",
  operationId: "shareWorksheet",
  tags: ["Sharing"],
  summary: "Share a worksheet",
  description:
    "Stores an unchangeable copy of the worksheet and returns its short link. Later edits of the original do not reach the link.",
  request: { body: { required: true, ...json(Worksheet, "The worksheet as it is now") } },
  responses: {
    201: json(SharedLink, "The worksheet is stored; anyone with the link can open it"),
    400: json(ApiError, "Not a worksheet, or one over the limits"),
    413: json(ApiError, "The request is too large"),
    422: json(ApiError, "The worksheet was written by a newer version of the app"),
    429: json(ApiError, "Too many worksheets shared from this address; try again later")
  }
});

export const openSnapshot = createRoute({
  method: "get",
  path: "/api/snapshots/{id}",
  operationId: "openSnapshot",
  tags: ["Sharing"],
  summary: "Open a shared worksheet",
  request: { params: z.object({ id: SnapshotId.openapi({ param: { name: "id", in: "path" } }) }) },
  responses: {
    200: json(Snapshot, "The shared worksheet"),
    400: json(ApiError, "Not a share link's id"),
    404: json(ApiError, "No worksheet was shared with this id")
  }
});

export const health = createRoute({
  method: "get",
  path: "/api/health",
  operationId: "health",
  tags: ["Service"],
  summary: "Is the service up",
  responses: { 200: json(Health, "The service answers") }
});

/** Every operation of the API: the server implements exactly these. */
export const ROUTES = [shareWorksheet, openSnapshot, health] as const;
