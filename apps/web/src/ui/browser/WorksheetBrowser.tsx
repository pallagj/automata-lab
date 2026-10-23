import React, { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ArrowDown,
  ArrowUp,
  Check,
  ChevronDown,
  ChevronLeft,
  Copy,
  EllipsisVertical,
  FileUp,
  Folder,
  FolderInput,
  FolderPlus,
  LayoutGrid,
  List,
  ListFilter,
  Pencil,
  Plus,
  Search,
  Trash2,
  X
} from "lucide-react";
import {
  allFolders,
  BrowserSortKey,
  LibrarySnapshot,
  librarySnapshot,
  useAppStore,
  Workspace
} from "../../state/store";
import { EXAMPLE_WORKSHEETS, exampleWorksheetName } from "@automatalab/core/worksheet/examples";
import { summarizeCells, WORKSHEET_KINDS, WorksheetKind } from "./preview";
import { KindBadges, WorksheetThumb } from "./WorksheetThumb";
import { KindIcon } from "../kinds";
import { InlineInput, MovePanel, Popover } from "./controls";
import "./browser.css";

export type BrowserTab = "saved" | "examples";

interface Props {
  initialTab?: BrowserTab;
  /** folder to open in (null = the top level) */
  initialFolder?: string | null;
  onClose: () => void;
}

type MenuState =
  | { t: "worksheet"; id: string; rect: DOMRect }
  | { t: "folder"; name: string; rect: DOMRect }
  | { t: "move"; ids: string[]; rect: DOMRect }
  | { t: "new"; rect: DOMRect }
  | { t: "filter"; rect: DOMRect };

type RenameState = { t: "worksheet"; id: string } | { t: "folder"; name: string } | { t: "newFolder" };

interface Toast {
  id: number;
  message: string;
  undo?: LibrarySnapshot;
}

/** Drop target id of the "back to Saved work" link (= move out of the folder). */
const ROOT_DROP = "\u0000root";
const TOAST_MS = 8000;

