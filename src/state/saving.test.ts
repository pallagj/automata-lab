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
const { exportWorkspaceJSON, readWorksheetFile, useAppStore } = await import("./store");

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
