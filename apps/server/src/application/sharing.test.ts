import { describe, expect, it } from "vitest";
import type { WorksheetDocument } from "@automatalab/core/worksheet/document";
import { SAVE_VERSION } from "@automatalab/core/worksheet/migrations";
import { memorySnapshotRepository } from "../adapters/persistence/memory/snapshotRepository";
import { unlimited, windowRateLimiter } from "../adapters/system/rateLimiter";
import { silentLog } from "../adapters/system/system";
import type { Log, RateLimiter, SnapshotRepository } from "./ports";
import { sharingUseCases } from "./sharing";

const WORKSHEET: WorksheetDocument = {
  version: SAVE_VERSION,
  name: "Házi 1",
  cells: [{ source: "Machine:\n  name: M", layout: { q_0: { x: 10, y: 20 } } }, { source: "D = det(M)" }]
};

/** bytes 0, 1, 2, … in order; an id asks for twenty: the ids are "abcdefghij", "uvwxyz0123", … */
function counting() {
  let i = 0;
  return (n: number) => Uint8Array.from({ length: n }, () => i++ % 36);
}

/** the bytes the memory repository counts for WORKSHEET */
const SIZE = Buffer.byteLength(JSON.stringify(WORKSHEET));

function setup(
  over: { snapshots?: SnapshotRepository; rateLimiter?: RateLimiter; storageLimitBytes?: number; log?: Log } = {}
) {
  const snapshots = memorySnapshotRepository();
  const sharing = sharingUseCases({
    snapshots: over.snapshots ?? snapshots,
    rateLimiter: over.rateLimiter ?? unlimited,
    storageLimitBytes: over.storageLimitBytes ?? Infinity,
    log: over.log ?? silentLog,
    clock: { now: () => new Date("2026-10-23T12:00:00Z") },
    randomBytes: counting(),
    publicUrl: "https://automatalab.app"
  });
  return { sharing, snapshots };
}

