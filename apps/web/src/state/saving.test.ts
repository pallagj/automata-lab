import { describe, expect, it, vi } from "vitest";
import { SAVE_VERSION } from "./migrations";

// the store's i18n wants a browser, and it saves into the window's localStorage
vi.mock("../i18n", () => ({ default: { t: (key: string) => key } }));
const saved = new Map<string, string>();
vi.stubGlobal("window", {
  localStorage: {
    getItem: (key: string) => saved.get(key) ?? null,
    setItem: (key: string, value: string) => void saved.set(key, value),
    removeItem: (key: string) => void saved.delete(key)
  }
});
const { activeWorkspace, exportWorkspaceJSON, readWorksheetFile, useAppStore } = await import("./store");

describe("worksheet files", () => {
  const ws = { id: "w", name: "Házi 1", cells: [{ id: "c", source: "M = det(N)" }], createdAt: 0, updatedAt: 0 };

  it("an exported file reads back as the same worksheet", () => {
    const text = exportWorkspaceJSON(ws);
    expect(JSON.parse(text).version).toBe(SAVE_VERSION);
    expect(readWorksheetFile(text)).toEqual({
      ok: true,
      worksheet: { name: "Házi 1", cells: [{ id: "", source: "M = det(N)" }] }
    });
  });

  it("a file without a version is a version-1 file", () => {
    const r = readWorksheetFile(JSON.stringify({ name: "x", cells: [{ source: "a" }, {}] }));
    expect(r).toEqual({ ok: true, worksheet: { name: "x", cells: [{ id: "", source: "a" }, { id: "", source: "" }] } });
  });

  it("a file of a newer version is refused, not misread", () => {
    expect(readWorksheetFile(JSON.stringify({ version: SAVE_VERSION + 1, name: "x", cells: [] }))).toEqual({
      ok: false,
      reason: "newer"
    });
  });

  it("anything else is not a worksheet", () => {
    for (const text of ["", "{", "null", "[]", '{"name": "x"}', '{"cells": 3}'])
      expect(readWorksheetFile(text), text).toEqual({ ok: false, reason: "invalid" });
  });
});

describe("another tab saving", () => {
  it("its worksheets are taken over; this tab stays on its worksheet and keeps a still-valid undo history", async () => {
    const s = useAppStore.getState();
    s.addWorkspace("mine");
    s.addWorkspace("other");
    const [mine, other] = useAppStore.getState().workspaces.slice(-2);
    useAppStore.getState().setActiveWorkspace(mine.id);
    const mineCell = useAppStore.getState().workspaces.find((w) => w.id === mine.id)!.cells[0].id;
    useAppStore.getState().setActiveCell(mineCell);
    useAppStore.setState({
      history: { [mine.id]: { past: [], future: [] }, [other.id]: { past: [], future: [] } }
    });

    // the other tab, showing "other", changed it and saved
    const stored = JSON.parse(saved.get("automata-lab")!);
    stored.state.workspaces = stored.state.workspaces.map((w: { id: string; updatedAt: number }) =>
      w.id === other.id ? { ...w, cells: [{ id: "x", source: "changed elsewhere" }], updatedAt: w.updatedAt + 1 } : w
    );
    stored.state.activeWorkspaceId = other.id;
    stored.state.activeCellId = "x";
    saved.set("automata-lab", JSON.stringify(stored));
    await useAppStore.persist.rehydrate();

    const after = useAppStore.getState();
    expect(after.workspaces.find((w) => w.id === other.id)!.cells).toEqual([{ id: "x", source: "changed elsewhere" }]);
    expect(after.activeWorkspaceId).toBe(mine.id);
    expect(after.activeCellId).toBe(mineCell);
    expect(Object.keys(after.history)).toEqual([mine.id]);
  });

  it("a worksheet the other tab deleted leaves this tab on the other tab's worksheet", async () => {
    useAppStore.getState().addWorkspace("doomed");
    const doomed = useAppStore.getState().activeWorkspaceId;
    const stored = JSON.parse(saved.get("automata-lab")!);
    stored.state.workspaces = stored.state.workspaces.filter((w: { id: string }) => w.id !== doomed);
    stored.state.activeWorkspaceId = stored.state.workspaces[0].id;
    stored.state.activeCellId = stored.state.workspaces[0].cells[0].id;
    saved.set("automata-lab", JSON.stringify(stored));
    await useAppStore.persist.rehydrate();

    const after = useAppStore.getState();
    expect(after.workspaces.some((w) => w.id === doomed)).toBe(false);
    expect(after.activeWorkspaceId).toBe(stored.state.workspaces[0].id);
    expect(after.activeCellId).toBe(stored.state.workspaces[0].cells[0].id);
  });
});

