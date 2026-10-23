import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { SAVE_VERSION } from "@automatalab/core/worksheet/migrations";
import type { Snapshot } from "../../../domain/snapshot";
import { openDatabase } from "./database";
import { sqliteSnapshotRepository } from "./snapshotRepository";

const MIGRATIONS = new URL("../../../../drizzle", import.meta.url).pathname;

const SNAPSHOT: Snapshot = {
  id: "abcdefghij",
  worksheet: {
    version: SAVE_VERSION,
    name: "Házi — ε, δ, ∅",
    cells: [{ source: "Machine:\n  name: M\n  states: q_0", layout: { q_0: { x: -12.5, y: 3e3 } } }, { source: "" }]
  },
  createdAt: new Date("2026-10-23T12:34:56.789Z")
};

const opened: { close(): void }[] = [];
afterEach(() => opened.splice(0).forEach((db) => db.close()));

function repo(file = ":memory:") {
  const db = openDatabase(file, MIGRATIONS);
  opened.push(db);
  return sqliteSnapshotRepository(db);
}

describe("snapshots in SQLite", () => {
  it("come back exactly as they were stored, to the millisecond", async () => {
    const r = repo();
    expect(await r.insert(SNAPSHOT)).toBe(true);
    expect(await r.find("abcdefghij")).toEqual(SNAPSHOT);
  });

  it("are not overwritten: a taken id is refused and the first snapshot stays", async () => {
    const r = repo();
    await r.insert(SNAPSHOT);
    expect(await r.insert({ ...SNAPSHOT, worksheet: { ...SNAPSHOT.worksheet, name: "other" } })).toBe(false);
    expect((await r.find("abcdefghij"))?.worksheet.name).toBe(SNAPSHOT.worksheet.name);
  });

  it("an unknown id finds nothing", async () => {
    expect(await repo().find("zzzzzzzzzz")).toBeNull();
  });

  it("know the room they take: a large worksheet adds about its size, before the log is written back to the file", async () => {
    const dir = mkdtempSync(join(tmpdir(), "automatalab-"));
    try {
      const r = repo(join(dir, "test.db"));
      const before = await r.storedBytes();
      const source = "a".repeat(100_000);
      await r.insert({ ...SNAPSHOT, worksheet: { ...SNAPSHOT.worksheet, cells: [{ source }] } });
      const grown = (await r.storedBytes()) - before;
      // the table's first page was counted already, empty: it takes the start of the worksheet
      expect(grown).toBeGreaterThan(90_000);
      expect(grown).toBeLessThan(110_000);
    } finally {
      opened.splice(0).forEach((db) => db.close());
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("outlive the process: a file reopened keeps them, and its migrations run only once", async () => {
    const dir = mkdtempSync(join(tmpdir(), "automatalab-"));
    try {
      const file = join(dir, "test.db");
      await repo(file).insert(SNAPSHOT);
      opened.splice(0).forEach((db) => db.close());
      expect(await repo(file).find("abcdefghij")).toEqual(SNAPSHOT);
    } finally {
      opened.splice(0).forEach((db) => db.close());
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
