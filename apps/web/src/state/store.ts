import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import i18n from "../i18n";
import { STARTER_CELLS } from "@automatalab/core/worksheet/examples";
import { cellName, uniqueName, usedNames, withName } from "./names";
import {
  CellHistory,
  CellsSnapshot,
  createActionGate,
  EMPTY_HISTORY,
  redoStep,
  remember,
  restoredLayouts,
  undoStep
} from "./history";
import { guardedStorage, markNewerVersionSaved, migrateSource, migrateState, SAVE_VERSION } from "./migrations";
import type { WorksheetDocument } from "@automatalab/core/worksheet/document";

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
  /** the share link's id this worksheet was opened from: the link opens it again, not a second copy */
  sharedFrom?: string;
  /** the last link this worksheet was shared by, and a fingerprint of what it held then */
  lastShare?: { id: string; fingerprint: string };
}

/** manually pinned graph positions: cellId → state name → coordinate */
export type Layouts = Record<string, Record<string, { x: number; y: number }>>;

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

export type DefinitionView = "form" | "code";
export type FormLabels = "symbols" | "words";

export interface AppState {
  workspaces: Workspace[];
  activeWorkspaceId: string;
  activeCellId: string | null;
  theme: Theme;
  mobileTab: MobileTab;
  /** width of the left cell panel in px */
  paneWidth: number;
  layouts: Layouts;
  /** "don't warn me again" for edits that change the machine kind */
  hideKindChangeWarning: boolean;
  /** how definitions open: the form, or their YAML code (each cell can still switch) */
  definitionView: DefinitionView;
  /** the form's labels: the lecture notes' symbols (Σ, Q, q₀, F, δ) or words */
  formLabels: FormLabels;
  /** explicitly created folders (so a folder can exist while empty) */
  folders: string[];
  browserView: BrowserView;
  browserSort: BrowserSort;
  /** each worksheet's undo history (by worksheet id) — not saved */
  history: Record<string, CellHistory>;

  setHideKindChangeWarning: (v: boolean) => void;
  setDefinitionView: (v: DefinitionView) => void;
  setFormLabels: (v: FormLabels) => void;
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
  importWorkspace: (ws: Pick<Workspace, "name" | "cells">, folder?: string) => void;
  /** opens a worksheet from share link `id`: a copy with its pinned graph positions, made the first time only */
  openShared: (id: string, doc: WorksheetDocument) => void;
  /** remembers the link a worksheet was just shared by, so an unchanged worksheet is not shared twice */
  rememberShare: (workspaceId: string, share: { id: string; fingerprint: string }) => void;
  /** moves worksheets into a folder (created if new); undefined = out of any folder */
  moveWorkspaces: (ids: string[], folder: string | undefined) => void;
  createFolder: (name: string) => void;
  renameFolder: (from: string, to: string) => void;
  /** deletes the folder; its worksheets move out of it, they are not deleted */
  deleteFolder: (name: string) => void;

