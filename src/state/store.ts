import { create } from "zustand";
import { persist } from "zustand/middleware";
import i18n from "../i18n";
import { STARTER_CELLS } from "./examples";

/**
 * Offline-first state: every worksheet lives in localStorage,
 * with no sign-in and no network.
 */

export interface Cell {
  id: string;
  source: string;
}

export interface Workspace {
  id: string;
  name: string;
  /** top-level folder name in the worksheet picker (empty/undefined = no folder) */
  folder?: string;
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
  /** width of the left cell panel in px */
  paneWidth: number;
  /** manually pinned graph positions: cellId → state name → coordinate */
  layouts: Record<string, Record<string, { x: number; y: number }>>;
  /** "don't warn me again" for edits that change the machine kind */
  hideKindChangeWarning: boolean;

  setHideKindChangeWarning: (v: boolean) => void;
  setTheme: (t: Theme) => void;
  setPaneWidth: (w: number) => void;
  setNodePos: (cellId: string, node: string, x: number, y: number) => void;
  setMobileTab: (t: MobileTab) => void;
  setActiveWorkspace: (id: string) => void;
  setActiveCell: (id: string | null) => void;

  addWorkspace: (name?: string) => void;
  renameWorkspace: (id: string, name: string) => void;
  setWorkspaceFolder: (id: string, folder: string) => void;
  deleteWorkspace: (id: string) => void;
  importWorkspace: (ws: Workspace) => void;

  setCellSource: (cellId: string, source: string) => void;
  addCell: (source?: string, afterCellId?: string | null) => void;
  removeCell: (cellId: string) => void;
  moveCellTo: (cellId: string, toIndex: number) => void;
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

const starter = newWorkspace(i18n.t("workspace.starterName", { ns: "ui" }), STARTER_CELLS);

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
      paneWidth: 420,
      layouts: {},
      hideKindChangeWarning: false,

      setHideKindChangeWarning: (hideKindChangeWarning) => set({ hideKindChangeWarning }),
      setTheme: (theme) => set({ theme }),
      setPaneWidth: (paneWidth) => set({ paneWidth }),
      setNodePos: (cellId, node, x, y) =>
        set((s) => ({
          layouts: {
            ...s.layouts,
            [cellId]: { ...(s.layouts[cellId] ?? {}), [node]: { x, y } }
          }
        })),
      setMobileTab: (mobileTab) => set({ mobileTab }),
      setActiveWorkspace: (id) => {
        const ws = get().workspaces.find((w) => w.id === id);
        set({ activeWorkspaceId: id, activeCellId: ws?.cells[0]?.id ?? null });
      },
      setActiveCell: (id) => set({ activeCellId: id }),

      addWorkspace: (name) => {
        const ws = newWorkspace(
          name ?? i18n.t("workspace.defaultName", { ns: "ui", index: get().workspaces.length + 1 })
        );
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
      setWorkspaceFolder: (id, folder) =>
        set((s) => ({
          workspaces: s.workspaces.map((w) =>
            w.id === id ? { ...w, folder: folder.trim() || undefined, updatedAt: Date.now() } : w
          )
        })),
      deleteWorkspace: (id) => {
        const rest = get().workspaces.filter((w) => w.id !== id);
        const list = rest.length > 0 ? rest : [newWorkspace(i18n.t("workspace.defaultName", { ns: "ui", index: 1 }))];
        set({
          workspaces: list,
          activeWorkspaceId: list[0].id,
          activeCellId: list[0].cells[0]?.id ?? null
        });
      },
      importWorkspace: (ws) => {
        const safe: Workspace = {
          id: uid(),
          name: ws.name || i18n.t("workspace.importedName", { ns: "ui" }),
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
        set((s) => {
          const ws = s.workspaces.find((w) => w.id === s.activeWorkspaceId);
          if (!ws) return {};
          const idx = ws.cells.findIndex((c) => c.id === cellId);
          let cells = ws.cells.filter((c) => c.id !== cellId);
          if (cells.length === 0) cells = [{ id: uid(), source: "" }];
          // there is always an active cell: the one taking the deleted cell's place (or the last one)
          const activeCellId =
            s.activeCellId === cellId || s.activeCellId === null
              ? cells[Math.min(Math.max(idx, 0), cells.length - 1)].id
              : s.activeCellId;
          return {
            layouts: Object.fromEntries(Object.entries(s.layouts).filter(([k]) => k !== cellId)),
            workspaces: s.workspaces.map((w) =>
              w.id === s.activeWorkspaceId ? { ...w, cells, updatedAt: Date.now() } : w
            ),
            activeCellId
          };
        }),
      moveCellTo: (cellId, toIndex) =>
        set((s) => ({
          workspaces: s.workspaces.map((w) => {
            if (w.id !== s.activeWorkspaceId) return w;
            const cells = [...w.cells];
            const i = cells.findIndex((c) => c.id === cellId);
            if (i < 0) return w;
            const [moved] = cells.splice(i, 1);
            const j = Math.max(0, Math.min(cells.length, toIndex > i ? toIndex - 1 : toIndex));
            cells.splice(j, 0, moved);
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
