import { ApiClient, createApiClient } from "@automatalab/contract/client";
import type { WorksheetDocument } from "@automatalab/core/worksheet/document";
import { SAVE_VERSION } from "@automatalab/core/worksheet/migrations";
import { shareIdFrom, sharePath } from "@automatalab/core/worksheet/shareLink";
import type { Layouts, Workspace } from "./store";

/**
 * Sharing a worksheet by a short link (/w/<id>) through the API, and opening one: the
 * only part of the app that needs the network.
 */

const defaultApi = createApiClient();

/** The worksheet as it is shared: its cells, each with the graph positions pinned on it. */
export function sharedDocument(ws: Pick<Workspace, "name" | "cells">, layouts: Layouts): WorksheetDocument {
  return {
    version: SAVE_VERSION,
    name: ws.name,
    cells: ws.cells.map((c) => {
      const layout = layouts[c.id];
      return layout && Object.keys(layout).length > 0 ? { source: c.source, layout } : { source: c.source };
    })
  };
}

export type ShareOutcome =
  | { ok: true; url: string }
  | { ok: false; reason: "offline" | "rate_limited" | "too_large" | "newer" | "failed" };

/** Stores the worksheet on the server; the link points to this app, wherever it runs. */
export async function shareDocument(
  doc: WorksheetDocument,
  origin: string,
  api: ApiClient = defaultApi
): Promise<ShareOutcome> {
  let res;
  try {
    res = await api.POST("/api/snapshots", { body: doc });
  } catch {
    return { ok: false, reason: "offline" };
  }
  if (res.data) return { ok: true, url: origin + sharePath(res.data.id) };
  switch (res.response.status) {
    case 429:
      return { ok: false, reason: "rate_limited" };
    // the app writes only well-formed worksheets: refused, it is over the limits
    case 400:
    case 413:
      return { ok: false, reason: "too_large" };
    case 422:
      return { ok: false, reason: "newer" };
    default:
      return { ok: false, reason: "failed" };
  }
}

export type OpenOutcome =
  | { ok: true; worksheet: WorksheetDocument }
  | { ok: false; reason: "not_found" | "newer" | "offline" | "failed" };

export async function fetchShared(id: string, api: ApiClient = defaultApi): Promise<OpenOutcome> {
  let res;
  try {
    res = await api.GET("/api/snapshots/{id}", { params: { path: { id } } });
  } catch {
    return { ok: false, reason: "offline" };
  }
  if (res.data) {
    // the server brings it up to its version; a newer server than this page means a newer app
    if (res.data.worksheet.version > SAVE_VERSION) return { ok: false, reason: "newer" };
    return { ok: true, worksheet: res.data.worksheet };
  }
  return { ok: false, reason: res.response.status === 404 || res.response.status === 400 ? "not_found" : "failed" };
}

/** The share id when the page was opened from a share link (/w/<id>); null otherwise. */
export function sharedIdInPath(pathname: string): string | null {
  return pathname.startsWith("/w/") ? shareIdFrom(pathname) : null;
}
