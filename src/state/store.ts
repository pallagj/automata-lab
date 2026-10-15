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
export type BrowserView = "grid" | "list";
export type BrowserSortKey = "updated" | "created" | "name";
export interface BrowserSort {
  key: BrowserSortKey;
  asc: boolean;
}

/** The part of the state that worksheet-browser actions change — restored by undo. */
export interface LibrarySnapshot {
  workspaces: Workspace[];
  folders: string[];
  activeWorkspaceId: string;
  activeCellId: string | null;
}

export interface AppState {
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
  /** explicitly created folders (so a folder can exist while empty) */
  folders: string[];
  browserView: BrowserView;
  browserSort: BrowserSort;

  setHideKindChangeWarning: (v: boolean) => void;
  setTheme: (t: Theme) => void;
  setPaneWidth: (w: number) => void;
  setNodePos: (cellId: string, node: string, x: number, y: number) => void;
  setMobileTab: (t: MobileTab) => void;
  setActiveWorkspace: (id: string) => void;
  setActiveCell: (id: string | null) => void;
  setBrowserView: (v: BrowserView) => void;
  setBrowserSort: (s: BrowserSort) => void;
  restoreSnapshot: (snap: LibrarySnapshot) => void;

  addWorkspace: (name?: string, folder?: string) => void;
  renameWorkspace: (id: string, name: string) => void;
  /** copies a worksheet next to the original; `open` switches to the copy */
  duplicateWorkspace: (id: string, open?: boolean) => void;
  deleteWorkspaces: (ids: string[]) => void;
  importWorkspace: (ws: Workspace, folder?: string) => void;
  /** moves worksheets into a folder (created if new); undefined = out of any folder */
  moveWorkspaces: (ids: string[], folder: string | undefined) => void;
  createFolder: (name: string) => void;
  renameFolder: (from: string, to: string) => void;
  /** deletes the folder; its worksheets move out of it, they are not deleted */
  deleteFolder: (name: string) => void;

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

function newWorkspace(name: string, sources: string[] = [""], folder?: string): Workspace {
  return {
    id: uid(),
    name,
    folder,
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
      folders: [],
      browserView: "grid",
      browserSort: { key: "updated", asc: false },

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
      setBrowserView: (browserView) => set({ browserView }),
      setBrowserSort: (browserSort) => set({ browserSort }),
      restoreSnapshot: (snap) => set({ ...snap }),

      addWorkspace: (name, folder) => {
        const ws = newWorkspace(
          name ?? i18n.t("workspace.defaultName", { ns: "ui", index: get().workspaces.length + 1 }),
          [""],
          cleanFolder(folder)
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
      duplicateWorkspace: (id, open = false) => {
        const src = get().workspaces.find((w) => w.id === id);
        if (!src) return;
        const copy = newWorkspace(
          i18n.t("workspace.copyName", { ns: "ui", name: src.name }),
          src.cells.map((c) => c.source),
          src.folder
        );
        set((s) => {
          // pinned graph positions are keyed by cell id, so they are copied over too
          const layouts = { ...s.layouts };
          src.cells.forEach((c, i) => {
            if (s.layouts[c.id]) layouts[copy.cells[i].id] = s.layouts[c.id];
          });
          const at = s.workspaces.findIndex((w) => w.id === id);
          const workspaces = [...s.workspaces];
          workspaces.splice(at + 1, 0, copy);
          return open
            ? { workspaces, layouts, activeWorkspaceId: copy.id, activeCellId: copy.cells[0]?.id ?? null }
            : { workspaces, layouts };
        });
      },
      deleteWorkspaces: (ids) => {
        const s = get();
        const rest = s.workspaces.filter((w) => !ids.includes(w.id));
        const list = rest.length > 0 ? rest : [newWorkspace(i18n.t("workspace.defaultName", { ns: "ui", index: 1 }))];
        const keepActive = list.some((w) => w.id === s.activeWorkspaceId);
        set({
          workspaces: list,
          ...(keepActive ? {} : { activeWorkspaceId: list[0].id, activeCellId: list[0].cells[0]?.id ?? null })
        });
      },
      moveWorkspaces: (ids, folder) => {
        const target = cleanFolder(folder);
        set((s) => ({
          folders: target && !s.folders.includes(target) ? [...s.folders, target] : s.folders,
          workspaces: s.workspaces.map((w) => (ids.includes(w.id) ? { ...w, folder: target } : w))
        }));
      },
      createFolder: (name) => {
        const folder = cleanFolder(name);
        if (folder) set((s) => (s.folders.includes(folder) ? {} : { folders: [...s.folders, folder] }));
      },
      renameFolder: (from, to) => {
        const target = cleanFolder(to);
        if (!target || target === from) return;
        set((s) => ({
          folders: [...new Set(s.folders.map((f) => (f === from ? target : f)).concat(target))],
          workspaces: s.workspaces.map((w) => (w.folder === from ? { ...w, folder: target } : w))
        }));
      },
      deleteFolder: (name) =>
        set((s) => ({
          folders: s.folders.filter((f) => f !== name),
          workspaces: s.workspaces.map((w) => (w.folder === name ? { ...w, folder: undefined } : w))
        })),
      importWorkspace: (ws, folder) => {
        const safe: Workspace = {
          id: uid(),
          name: ws.name || i18n.t("workspace.importedName", { ns: "ui" }),
          folder: cleanFolder(folder),
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

function cleanFolder(folder: string | undefined): string | undefined {
  return folder?.trim() || undefined;
}

/** Every folder: the explicitly created ones plus any a worksheet refers to, sorted by name. */
export function allFolders(s: Pick<AppState, "folders" | "workspaces">): string[] {
  const set = new Set(s.folders);
  for (const w of s.workspaces) if (w.folder) set.add(w.folder);
  return [...set].sort((a, b) => a.localeCompare(b));
}

export function librarySnapshot(s: AppState): LibrarySnapshot {
  return {
    workspaces: s.workspaces,
    folders: s.folders,
    activeWorkspaceId: s.activeWorkspaceId,
    activeCellId: s.activeCellId
  };
}

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