describe("sharing a worksheet", () => {
  it("stores it as it is and returns its short link", async () => {
    const { sharing, snapshots } = setup();
    expect(await sharing.share(WORKSHEET, "1.2.3.4")).toEqual({
      ok: true,
      id: "abcdefghij",
      url: "https://automatalab.app/w/abcdefghij"
    });
    expect(snapshots.all()).toEqual([
      { id: "abcdefghij", worksheet: WORKSHEET, createdAt: new Date("2026-10-23T12:00:00Z") }
    ]);
  });

  it("gives every share its own link, even of the same worksheet", async () => {
    const { sharing } = setup();
    const a = await sharing.share(WORKSHEET, "x");
    const b = await sharing.share(WORKSHEET, "x");
    expect(a.ok && b.ok && a.id !== b.id).toBe(true);
  });

  it("draws a new id when the first one is taken", async () => {
    const { sharing, snapshots } = setup();
    await snapshots.insert({ id: "abcdefghij", worksheet: WORKSHEET, createdAt: new Date(0) });
    expect(await sharing.share(WORKSHEET, "x")).toMatchObject({ ok: true, id: "uvwxyz0123" });
  });

  it("gives up rather than loop when no id is free", async () => {
    const taken: SnapshotRepository = { insert: async () => false, find: async () => null, storedBytes: async () => 0 };
    await expect(setup({ snapshots: taken }).sharing.share(WORKSHEET, "x")).rejects.toThrow(/no free snapshot id/);
  });

  it("refuses a worksheet of a newer app, before counting it", async () => {
    let counted = 0;
    const counter: RateLimiter = { take: () => (counted++, { ok: true }) };
    const { sharing, snapshots } = setup({ rateLimiter: counter });
    expect(await sharing.share({ ...WORKSHEET, version: SAVE_VERSION + 1 }, "x")).toEqual({
      ok: false,
      error: "newer_version"
    });
    expect(snapshots.all()).toEqual([]);
    expect(counted).toBe(0);
  });

  it("stores an older worksheet as it was written: it is brought up to date when it is opened", async () => {
    const { sharing, snapshots } = setup();
    const old = { ...WORKSHEET, version: 1 };
    await sharing.share(old, "x");
    expect(snapshots.all()[0].worksheet).toEqual(old);
  });

  it("stops a requester over the rate limit, and stores nothing for it", async () => {
    const rateLimiter = windowRateLimiter({
      perKey: { limit: 2, ms: 60_000 },
      total: { limit: 100, ms: 60_000 },
      log: silentLog,
      now: () => 0
    });
    const { sharing, snapshots } = setup({ rateLimiter });
    await sharing.share(WORKSHEET, "1.1.1.1");
    await sharing.share(WORKSHEET, "1.1.1.1");
    expect(await sharing.share(WORKSHEET, "1.1.1.1")).toEqual({ ok: false, error: "rate_limited", retryAfterSeconds: 60 });
    expect(await sharing.share(WORKSHEET, "2.2.2.2")).toMatchObject({ ok: true });
    expect(snapshots.all()).toHaveLength(3);
  });

  it("takes no new snapshot once the storage limit is reached, and the links made still open", async () => {
    const { sharing, snapshots } = setup({ storageLimitBytes: 2 * SIZE });
    expect(await sharing.share(WORKSHEET, "x")).toMatchObject({ ok: true });
    expect(await sharing.share(WORKSHEET, "y")).toMatchObject({ ok: true });
    expect(await snapshots.storedBytes()).toBe(2 * SIZE);
    expect(await sharing.share(WORKSHEET, "z")).toEqual({ ok: false, error: "storage_full" });
    expect(snapshots.all()).toHaveLength(2);
    expect(await sharing.open("abcdefghij")).toMatchObject({ ok: true });
  });

  it("takes one more snapshot just below the limit: the limit is never passed by more than one", async () => {
    const { sharing } = setup({ storageLimitBytes: SIZE + 1 });
    expect(await sharing.share(WORKSHEET, "x")).toMatchObject({ ok: true });
    expect(await sharing.share(WORKSHEET, "x")).toMatchObject({ ok: true });
    expect(await sharing.share(WORKSHEET, "x")).toEqual({ ok: false, error: "storage_full" });
  });

  it("does not measure the storage for a share the rate limit refuses", async () => {
    let measured = 0;
    const snapshots = { ...memorySnapshotRepository(), storedBytes: async () => (measured++, 0) };
    const { sharing } = setup({ snapshots, rateLimiter: { take: () => ({ ok: false, retryAfterSeconds: 1 }) } });
    await sharing.share(WORKSHEET, "x");
    expect(measured).toBe(0);
  });

  it("logs when the storage fills, once however many shares it refuses, and when there is room again", async () => {
    let stored = 0;
    const warnings: string[] = [];
    const snapshots = { ...memorySnapshotRepository(), storedBytes: async () => stored };
    const { sharing } = setup({ snapshots, storageLimitBytes: 1024 ** 3, log: { warn: (m) => warnings.push(m) } });
    await sharing.share(WORKSHEET, "x");
    expect(warnings).toEqual([]);
    stored = 1024 ** 3;
    for (let i = 0; i < 5; i++) await sharing.share(WORKSHEET, "x");
    expect(warnings).toEqual(["storage limit: 1024 MB of 1024 MB stored; no new links are made until room is freed"]);
    stored = 900 * 1024 ** 2;
    expect(await sharing.share(WORKSHEET, "x")).toMatchObject({ ok: true });
    await sharing.share(WORKSHEET, "x");
    expect(warnings.slice(1)).toEqual(["storage limit: 900 MB of 1024 MB stored; new links are made again"]);
  });
});

describe("opening a shared worksheet", () => {
  it("gives back the worksheet, its link and when it was shared", async () => {
    const { sharing } = setup();
    await sharing.share(WORKSHEET, "x");
    expect(await sharing.open("abcdefghij")).toEqual({
      ok: true,
      shared: {
        id: "abcdefghij",
        url: "https://automatalab.app/w/abcdefghij",
        createdAt: new Date("2026-10-23T12:00:00Z"),
        worksheet: WORKSHEET
      }
    });
  });

  it("brings an older worksheet up to the current version", async () => {
    const { sharing } = setup();
    await sharing.share({ ...WORKSHEET, version: 1 }, "x");
    const r = await sharing.open("abcdefghij");
    expect(r.ok && r.shared.worksheet.version).toBe(SAVE_VERSION);
  });

  it("finds nothing under an unknown id, or under something that is not an id", async () => {
    let asked = 0;
    const spy: SnapshotRepository = { insert: async () => true, find: async () => (asked++, null), storedBytes: async () => 0 };
    const { sharing } = setup({ snapshots: spy });
    expect(await sharing.open("zzzzzzzzzz")).toEqual({ ok: false, error: "not_found" });
    for (const bad of ["", "abc", "ABCDEFGHIJ", "abcdefghij'--"])
      expect(await sharing.open(bad), bad).toEqual({ ok: false, error: "not_found" });
    expect(asked).toBe(1);
  });

  it("does not misread a worksheet a newer server stored", async () => {
    const { sharing, snapshots } = setup();
    await snapshots.insert({ id: "abcdefghij", worksheet: { ...WORKSHEET, version: SAVE_VERSION + 1 }, createdAt: new Date(0) });
    expect(await sharing.open("abcdefghij")).toEqual({ ok: false, error: "newer_version" });
  });
});
