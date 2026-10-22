import { describe, expect, it } from "vitest";
import { guardedStorage, Migration, migrateSource, migrateState, newerVersionSaved, SAVE_VERSION, storedVersion } from "./migrations";

/** a pretend history: version 1 named the function "determinize", version 2 renamed a field */
const HISTORY: Record<number, Migration> = {
  1: { source: (s) => s.replaceAll("determinize(", "det(") },
  2: {
    state: ({ panelWidth, ...rest }) => (panelWidth === undefined ? rest : { ...rest, paneWidth: panelWidth })
  }
};

const saved = () => ({
  workspaces: [
    { id: "w1", name: "A", cells: [{ id: "c1", source: "D = determinize(M)" }, { id: "c2", source: "M = …" }] },
    { id: "w2", name: "B", cells: [{ id: "c3", source: "min(determinize(N))" }] }
  ],
  activeWorkspaceId: "w1",
  panelWidth: 500
});

class MemoryStorage implements Storage {
  private m = new Map<string, string>();
  get length() {
    return this.m.size;
  }
  clear() {
    this.m.clear();
  }
  getItem(k: string) {
    return this.m.get(k) ?? null;
  }
  key(i: number) {
    return [...this.m.keys()][i] ?? null;
  }
  removeItem(k: string) {
    this.m.delete(k);
  }
  setItem(k: string, v: string) {
    this.m.set(k, v);
  }
}

describe("saved-data migrations", () => {
  it("the current version needs no step", () => {
    expect(SAVE_VERSION).toBeGreaterThanOrEqual(1);
    const s = saved();
    expect(migrateState(s, SAVE_VERSION)).toBe(s);
    expect(migrateSource("det(M)", SAVE_VERSION)).toBe("det(M)");
  });

  it("every step up to the current version exists", async () => {
    const { MIGRATIONS } = await import("./migrations");
    for (let v = 1; v < SAVE_VERSION; v++) expect(MIGRATIONS[v], `step ${v} → ${v + 1}`).toBeDefined();
  });

  it("rewrites every cell of every worksheet, then the rest of the state, step by step", () => {
    const out = migrateState(saved(), 1, HISTORY, 3) as ReturnType<typeof saved> & { paneWidth?: number };
    expect(out.workspaces.map((w) => w.cells.map((c) => c.source))).toEqual([
      ["D = det(M)", "M = …"],
      ["min(det(N))"]
    ]);
    expect(out.paneWidth).toBe(500);
    expect(out).not.toHaveProperty("panelWidth");
    // nothing else is touched: ids, names, the active worksheet
    expect(out.workspaces.map((w) => [w.id, w.name, w.cells.map((c) => c.id)])).toEqual([
      ["w1", "A", ["c1", "c2"]],
      ["w2", "B", ["c3"]]
    ]);
    expect(out.activeWorkspaceId).toBe("w1");
  });

  it("starts from the version the data was saved at", () => {
    const out = migrateState(saved(), 2, HISTORY, 3) as ReturnType<typeof saved>;
    // step 1 is skipped: the sources stay as they are
    expect(out.workspaces[0].cells[0].source).toBe("D = determinize(M)");
    expect(migrateSource("determinize(M)", 2, HISTORY, 3)).toBe("determinize(M)");
    expect(migrateSource("determinize(M)", 1, HISTORY, 3)).toBe("det(M)");
  });

  it("applying a step twice changes nothing more (data may meet it again)", () => {
    const once = migrateState(saved(), 1, HISTORY, 3);
    expect(migrateState(once, 1, HISTORY, 3)).toEqual(once);
  });

  it("does not mutate the stored object", () => {
    const s = saved();
    migrateState(s, 1, HISTORY, 3);
    expect(s).toEqual(saved());
  });

  it("keeps a state saved by a newer version exactly as it is", () => {
    const s = saved();
    expect(migrateState(s, 7, HISTORY, 3)).toBe(s);
  });

  it("survives odd stored data", () => {
    expect(migrateState(null, 1, HISTORY, 3)).toBeNull();
    expect(migrateState({ workspaces: [{ id: "w" }] }, 1, HISTORY, 3)).toEqual({ workspaces: [{ id: "w", cells: [] }] });
    const odd = { workspaces: [{ cells: [{ source: 42 }] }] };
    expect(migrateState(odd, 1, HISTORY, 3)).toEqual(odd);
  });
});

describe("the stored version", () => {
  it("is read from zustand's saved value", () => {
    expect(storedVersion(JSON.stringify({ state: { a: { version: 9 } }, version: 3 }))).toBe(3);
    expect(storedVersion(null)).toBeNull();
    expect(storedVersion("garbage")).toBeNull();
  });

  it("an outdated page never overwrites what a newer version saved", () => {
    const mem = new MemoryStorage();
    const storage = guardedStorage(mem);
    storage.setItem("k", JSON.stringify({ state: { n: 1 }, version: SAVE_VERSION }));
    expect(storedVersion(mem.getItem("k"))).toBe(SAVE_VERSION);
    expect(newerVersionSaved()).toBe(false);

    const newer = JSON.stringify({ state: { n: 2 }, version: SAVE_VERSION + 1 });
    mem.setItem("k", newer);
    storage.setItem("k", JSON.stringify({ state: { n: 3 }, version: SAVE_VERSION }));
    expect(mem.getItem("k")).toBe(newer);
    expect(newerVersionSaved()).toBe(true);
  });
});