describe("a worksheet opened from a share link", () => {
  const doc = {
    version: SAVE_VERSION,
    name: "Megosztott",
    cells: [{ source: "Machine:\n  name: M", layout: { q_0: { x: 5, y: 6 } } }, { source: "det(M)" }]
  };

  it("becomes a worksheet of one's own, open, with the positions pinned on its graphs", () => {
    const before = useAppStore.getState().workspaces.length;
    useAppStore.getState().openShared("k3x9pq2mzt", doc);
    const s = useAppStore.getState();
    expect(s.workspaces).toHaveLength(before + 1);
    const ws = s.workspaces.at(-1)!;
    expect(ws).toMatchObject({ name: "Megosztott", sharedFrom: "k3x9pq2mzt" });
    expect(ws.cells.map((c) => c.source)).toEqual(["Machine:\n  name: M", "det(M)"]);
    expect(s.activeWorkspaceId).toBe(ws.id);
    expect(s.activeCellId).toBe(ws.cells[0].id);
    expect(s.layouts[ws.cells[0].id]).toEqual({ q_0: { x: 5, y: 6 } });
    expect(s.layouts[ws.cells[1].id]).toBeUndefined();
    // it is saved like any other worksheet
    expect(JSON.parse(saved.get("automata-lab")!).state.workspaces.at(-1).sharedFrom).toBe("k3x9pq2mzt");
  });

  it("is opened again, not copied again, from the same link — with the edits made since", () => {
    const ws = useAppStore.getState().workspaces.find((w) => w.sharedFrom === "k3x9pq2mzt")!;
    useAppStore.getState().setActiveWorkspace(ws.id);
    useAppStore.getState().setCellSource(ws.cells[1].id, "min(det(M))");
    useAppStore.getState().addWorkspace("elsewhere");
    const count = useAppStore.getState().workspaces.length;

    useAppStore.getState().openShared("k3x9pq2mzt", doc);
    const s = useAppStore.getState();
    expect(s.workspaces).toHaveLength(count);
    expect(s.activeWorkspaceId).toBe(ws.id);
    expect(s.workspaces.find((w) => w.id === ws.id)!.cells[1].source).toBe("min(det(M))");
  });

  it("a copy of it is a worksheet of its own: the link still opens the first", () => {
    const ws = useAppStore.getState().workspaces.find((w) => w.sharedFrom === "k3x9pq2mzt")!;
    useAppStore.getState().duplicateWorkspace(ws.id);
    expect(useAppStore.getState().workspaces.filter((w) => w.sharedFrom === "k3x9pq2mzt")).toHaveLength(1);
  });

  it("an untitled one gets a name", () => {
    useAppStore.getState().openShared("aaaaaaaaaa", { ...doc, name: "  " });
    expect(useAppStore.getState().workspaces.at(-1)!.name).toBe("workspace.sharedName");
  });
});

describe("the link a worksheet was shared by", () => {
  it("is remembered on that worksheet only, and saved", () => {
    useAppStore.getState().addWorkspace("to share");
    const id = useAppStore.getState().activeWorkspaceId;
    useAppStore.getState().rememberShare(id, { id: "k3x9pq2mzt", fingerprint: "abc" });
    const s = useAppStore.getState();
    expect(s.workspaces.find((w) => w.id === id)!.lastShare).toEqual({ id: "k3x9pq2mzt", fingerprint: "abc" });
    expect(s.workspaces.filter((w) => w.lastShare)).toHaveLength(1);
    expect(JSON.parse(saved.get("automata-lab")!).state.workspaces.find((w: { id: string }) => w.id === id).lastShare.id).toBe(
      "k3x9pq2mzt"
    );
  });

  it("does not go with a copy: the copy has not been shared", () => {
    const id = useAppStore.getState().workspaces.find((w) => w.lastShare)!.id;
    useAppStore.getState().duplicateWorkspace(id, true);
    expect(activeWorkspace(useAppStore.getState()).lastShare).toBeUndefined();
  });
});
