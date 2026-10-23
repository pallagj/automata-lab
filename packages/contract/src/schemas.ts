import { z } from "@hono/zod-openapi";
import { WORKSHEET_LIMITS as L } from "@automatalab/core/worksheet/document";
import { SAVE_VERSION } from "@automatalab/core/worksheet/migrations";
import { SHARE_ID_PATTERN } from "@automatalab/core/worksheet/shareLink";

/** The API's data, written once: the OpenAPI document and the typed client are generated from these. */

export const SnapshotId = z
  .string()
  .regex(SHARE_ID_PATTERN)
  .openapi({ description: "Ten letters and digits: the end of a share link.", example: "k3x9pq2mzt" });

const Point = z.object({ x: z.number(), y: z.number() });

export const WorksheetCell = z
  .object({
    source: z.string().max(L.source).openapi({ description: "The cell as it is written in the editor." }),
    layout: z
      .record(z.string().max(L.layoutKey), Point)
      .refine((r) => Object.keys(r).length <= L.layoutNodes, `at most ${L.layoutNodes} positions`)
      .optional()
      .openapi({ description: "The graph positions pinned by hand: state name → coordinate." })
  })
  .openapi("WorksheetCell");

export const Worksheet = z
  .object({
    version: z.number().int().min(1).openapi({
      description: "The save version the worksheet was written at; an older one is brought up to date when it is read.",
      example: SAVE_VERSION
    }),
    name: z.string().max(L.name),
    cells: z.array(WorksheetCell).min(1).max(L.cells)
  })
  .openapi("Worksheet");

export const SharedLink = z
  .object({
    id: SnapshotId,
    url: z.url().openapi({ example: "https://automatalab.app/w/k3x9pq2mzt" })
  })
  .openapi("SharedLink");

export const Snapshot = z
  .object({
    id: SnapshotId,
    url: z.url(),
    createdAt: z.iso.datetime(),
    worksheet: Worksheet.openapi({ description: "Brought up to the current save version." })
  })
  .openapi("Snapshot");

export const ERROR_CODES = [
  "invalid",
  "too_large",
  "newer_version",
  "not_found",
  "rate_limited",
  "storage_full",
  "internal"
] as const;

export const ApiError = z
  .object({
    error: z.object({
      code: z.enum(ERROR_CODES),
      message: z.string()
    })
  })
  .openapi("Error");

export const Health = z
  .object({ ok: z.literal(true), saveVersion: z.number().int() })
  .openapi("Health");

export type WorksheetBody = z.infer<typeof Worksheet>;
export type ErrorCode = (typeof ERROR_CODES)[number];
