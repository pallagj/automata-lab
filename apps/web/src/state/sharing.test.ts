import { describe, expect, it } from "vitest";
import { createApiClient } from "@automatalab/contract/client";
import { SAVE_VERSION } from "@automatalab/core/worksheet/migrations";
import { fetchShared, shareDocument, sharedDocument, sharedIdInPath } from "./sharing";

const WS = {
  name: "Házi 1",
  cells: [
    { id: "c1", source: "Machine:\n  name: M" },
    { id: "c2", source: "D = det(M)" },
    { id: "c3", source: "" }
  ]
};

/** an API whose every answer is `status` with `body`; it records the requests */
function api(status: number, body: unknown) {
  const requests: Request[] = [];
  const client = createApiClient({
    baseUrl: "http://api.test",
    fetch: async (req) => {
      requests.push(req);
      return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
    }
  });
  return { client, requests };
}

const offline = createApiClient({
  baseUrl: "http://api.test",
  fetch: async () => {
    throw new TypeError("Failed to fetch");
  }
});

describe("the shared document of a worksheet", () => {
  it("has its cells in order at the current version, each with its pinned positions", () => {
    const layouts = { c1: { q_0: { x: 1, y: 2 } }, c3: {}, other: { p: { x: 0, y: 0 } } };
    expect(sharedDocument(WS, layouts)).toEqual({
      version: SAVE_VERSION,
      name: "Házi 1",
      cells: [{ source: "Machine:\n  name: M", layout: { q_0: { x: 1, y: 2 } } }, { source: "D = det(M)" }, { source: "" }]
    });
  });
});

describe("sharing", () => {
  const doc = sharedDocument(WS, {});

  it("posts the document and links to this app's own address", async () => {
    const { client, requests } = api(201, { id: "k3x9pq2mzt", url: "https://automatalab.app/w/k3x9pq2mzt" });
    expect(await shareDocument(doc, "http://localhost:4173", client)).toEqual({
      ok: true,
      url: "http://localhost:4173/w/k3x9pq2mzt"
    });
    expect(requests[0].method).toBe("POST");
    expect(new URL(requests[0].url).pathname).toBe("/api/snapshots");
    expect(await requests[0].json()).toEqual(doc);
  });

  it.each([
    [429, "rate_limited"],
    [400, "too_large"],
    [413, "too_large"],
    [422, "newer"],
    [500, "failed"],
    [502, "failed"]
  ] as const)("reads answer %i as %s", async (status, reason) => {
    const { client } = api(status, { error: { code: "x", message: "x" } });
    expect(await shareDocument(doc, "", client)).toEqual({ ok: false, reason });
  });

  it("says so when the server can not be reached", async () => {
    expect(await shareDocument(doc, "", offline)).toEqual({ ok: false, reason: "offline" });
  });
});

describe("opening a shared worksheet", () => {
  const worksheet = { version: SAVE_VERSION, name: "Házi", cells: [{ source: "a", layout: { q: { x: 1, y: 1 } } }] };
  const snapshot = { id: "k3x9pq2mzt", url: "u", createdAt: "2026-10-23T12:00:00.000Z", worksheet };

  it("fetches the worksheet by its id", async () => {
    const { client, requests } = api(200, snapshot);
    expect(await fetchShared("k3x9pq2mzt", client)).toEqual({ ok: true, worksheet });
    expect(new URL(requests[0].url).pathname).toBe("/api/snapshots/k3x9pq2mzt");
  });

  it("refuses one a newer app wrote, rather than misread it", async () => {
    const { client } = api(200, { ...snapshot, worksheet: { ...worksheet, version: SAVE_VERSION + 1 } });
    expect(await fetchShared("k3x9pq2mzt", client)).toEqual({ ok: false, reason: "newer" });
  });

  it.each([
    [404, "not_found"],
    [400, "not_found"],
    [500, "failed"]
  ] as const)("reads answer %i as %s", async (status, reason) => {
    const { client } = api(status, { error: { code: "x", message: "x" } });
    expect(await fetchShared("k3x9pq2mzt", client)).toEqual({ ok: false, reason });
  });

  it("says so when the server can not be reached", async () => {
    expect(await fetchShared("k3x9pq2mzt", offline)).toEqual({ ok: false, reason: "offline" });
  });
});

describe("a page opened from a share link", () => {
  it("is at /w/<id>", () => {
    expect(sharedIdInPath("/w/k3x9pq2mzt")).toBe("k3x9pq2mzt");
    expect(sharedIdInPath("/w/k3x9pq2mzt/")).toBe("k3x9pq2mzt");
  });

  it("is not any other page", () => {
    for (const path of ["/", "/index.html", "/w/", "/w/short", "/x/w/k3x9pq2mzt", "/api/snapshots/k3x9pq2mzt"])
      expect(sharedIdInPath(path), path).toBeNull();
  });
});