  setCellSource: (cellId: string, source: string) => void;
  /** the cell's name — an unnamed cell is given the first free `base`, `base2`, … first */
  ensureCellName: (cellId: string, base: string) => string;
  addCell: (source?: string, afterCellId?: string | null) => void;
  removeCell: (cellId: string) => void;
  moveCellTo: (cellId: string, toIndex: number) => void;
  /** steps back (or forward again) through the active worksheet's cell edits */
  undo: () => void;
  redo: () => void;
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

const sameAction = createActionGate();

function snapshotOf(s: AppState, ws: Workspace): CellsSnapshot {
  return { cells: ws.cells, activeCellId: s.activeCellId, layouts: s.layouts };
}

/** The histories with the active worksheet's cells remembered before an edit; `typingIn` for typing in one cell. */
function remembered(s: AppState, typingIn?: string): Record<string, CellHistory> {
  const ws = activeWorkspace(s);
  const edit = { at: Date.now(), sameAction: sameAction(), typingIn };
  return { ...s.history, [ws.id]: remember(s.history[ws.id] ?? EMPTY_HISTORY, snapshotOf(s, ws), edit) };
}

/** Undo or redo on the active worksheet: its cells as they were, and the history after the step. */
function travel(s: AppState, step: typeof undoStep): Partial<AppState> {
  const ws = activeWorkspace(s);
  const done = step(s.history[ws.id] ?? EMPTY_HISTORY, snapshotOf(s, ws));
  if (!done) return {};
  return {
    workspaces: s.workspaces.map((w) => (w.id === ws.id ? { ...w, cells: done.to.cells, updatedAt: Date.now() } : w)),
    activeCellId: done.to.activeCellId,
    layouts: restoredLayouts(s.layouts, done.to),
    history: { ...s.history, [ws.id]: done.history }
  };
}

export function canUndo(s: AppState): boolean {
  return (s.history[s.activeWorkspaceId]?.past.length ?? 0) > 0;
}

export function canRedo(s: AppState): boolean {
  return (s.history[s.activeWorkspaceId]?.future.length ?? 0) > 0;
}

const starter = newWorkspace(i18n.t("workspace.starterName", { ns: "ui" }), STARTER_CELLS);

const STORE_KEY = "automata-lab";
/** set once the saved state is first loaded: a later load is another tab's save */
let hydrated = false;

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
      definitionView: "form",
      formLabels: "symbols",
      folders: [],
      browserView: "grid",
      browserSort: { key: "updated", asc: false },
      history: {},

      setHideKindChangeWarning: (hideKindChangeWarning) => set({ hideKindChangeWarning }),
      setDefinitionView: (definitionView) => set({ definitionView }),
      setFormLabels: (formLabels) => set({ formLabels }),
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
      openShared: (id, doc) => {
        const s = get();
        const known = s.workspaces.find((w) => w.sharedFrom === id);
        if (known) {
          set({ activeWorkspaceId: known.id, activeCellId: known.cells[0]?.id ?? null });
          return;
        }
        const ws: Workspace = {
          ...newWorkspace(
            doc.name.trim() || i18n.t("workspace.sharedName", { ns: "ui" }),
            doc.cells.length > 0 ? doc.cells.map((c) => c.source) : [""]
          ),
          sharedFrom: id
        };
        const layouts = { ...s.layouts };
        doc.cells.forEach((c, i) => {
          if (c.layout) layouts[ws.cells[i].id] = c.layout;
        });
        set({ workspaces: [...s.workspaces, ws], layouts, activeWorkspaceId: ws.id, activeCellId: ws.cells[0].id });
      },
      rememberShare: (workspaceId, share) =>
        set((s) => ({ workspaces: s.workspaces.map((w) => (w.id === workspaceId ? { ...w, lastShare: share } : w)) })),

