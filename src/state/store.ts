import { create } from "zustand";
import { persist } from "zustand/middleware";
import { STARTER_CELLS } from "./examples";

/**
 * Offline-first állapot: minden munkalap a localStorage-ban él,
 * bejelentkezés és hálózat nélkül.
 */

export interface Cell {
  id: string;
  source: string;
}

export interface Workspace {
  id: string;
  name: string;
  cells: Cell[];
  createdAt: number;
  updatedAt: number;
}

export type Theme = "dark" | "light";
export type MobileTab = "code" | "view";

interface AppState {
  workspaces: Workspace[];
  activeWorkspaceId: string;
  activeCellId: string | null;
  theme: Theme;
  mobileTab: MobileTab;

  setTheme: (t: Theme) => void;
  setMobileTab: (t: MobileTab) => void;
  setActiveWorkspace: (id: string) => void;
  setActiveCell: (id: string | null) => void;

  addWorkspace: (name?: string) => void;
  renameWorkspace: (id: string, name: string) => void;
  deleteWorkspace: (id: string) => void;
  importWorkspace: (ws: Workspace) => void;

  setCellSource: (cellId: string, source: string) => void;
  addCell: (source?: string, afterCellId?: string | null) => void;
  removeCell: (cellId: string) => void;
  moveCell: (cellId: string, dir: -1 | 1) => void;
}

let counter = 0;
export function uid(): string {
  counter++;
  return `${Date.now().toString(36)}-${counter}-${Math.random().toString(36).slice(2, 7)}`;
}

function newWorkspace(name: string, sources: string[] = [""]): Workspace {
  return {
    id: uid(),
    name,
    cells: sources.map((source) => ({ id: uid(), source })),
    createdAt: Date.now(),
    updatedAt: Date.now()
  };
}

const starter = newWorkspace("Bemutató munkalap", STARTER_CELLS);

export const useAppStore = create<AppState>()(
  persist(
    (set, get) => ({
      workspaces: [starter],
      activeWorkspaceId: starter.id,
      activeCellId: starter.cells[0].id,
      theme: (typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-color-scheme: light)").matches
        ? "light"
        : "dark") as Theme,
      mobileTab: "code",

      setTheme: (theme) => set({ theme }),
      setMobileTab: (mobileTab) => set({ mobileTab }),
      setActiveWorkspace: (id) => {
        const ws = get().workspaces.find((w) => w.id === id);
        set({ activeWorkspaceId: id, activeCellId: ws?.cells[0]?.id ?? null });
      },
      setActiveCell: (id) => set({ activeCellId: id }),

      addWorkspace: (name) => {
        const ws = newWorkspace(name ?? `Munkalap ${get().workspaces.length + 1}`);
        set((s) => ({
          workspaces: [...s.workspaces, ws],
          activeWorkspaceId: ws.id,
          activeCellId: ws.cells[0].id
        }));
      },
      renameWorkspace: (id, name) =>
        set((s) => ({
          workspaces: s.workspaces.map((w) => (w.id === id ? { ...w, name, updatedAt: Date.now() } : w))
        })),
      deleteWorkspace: (id) => {
        const rest = get().workspaces.filter((w) => w.id !== id);
        const list = rest.length > 0 ? rest : [newWorkspace("Munkalap 1")];
        set({
          workspaces: list,
          activeWorkspaceId: list[0].id,
          activeCellId: list[0].cells[0]?.id ?? null
        });
      },
      importWorkspace: (ws) => {
        const safe: Workspace = {
          id: uid(),
          name: ws.name || "Importált munkalap",
          cells: (ws.cells ?? []).map((c) => ({ id: uid(), source: String(c.source ?? "") })),
          createdAt: Date.now(),
          updatedAt: Date.now()
        };
        if (safe.cells.length === 0) safe.cells.push({ id: uid(), source: "" });
        set((s) => ({
          workspaces: [...s.workspaces, safe],
          activeWorkspaceId: safe.id,
          activeCellId: safe.cells[0].id
        }));
      },

      setCellSource: (cellId, source) =>
        set((s) => ({
          workspaces: s.workspaces.map((w) =>
            w.id !== s.activeWorkspaceId
              ? w
              : {
                  ...w,
                  updatedAt: Date.now(),
                  cells: w.cells.map((c) => (c.id === cellId ? { ...c, source } : c))
                }
          )
        })),
      addCell: (source = "", afterCellId = null) => {
        const cell: Cell = { id: uid(), source };
        set((s) => ({
          activeCellId: cell.id,
          mobileTab: "code",
          workspaces: s.workspaces.map((w) => {
            if (w.id !== s.activeWorkspaceId) return w;
            const cells = [...w.cells];
            const at = afterCellId ? cells.findIndex((c) => c.id === afterCellId) : -1;
            if (at >= 0) cells.splice(at + 1, 0, cell);
            else cells.push(cell);
            return { ...w, cells, updatedAt: Date.now() };
          })
        }));
      },
      removeCell: (cellId) =>
        set((s) => ({
          workspaces: s.workspaces.map((w) => {
            if (w.id !== s.activeWorkspaceId) return w;
            let cells = w.cells.filter((c) => c.id !== cellId);
            if (cells.length === 0) cells = [{ id: uid(), source: "" }];
            return { ...w, cells, updatedAt: Date.now() };
          }),
          activeCellId:
            s.activeCellId === cellId
              ? (s.workspaces
                  .find((w) => w.id === s.activeWorkspaceId)
                  ?.cells.filter((c) => c.id !== cellId)[0]?.id ?? null)
              : s.activeCellId
        })),
      moveCell: (cellId, dir) =>
        set((s) => ({
          workspaces: s.workspaces.map((w) => {
            if (w.id !== s.activeWorkspaceId) return w;
            const cells = [...w.cells];
            const i = cells.findIndex((c) => c.id === cellId);
            const j = i + dir;
            if (i < 0 || j < 0 || j >= cells.length) return w;
            [cells[i], cells[j]] = [cells[j], cells[i]];
            return { ...w, cells, updatedAt: Date.now() };
          })
        }))
    }),
    {
      name: "automata-lab",
      version: 1
    }
  )
);

export function activeWorkspace(s: AppState): Workspace {
  return s.workspaces.find((w) => w.id === s.activeWorkspaceId) ?? s.workspaces[0];
}

export function exportWorkspaceJSON(ws: Workspace): string {
  return JSON.stringify(
    { app: "automata-lab", version: 1, name: ws.name, cells: ws.cells.map((c) => ({ source: c.source })) },
    null,
    2
  );
}
