import React, { useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { activeWorkspace, allFolders, exportWorkspaceJSON, useAppStore, Workspace } from "../state/store";
import {
  ChevronDown,
  Copy,
  Download,
  FolderInput,
  FolderOpen,
  HelpCircle,
  Moon,
  Pencil,
  Plus,
  Sparkles,
  Sun,
  Upload
} from "lucide-react";
import { HelpModal } from "./HelpModal";
import { LanguageSwitcher } from "./LanguageSwitcher";
import { SettingsMenu } from "./SettingsMenu";
import { GitHubMenu } from "./GitHubMenu";
import { BrowserTab, WorksheetBrowser } from "./browser/WorksheetBrowser";
import { InlineInput, MovePanel, Popover } from "./browser/controls";

type HeaderMenu = { t: "worksheet" | "move"; rect: DOMRect };

/**
 * Header in three zones: the worksheet (browser, title, actions menu) on the left,
 * the logo in the middle, and app-wide settings as plain icons on the right.
 */
export const TopBar: React.FC = () => {
  const { t } = useTranslation();
  const theme = useAppStore((s) => s.theme);
  const setTheme = useAppStore((s) => s.setTheme);
  const ws = useAppStore(activeWorkspace);
  const workspaces = useAppStore((s) => s.workspaces);
  const explicitFolders = useAppStore((s) => s.folders);
  const addWorkspace = useAppStore((s) => s.addWorkspace);
  const renameWorkspace = useAppStore((s) => s.renameWorkspace);
  const duplicateWorkspace = useAppStore((s) => s.duplicateWorkspace);
  const moveWorkspaces = useAppStore((s) => s.moveWorkspaces);
  const importWorkspace = useAppStore((s) => s.importWorkspace);
  const [helpOpen, setHelpOpen] = useState(false);
  const [browser, setBrowser] = useState<{ tab: BrowserTab; folder: string | null } | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [menu, setMenu] = useState<HeaderMenu | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const folders = useMemo(() => allFolders({ folders: explicitFolders, workspaces }), [explicitFolders, workspaces]);

  const onExport = () => {
    const blob = new Blob([exportWorkspaceJSON(ws)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${ws.name.replaceAll(/[^\p{L}\p{N}_ -]/gu, "")}.automata.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const onImportFile = async (file: File) => {
    try {
      const data = JSON.parse(await file.text()) as Workspace;
      importWorkspace(data);
    } catch {
      alert(t("topbar.importFailed"));
    }
  };

  /** runs a worksheet-menu action and closes the menu */
  const act = (fn: () => void) => () => {
    setMenu(null);
    fn();
  };

  return (
    <header className="topbar">
      <div className="topbar-left">
        <button
          className="icon-btn ghost"
          onClick={() => setBrowser({ tab: "saved", folder: null })}
          title={t("topbar.openWorksheets")}
          aria-label={t("topbar.openWorksheets")}
        >
          <FolderOpen size={18} />
        </button>
        <span className="topbar-divider" />

        <div className="ws-title">
          {ws.folder && (
            <button
              className="ws-folder"
              onClick={() => setBrowser({ tab: "saved", folder: ws.folder ?? null })}
              title={t("topbar.openFolder")}
            >
              {ws.folder}
              <span className="ws-sep">/</span>
            </button>
          )}
          {renaming ? (
            <InlineInput
              initial={ws.name}
              onCommit={(name) => {
                renameWorkspace(ws.id, name);
                setRenaming(false);
              }}
              onCancel={() => setRenaming(false)}
            />
          ) : (
            <button className="ws-name" onClick={() => setRenaming(true)} title={t("topbar.renameHint")}>
              <span>{ws.name}</span>
            </button>
          )}
        </div>
        <button
          className="icon-btn ghost ws-menu-btn"
          title={t("topbar.worksheetMenu")}
          aria-label={t("topbar.worksheetMenu")}
          onClick={(e) => setMenu({ t: "worksheet", rect: e.currentTarget.getBoundingClientRect() })}
        >
          <ChevronDown size={16} />
        </button>
      </div>

      <div className="logo">
        Automata<span className="accent">Lab</span>
      </div>

      <div className="topbar-right">
        <button
          className="icon-btn ghost"
          onClick={() => setHelpOpen(true)}
          title={t("topbar.help")}
          aria-label={t("topbar.help")}
        >
          <HelpCircle size={17} />
        </button>
        <LanguageSwitcher />
        <SettingsMenu />
        <button
          className="icon-btn ghost"
          onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
          title={theme === "dark" ? t("topbar.lightTheme") : t("topbar.darkTheme")}
          aria-label={theme === "dark" ? t("topbar.lightTheme") : t("topbar.darkTheme")}
        >
          {theme === "dark" ? <Sun size={17} /> : <Moon size={17} />}
        </button>
        <GitHubMenu />
      </div>

      {menu?.t === "worksheet" && (
        <Popover rect={menu.rect} width={240} onClose={() => setMenu(null)}>
          <button onClick={act(() => setRenaming(true))}>
            <Pencil size={14} /> {t("browser.menu.rename")}
          </button>
          <button onClick={act(() => addWorkspace(undefined, ws.folder))}>
            <Plus size={14} /> {t("topbar.newWorksheet")}
          </button>
          <button onClick={act(() => duplicateWorkspace(ws.id, true))}>
            <Copy size={14} /> {t("browser.menu.duplicate")}
          </button>
          <button onClick={() => setMenu({ t: "move", rect: menu.rect })}>
            <FolderInput size={14} /> {t("browser.menu.move")}
          </button>
          <div className="menu-sep" />
          <button onClick={act(onExport)}>
            <Download size={14} /> {t("topbar.exportWorksheet")}
          </button>
          <button onClick={act(() => fileRef.current?.click())}>
            <Upload size={14} /> {t("topbar.importWorksheet")}
          </button>
          <div className="menu-sep" />
          <button onClick={act(() => setBrowser({ tab: "examples", folder: null }))}>
            <Sparkles size={14} /> {t("topbar.examples")}
          </button>
        </Popover>
      )}
      {menu?.t === "move" && (
        <Popover rect={menu.rect} width={260} onClose={() => setMenu(null)}>
          <MovePanel
            folders={folders}
            currentFolders={new Set([ws.folder])}
            onMove={(target) => {
              moveWorkspaces([ws.id], target);
              setMenu(null);
            }}
          />
        </Popover>
      )}

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

      {helpOpen && <HelpModal onClose={() => setHelpOpen(false)} />}
      {browser && (
        <WorksheetBrowser initialTab={browser.tab} initialFolder={browser.folder} onClose={() => setBrowser(null)} />
      )}
    </header>
  );
};