export const WorksheetBrowser: React.FC<Props> = ({ initialTab = "saved", initialFolder = null, onClose }) => {
  const { t, i18n } = useTranslation();
  const workspaces = useAppStore((s) => s.workspaces);
  const explicitFolders = useAppStore((s) => s.folders);
  const activeId = useAppStore((s) => s.activeWorkspaceId);
  const view = useAppStore((s) => s.browserView);
  const sort = useAppStore((s) => s.browserSort);
  const setView = useAppStore((s) => s.setBrowserView);
  const setSort = useAppStore((s) => s.setBrowserSort);
  const setActiveWorkspace = useAppStore((s) => s.setActiveWorkspace);
  const addWorkspace = useAppStore((s) => s.addWorkspace);
  const importWorkspace = useAppStore((s) => s.importWorkspace);
  const renameWorkspace = useAppStore((s) => s.renameWorkspace);
  const duplicateWorkspace = useAppStore((s) => s.duplicateWorkspace);
  const deleteWorkspaces = useAppStore((s) => s.deleteWorkspaces);
  const moveWorkspaces = useAppStore((s) => s.moveWorkspaces);
  const createFolder = useAppStore((s) => s.createFolder);
  const renameFolder = useAppStore((s) => s.renameFolder);
  const deleteFolder = useAppStore((s) => s.deleteFolder);
  const restoreSnapshot = useAppStore((s) => s.restoreSnapshot);

  const [tab, setTab] = useState<BrowserTab>(initialTab);
  const [folder, setFolder] = useState<string | null>(initialFolder);
  const [query, setQuery] = useState("");
  const [kindFilter, setKindFilter] = useState<Set<WorksheetKind>>(new Set());
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [renaming, setRenaming] = useState<RenameState | null>(null);
  const [dragIds, setDragIds] = useState<string[] | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const dragGhostRef = useRef<HTMLDivElement>(null);

  const folders = useMemo(() => allFolders({ folders: explicitFolders, workspaces }), [explicitFolders, workspaces]);

  // a folder renamed or deleted elsewhere (or emptied by undo) must not leave us inside a ghost folder
  useEffect(() => {
    if (folder !== null && !folders.includes(folder)) setFolder(null);
  }, [folder, folders]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast((cur) => (cur?.id === toast.id ? null : cur)), TOAST_MS);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (menu) setMenu(null);
      else if (selected.size > 0) setSelected(new Set());
      else onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [menu, selected, onClose]);

  const q = query.trim().toLocaleLowerCase();
  const searching = q !== "";
  const filtering = kindFilter.size > 0;
  const matchesKinds = (kinds: WorksheetKind[]) => !filtering || kinds.some((k) => kindFilter.has(k));

  const compare = (a: Workspace, b: Workspace) => {
    const d =
      sort.key === "name"
        ? a.name.localeCompare(b.name, i18n.language, { numeric: true, sensitivity: "base" })
        : sort.key === "created"
          ? a.createdAt - b.createdAt
          : a.updatedAt - b.updatedAt;
    return sort.asc ? d : -d;
  };

  // searching looks through every folder; otherwise only the current level is listed
  const visible = workspaces
    .filter((w) => (searching ? w.name.toLocaleLowerCase().includes(q) : (w.folder ?? null) === folder))
    .filter((w) => matchesKinds(summarizeCells(w.cells).kinds))
    .sort(compare);
  const visibleFolders =
    folder === null && !filtering ? folders.filter((f) => !searching || f.toLocaleLowerCase().includes(q)) : [];
  const visibleExamples = EXAMPLE_WORKSHEETS.map((e, i) => ({
    ...e,
    title: exampleWorksheetName(t, e),
    summary: summarizeCells(e.cells.map((source, j) => ({ id: `example-${i}-${j}`, source })))
  })).filter((e) => (!searching || e.title.toLocaleLowerCase().includes(q)) && matchesKinds(e.summary.kinds));

  const dateFormat = useMemo(
    () => new Intl.DateTimeFormat(i18n.language, { year: "numeric", month: "short", day: "numeric" }),
    [i18n.language]
  );
  const shownDate = (w: Workspace) => dateFormat.format(sort.key === "created" ? w.createdAt : w.updatedAt);

  /* ---------------------------- actions ---------------------------- */

  const showToast = (message: string, undo?: LibrarySnapshot) => setToast({ id: Date.now(), message, undo });
  const snapshot = () => librarySnapshot(useAppStore.getState());

  const open = (id: string) => {
    setActiveWorkspace(id);
    onClose();
  };

  const toggleSelected = (id: string) =>
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const doMove = (ids: string[], target: string | undefined) => {
    const moving = ids.filter((id) => workspaces.find((w) => w.id === id)?.folder !== target);
    setMenu(null);
    setSelected(new Set());
    if (moving.length === 0) return;
    const snap = snapshot();
    moveWorkspaces(moving, target);
    showToast(t("browser.toast.moved", { count: moving.length, folder: target ?? t("browser.tabs.saved") }), snap);
  };

  const doDelete = (ids: string[]) => {
    setMenu(null);
    setSelected(new Set());
    const snap = snapshot();
    deleteWorkspaces(ids);
    showToast(t("browser.toast.deleted", { count: ids.length }), snap);
  };

  const doDeleteFolder = (name: string) => {
    setMenu(null);
    const snap = snapshot();
    deleteFolder(name);
    if (folder === name) setFolder(null);
    showToast(t("browser.toast.folderDeleted", { name }), snap);
  };

  const doDuplicate = (id: string) => {
    setMenu(null);
    duplicateWorkspace(id);
    showToast(t("browser.toast.duplicated"));
  };

  const newWorksheet = () => {
    addWorkspace(undefined, folder ?? undefined);
    onClose();
  };

  const loadExample = (name: string, cells: string[]) => {
    importWorkspace({ name, cells: cells.map((source) => ({ id: "", source })) });
    onClose();
  };

  const onImportFile = async (file: File) => {
    try {
      const data = JSON.parse(await file.text()) as Workspace;
      importWorkspace(data, folder ?? undefined);
      onClose();
    } catch {
      showToast(t("topbar.importFailed"));
    }
  };

  const openFolder = (name: string) => {
    setFolder(name);
    setQuery("");
    setSelected(new Set());
  };

  const sortBy = (key: BrowserSortKey) =>
    setSort(sort.key === key ? { key, asc: !sort.asc } : { key, asc: key === "name" });

  /* --------------------------- drag & drop -------------------------- */

  const onCardDragStart = (e: React.DragEvent, id: string) => {
    const ids = selected.has(id) ? [...selected] : [id];
    setDragIds(ids);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", ids.join(","));
    if (ids.length > 1 && dragGhostRef.current) {
      dragGhostRef.current.textContent = t("browser.dragCount", { count: ids.length });
      e.dataTransfer.setDragImage(dragGhostRef.current, 16, 16);
    }
  };
  const endDrag = () => {
    setDragIds(null);
    setDropTarget(null);
  };
  const dropProps = (target: string) =>
    dragIds
      ? {
          onDragOver: (e: React.DragEvent) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = "move";
            if (dropTarget !== target) setDropTarget(target);
          },
          onDragLeave: (e: React.DragEvent) => {
            if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDropTarget(null);
          },
          onDrop: (e: React.DragEvent) => {
            e.preventDefault();
            const ids = dragIds;
            endDrag();
            doMove(ids, target === ROOT_DROP ? undefined : target);
          }
        }
      : {};

  /* ----------------------------- render ----------------------------- */

  const anchor = (e: React.MouseEvent) => (e.currentTarget as HTMLElement).getBoundingClientRect();

  const cardCheckbox = (w: Workspace) => (
    <input
      type="checkbox"
      className="wb-check"
      checked={selected.has(w.id)}
      onClick={(e) => e.stopPropagation()}
      onChange={() => toggleSelected(w.id)}
      aria-label={t("browser.select", { name: w.name })}
    />
  );

  const moreButton = (w: Workspace) => (
    <button
      className="wb-more"
      title={t("browser.more")}
      onClick={(e) => {
        e.stopPropagation();
        setMenu({ t: "worksheet", id: w.id, rect: anchor(e) });
      }}
    >
      <EllipsisVertical size={16} />
    </button>
  );

  const cardTitle = (w: Workspace) =>
    renaming?.t === "worksheet" && renaming.id === w.id ? (
      <InlineInput
        initial={w.name}
        onCommit={(v) => {
          renameWorkspace(w.id, v);
          setRenaming(null);
        }}
        onCancel={() => setRenaming(null)}
      />
    ) : (
      <span className="wb-title" title={w.name}>
        {w.name}
      </span>
    );

  const cardInteraction = (w: Workspace) => ({
    tabIndex: 0,
    draggable: renaming === null,
    onDragStart: (e: React.DragEvent) => onCardDragStart(e, w.id),
    onDragEnd: endDrag,
    onClick: () => (selected.size > 0 ? toggleSelected(w.id) : open(w.id)),
    onKeyDown: (e: React.KeyboardEvent) => {
      if (e.target !== e.currentTarget) return;
      if (e.key === "Enter") open(w.id);
      if (e.key === " ") {
        e.preventDefault();
        toggleSelected(w.id);
      }
    }
  });

  const cardClass = (w: Workspace, base: string) =>
    [base, selected.has(w.id) && "selected", w.id === activeId && "current", dragIds?.includes(w.id) && "dragging"]
      .filter(Boolean)
      .join(" ");

  const renderWorksheetCard = (w: Workspace) => {
    const summary = summarizeCells(w.cells);
    return (
      <div key={w.id} className={cardClass(w, "ws-card")} {...cardInteraction(w)}>
        <div className="wb-head">
          {cardCheckbox(w)}
          {cardTitle(w)}
          {moreButton(w)}
        </div>
        <div className="wb-body">
          <WorksheetThumb preview={summary.preview} />
          {w.id === activeId && <span className="current-tag">{t("browser.current")}</span>}
          <div className="wb-foot">
            <span className="wb-date">{shownDate(w)}</span>
            {searching && w.folder && (
              <span className="wb-folder">
                <Folder size={11} /> {w.folder}
              </span>
            )}
            <KindBadges kinds={summary.kinds} />
          </div>
        </div>
      </div>
    );
  };

  const sortHeader = (key: BrowserSortKey, label: string, className: string) => (
    <button className={`list-sort ${className} ${sort.key === key ? "active" : ""}`} onClick={() => sortBy(key)}>
      {label}
      {sort.key === key && (sort.asc ? <ArrowUp size={13} /> : <ArrowDown size={13} />)}
    </button>
  );

  const renderWorksheetRow = (w: Workspace) => {
    const summary = summarizeCells(w.cells);
    return (
      <div key={w.id} className={cardClass(w, "ws-row")} {...cardInteraction(w)}>
        {cardCheckbox(w)}
        <div className="row-thumb">
          <WorksheetThumb preview={summary.preview} labels={false} />
        </div>
        <div className="row-name">
          {cardTitle(w)}
          {w.id === activeId && <span className="current-tag inline">{t("browser.current")}</span>}
          {searching && w.folder && (
            <span className="wb-folder">
              <Folder size={11} /> {w.folder}
            </span>
          )}
        </div>
        <div className="row-kinds">
          <KindBadges kinds={summary.kinds} />
        </div>
        <span className="row-date col-updated">{dateFormat.format(w.updatedAt)}</span>
        <span className="row-date col-created">{dateFormat.format(w.createdAt)}</span>
        {moreButton(w)}
      </div>
    );
  };

  const renderFolderCard = (name: string) => {
    const inside = workspaces.filter((w) => w.folder === name).sort((a, b) => b.updatedAt - a.updatedAt);
    const isRenaming = renaming?.t === "folder" && renaming.name === name;
    return (
      <div
        key={name}
        className={`folder-card ${dropTarget === name ? "drop-over" : ""}`}
        tabIndex={0}
        onClick={() => !isRenaming && openFolder(name)}
        onKeyDown={(e) => e.key === "Enter" && e.target === e.currentTarget && openFolder(name)}
        {...dropProps(name)}
      >
        <div className="wb-head">
          <Folder size={16} className="folder-icon" />
          {isRenaming ? (
            <InlineInput
              initial={name}
              onCommit={(v) => {
                renameFolder(name, v);
                setRenaming(null);
              }}
              onCancel={() => setRenaming(null)}
            />
          ) : (
            <span className="wb-title">{name}</span>
          )}
          <button
            className="wb-more"
            title={t("browser.more")}
            onClick={(e) => {
              e.stopPropagation();
              setMenu({ t: "folder", name, rect: anchor(e) });
            }}
          >
            <EllipsisVertical size={16} />
          </button>
        </div>
        <div className="folder-foot">
          <span className="folder-minis">
            {inside.slice(0, 3).map((w) => (
              <span key={w.id} className="folder-mini">
                <WorksheetThumb preview={summarizeCells(w.cells).preview} labels={false} />
              </span>
            ))}
          </span>
          <span className="folder-count">{t("browser.items", { count: inside.length })}</span>
        </div>
      </div>
    );
  };

  const menuWorksheet = menu?.t === "worksheet" ? workspaces.find((w) => w.id === menu.id) : undefined;
  const selectedIds = [...selected];

  const savedEmpty =
    visible.length === 0 && visibleFolders.length === 0 && renaming?.t !== "newFolder"
      ? searching || filtering
        ? t("browser.empty.noMatch")
        : folder !== null
          ? t("browser.empty.folder")
          : t("browser.empty.saved")
      : null;

  // popovers live outside .modal-back: portal clicks bubble through the React tree and would close the browser
  return (
    <>
      <div className="modal-back" onClick={onClose}>
        <div
          className="modal browser"
          onClick={(e) => e.stopPropagation()}
          role="dialog"
          aria-label={t("browser.title")}
        >
          {/* ---- header: new + search ---- */}
          <div className="browser-top">
            <div className="split-btn">
              <button className="icon-btn primary" onClick={newWorksheet}>
                <Plus size={15} />
                {t("browser.newWorksheet")}
              </button>
              <button
                className="icon-btn primary split-caret"
                title={t("browser.moreNew")}
                onClick={(e) => setMenu({ t: "new", rect: anchor(e) })}
              >
                <ChevronDown size={15} />
              </button>
            </div>
            <div className="spacer" />
            <label className="browser-search">
              <Search size={14} />
              <input
                value={query}
                placeholder={t("browser.search")}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => e.key === "Escape" && query && (e.stopPropagation(), setQuery(""))}
              />
              {query && (
                <button className="search-clear" onClick={() => setQuery("")} title={t("browser.clearSearch")}>
                  <X size={13} />
                </button>
              )}
            </label>
            <button className="icon-btn" onClick={onClose} title={t("browser.close")}>
              <X size={15} />
            </button>
          </div>

          {/* ---- tabs or breadcrumb + toolbar ---- */}
          <div className="browser-bar">
            {folder !== null && tab === "saved" && !searching ? (
              <div className="breadcrumb">
                <button
                  className={`crumb-back ${dropTarget === ROOT_DROP ? "drop-over" : ""}`}
                  onClick={() => {
                    setFolder(null);
                    setSelected(new Set());
                  }}
                  title={dragIds ? t("browser.dropToRoot") : undefined}
                  {...dropProps(ROOT_DROP)}
                >
                  <ChevronLeft size={18} />
                  {t("browser.tabs.saved")}
                </button>
                <div className="crumb-folder">
                  <Folder size={18} />
                  {renaming?.t === "folder" && renaming.name === folder ? (
                    <InlineInput
                      initial={folder}
                      onCommit={(v) => {
                        renameFolder(folder, v);
                        setFolder(v);
                        setRenaming(null);
                      }}
                      onCancel={() => setRenaming(null)}
                    />
                  ) : (
                    <span>{folder}</span>
                  )}
                  <button
                    className="wb-more"
                    title={t("browser.more")}
                    onClick={(e) => setMenu({ t: "folder", name: folder, rect: anchor(e) })}
                  >
                    <EllipsisVertical size={16} />
                  </button>
                </div>
              </div>
            ) : (
              <div className="browser-tabs" role="tablist">
                {(["saved", "examples"] as BrowserTab[]).map((key) => (
                  <button
                    key={key}
                    role="tab"
                    aria-selected={tab === key}
                    className={tab === key ? "active" : ""}
                    onClick={() => {
                      setTab(key);
                      setSelected(new Set());
                    }}
                  >
                    {t(`browser.tabs.${key}`)}
                  </button>
                ))}
              </div>
            )}
            <div className="spacer" />
            {selected.size > 0 ? (
              <div className="selection-bar">
                <button className="icon-btn" onClick={() => setSelected(new Set())}>
                  {t("browser.clearSelection", { count: selected.size })}
                </button>
                <button
                  className="icon-btn primary"
                  title={t("browser.menu.move")}
                  onClick={(e) => setMenu({ t: "move", ids: selectedIds, rect: anchor(e) })}
                >
                  <FolderInput size={15} />
                </button>
                <button
                  className="icon-btn danger-solid"
                  title={t("browser.menu.delete")}
                  onClick={() => doDelete(selectedIds)}
                >
                  <Trash2 size={15} />
                </button>
              </div>
            ) : (
              <div className="view-tools">
                <button
                  className={`icon-btn round ${filtering ? "on" : ""}`}
                  title={t("browser.filter")}
                  onClick={(e) => setMenu({ t: "filter", rect: anchor(e) })}
                >
                  <ListFilter size={15} />
                  {filtering && <span className="filter-count">{kindFilter.size}</span>}
                </button>
                {tab === "saved" && (
                  <div className="segmented">
                    <button
                      className={view === "grid" ? "on" : ""}
                      onClick={() => setView("grid")}
                      title={t("browser.gridView")}
                    >
                      <LayoutGrid size={15} />
                    </button>
                    <button
                      className={view === "list" ? "on" : ""}
                      onClick={() => setView("list")}
                      title={t("browser.listView")}
                    >
                      <List size={15} />
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* ---- content ---- */}
          <div className="browser-body">
            {tab === "saved" ? (
              <>
                {(visibleFolders.length > 0 || renaming?.t === "newFolder") && (
                  <div className="folder-grid">
                    {renaming?.t === "newFolder" && (
                      <div className="folder-card creating">
                        <div className="wb-head">
                          <Folder size={16} className="folder-icon" />
                          <InlineInput
                            initial=""
                            placeholder={t("browser.folderName")}
                            onCommit={(v) => {
                              createFolder(v);
                              setRenaming(null);
                            }}
                            onCancel={() => setRenaming(null)}
                          />
                        </div>
                      </div>
                    )}
                    {visibleFolders.map(renderFolderCard)}
                  </div>
                )}

                {savedEmpty && <div className="browser-empty">{savedEmpty}</div>}

                {visible.length > 0 &&
                  (view === "grid" ? (
                    <div className="ws-grid">{visible.map(renderWorksheetCard)}</div>
                  ) : (
                    <div className="ws-list">
                      <div className="ws-list-head">
                        <span className="col-check" />
                        {sortHeader("name", t("browser.columns.name"), "col-name")}
                        <span className="col-kinds">{t("browser.columns.contains")}</span>
                        {sortHeader("updated", t("browser.sort.updated"), "col-updated")}
                        {sortHeader("created", t("browser.sort.created"), "col-created")}
                        <span className="col-more" />
                      </div>
                      {visible.map(renderWorksheetRow)}
                    </div>
                  ))}
              </>
            ) : visibleExamples.length === 0 ? (
              <div className="browser-empty">{t("browser.empty.noMatch")}</div>
            ) : (
              <div className="ws-grid">
                {visibleExamples.map((e) => (
                  <div
                    key={e.key}
                    className="ws-card example"
                    tabIndex={0}
                    onClick={() => loadExample(e.title, e.cells)}
                    onKeyDown={(ev) => ev.key === "Enter" && loadExample(e.title, e.cells)}
                  >
                    <div className="wb-head">
                      <span className="wb-title" title={e.title}>
                        {e.title}
                      </span>
                    </div>
                    <div className="wb-body">
                      <WorksheetThumb preview={e.summary.preview} />
                      <div className="wb-foot">
                        <span className="wb-date">{t("browser.exampleCells", { count: e.cells.length })}</span>
                        <KindBadges kinds={e.summary.kinds} />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {toast && (
            <div className="browser-toast" role="status">
              <span>{toast.message}</span>
              {toast.undo && (
                <button
                  onClick={() => {
                    restoreSnapshot(toast.undo!);
                    setToast(null);
                  }}
                >
                  {t("browser.undo")}
                </button>
              )}
              <button className="toast-close" onClick={() => setToast(null)} title={t("browser.close")}>
                <X size={13} />
              </button>
            </div>
          )}

          <div ref={dragGhostRef} className="drag-ghost" aria-hidden />
          <input
            ref={fileRef}
            type="file"
            accept=".json,application/json"
            style={{ display: "none" }}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) onImportFile(f);
              e.target.value = "";
            }}
          />
        </div>
      </div>

      {/* ---- popovers ---- */}
      {menu?.t === "worksheet" && menuWorksheet && (
        <Popover rect={menu.rect} width={210} onClose={() => setMenu(null)}>
          <button
            onClick={() => {
              setMenu(null);
              setRenaming({ t: "worksheet", id: menuWorksheet.id });
            }}
          >
            <Pencil size={14} /> {t("browser.menu.rename")}
          </button>
          <button onClick={() => setMenu({ t: "move", ids: [menuWorksheet.id], rect: menu.rect })}>
            <FolderInput size={14} /> {t("browser.menu.move")}
          </button>
          <button onClick={() => doDuplicate(menuWorksheet.id)}>
            <Copy size={14} /> {t("browser.menu.duplicate")}
          </button>
          <button className="danger" onClick={() => doDelete([menuWorksheet.id])}>
            <Trash2 size={14} /> {t("browser.menu.delete")}
          </button>
        </Popover>
      )}

      {menu?.t === "folder" && (
        <Popover rect={menu.rect} width={210} onClose={() => setMenu(null)}>
          <button
            onClick={() => {
              setMenu(null);
              setRenaming({ t: "folder", name: menu.name });
            }}
          >
            <Pencil size={14} /> {t("browser.folderMenu.rename")}
          </button>
          <button className="danger" onClick={() => doDeleteFolder(menu.name)}>
            <Trash2 size={14} /> {t("browser.folderMenu.delete")}
          </button>
        </Popover>
      )}

      {menu?.t === "move" && (
        <Popover rect={menu.rect} width={260} onClose={() => setMenu(null)}>
          <MovePanel
            folders={folders}
            currentFolders={new Set(menu.ids.map((id) => workspaces.find((w) => w.id === id)?.folder))}
            onMove={(target) => doMove(menu.ids, target)}
          />
        </Popover>
      )}

      {menu?.t === "new" && (
        <Popover rect={menu.rect} width={230} onClose={() => setMenu(null)}>
          {folder === null && (
            <button
              onClick={() => {
                setMenu(null);
                setTab("saved");
                setQuery("");
                setRenaming({ t: "newFolder" });
              }}
            >
              <FolderPlus size={14} /> {t("browser.newFolder")}
            </button>
          )}
          <button
            onClick={() => {
              setMenu(null);
              fileRef.current?.click();
            }}
          >
            <FileUp size={14} /> {t("browser.importFile")}
          </button>
        </Popover>
      )}

      {menu?.t === "filter" && (
        <Popover rect={menu.rect} width={250} onClose={() => setMenu(null)}>
          <div className="menu-group">{t("browser.sortBy")}</div>
          {(["updated", "created", "name"] as BrowserSortKey[]).map((key) => (
            <button key={key} className={sort.key === key ? "checked" : ""} onClick={() => sortBy(key)}>
              <span className="check-slot">{sort.key === key && <Check size={14} />}</span>
              {t(`browser.sort.${key}`)}
              {sort.key === key && (
                <span className="sort-dir">{sort.asc ? <ArrowUp size={13} /> : <ArrowDown size={13} />}</span>
              )}
            </button>
          ))}
          <div className="menu-group">{t("browser.showOnly")}</div>
          {WORKSHEET_KINDS.map((k) => (
            <button
              key={k}
              className={kindFilter.has(k) ? "checked" : ""}
              onClick={() =>
                setKindFilter((s) => {
                  const next = new Set(s);
                  if (next.has(k)) next.delete(k);
                  else next.add(k);
                  return next;
                })
              }
            >
              <span className="check-slot">{kindFilter.has(k) && <Check size={14} />}</span>
              <KindIcon kind={k} size={15} />
              {t(`browser.kind.${k}`)}
            </button>
          ))}
          {filtering && (
            <button className="clear-filters" onClick={() => setKindFilter(new Set())}>
              <X size={14} /> {t("browser.clearFilters")}
            </button>
          )}
        </Popover>
      )}
    </>
  );
};