      setCellSource: (cellId, source) =>
        set((s) => {
          if (activeWorkspace(s).cells.find((c) => c.id === cellId)?.source === source) return {};
          return {
            history: remembered(s, cellId),
            workspaces: s.workspaces.map((w) =>
              w.id !== s.activeWorkspaceId
                ? w
                : {
                    ...w,
                    updatedAt: Date.now(),
                    cells: w.cells.map((c) => (c.id === cellId ? { ...c, source } : c))
                  }
            )
          };
        }),
      ensureCellName: (cellId, base) => {
        const ws = activeWorkspace(get());
        const cell = ws.cells.find((c) => c.id === cellId);
        if (!cell) return base;
        const existing = cellName(cell.source);
        if (existing) return existing;
        const name = uniqueName(base, usedNames(ws.cells));
        get().setCellSource(cellId, withName(cell.source, name));
        return name;
      },
      addCell: (source = "", afterCellId = null) => {
        const cell: Cell = { id: uid(), source };
        set((s) => ({
          history: remembered(s),
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
            history: remembered(s),
            layouts: Object.fromEntries(Object.entries(s.layouts).filter(([k]) => k !== cellId)),
            workspaces: s.workspaces.map((w) =>
              w.id === s.activeWorkspaceId ? { ...w, cells, updatedAt: Date.now() } : w
            ),
            activeCellId
          };
        }),
      moveCellTo: (cellId, toIndex) =>
        set((s) => {
          const ws = activeWorkspace(s);
          const cells = [...ws.cells];
          const i = cells.findIndex((c) => c.id === cellId);
          const j = Math.max(0, Math.min(cells.length - 1, toIndex > i ? toIndex - 1 : toIndex));
          if (i < 0 || j === i) return {};
          const [moved] = cells.splice(i, 1);
          cells.splice(j, 0, moved);
          return {
            history: remembered(s),
            workspaces: s.workspaces.map((w) => (w.id === ws.id ? { ...w, cells, updatedAt: Date.now() } : w))
          };
        }),
      undo: () => set((s) => travel(s, undoStep)),
      redo: () => set((s) => travel(s, redoStep))
    }),
    {
      name: STORE_KEY,
      version: SAVE_VERSION,
      storage: createJSONStorage(() => guardedStorage(window.localStorage)),
      migrate: (saved, version) => {
        if (version > SAVE_VERSION) markNewerVersionSaved();
        return migrateState(saved, version) as AppState;
      },
      merge: (saved, current) => {
        const s = saved as Partial<AppState>;
        if (!hydrated) return { ...current, ...s };
        // another tab saved: its worksheets are taken over, but this tab stays where it is,
        // and an undo history that no longer matches its worksheet is dropped
        const workspaces = s.workspaces ?? current.workspaces;
        const stays = workspaces.find((w) => w.id === current.activeWorkspaceId);
        const before = new Map(current.workspaces.map((w) => [w.id, w.updatedAt]));
        const history = Object.fromEntries(
          Object.entries(current.history).filter(([id]) =>
            workspaces.some((w) => w.id === id && w.updatedAt === before.get(id))
          )
        );
        return {
          ...current,
          ...s,
          history,
          mobileTab: current.mobileTab,
          activeWorkspaceId: stays ? current.activeWorkspaceId : (s.activeWorkspaceId ?? current.activeWorkspaceId),
          activeCellId:
            stays && stays.cells.some((c) => c.id === current.activeCellId)
              ? current.activeCellId
              : stays
                ? (stays.cells[0]?.id ?? null)
                : (s.activeCellId ?? current.activeCellId)
        };
      },
      onRehydrateStorage: () => () => {
        hydrated = true;
      },
      // the undo history is for this session only
      partialize: ({ history: _history, ...saved }) => saved
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

/** When another tab of the app saves, this one takes its worksheets over, so neither overwrites the other's work. */
export function syncAcrossTabs(): void {
  window.addEventListener("storage", (e) => {
    if (e.key === STORE_KEY && e.newValue) void useAppStore.persist.rehydrate();
  });
}

export function exportWorkspaceJSON(ws: Workspace): string {
  return JSON.stringify(
    { app: "automata-lab", version: SAVE_VERSION, name: ws.name, cells: ws.cells.map((c) => ({ source: c.source })) },
    null,
    2
  );
}

/**
 * An exported worksheet file, its cells rewritten for this version. A file without a
 * version is taken as version 1; one written by a newer app is refused (reloading the
 * page brings the newer app).
 */
export function readWorksheetFile(
  text: string
): { ok: true; worksheet: Pick<Workspace, "name" | "cells"> } | { ok: false; reason: "invalid" | "newer" } {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return { ok: false, reason: "invalid" };
  }
  if (data === null || typeof data !== "object" || !Array.isArray((data as { cells?: unknown }).cells))
    return { ok: false, reason: "invalid" };
  const { version, name, cells } = data as { version?: unknown; name?: unknown; cells: { source?: unknown }[] };
  const from = typeof version === "number" ? version : 1;
  if (from > SAVE_VERSION) return { ok: false, reason: "newer" };
  return {
    ok: true,
    worksheet: {
      name: typeof name === "string" ? name : "",
      cells: cells.map((c) => ({ id: "", source: migrateSource(String(c?.source ?? ""), from) }))
    }
  };
}
