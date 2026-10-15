import React, { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { activeWorkspace, exportWorkspaceJSON, useAppStore, Workspace } from "../state/store";
import { Download, FolderOpen, HelpCircle, Moon, Pencil, Plus, Sparkles, Sun, Upload } from "lucide-react";
import { HelpModal } from "./HelpModal";
import { LanguageSwitcher } from "./LanguageSwitcher";
import { BrowserTab, InlineInput, WorksheetBrowser } from "./browser/WorksheetBrowser";

export const TopBar: React.FC = () => {
  const { t } = useTranslation();
  const theme = useAppStore((s) => s.theme);
  const setTheme = useAppStore((s) => s.setTheme);
  const ws = useAppStore(activeWorkspace);
  const addWorkspace = useAppStore((s) => s.addWorkspace);
  const renameWorkspace = useAppStore((s) => s.renameWorkspace);
  const importWorkspace = useAppStore((s) => s.importWorkspace);
  const [helpOpen, setHelpOpen] = useState(false);
  const [browser, setBrowser] = useState<{ tab: BrowserTab; folder: string | null } | null>(null);
  const [renaming, setRenaming] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

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

  return (
    <header className="topbar">
      <div className="logo">
        <img src="/icon.svg" alt="" />
        <span>
          Automata<span className="accent">Lab</span>
        </span>
      </div>

      <button
        className="icon-btn"
        onClick={() => setBrowser({ tab: "saved", folder: null })}
        title={t("topbar.openWorksheets")}
      >
        <FolderOpen size={15} />
        <span className="hide-sm">{t("topbar.worksheets")}</span>
      </button>

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
            <Pencil size={12} />
          </button>
        )}
      </div>

      <button className="icon-btn" onClick={() => addWorkspace(undefined, ws.folder)} title={t("topbar.newWorksheet")}>
        <Plus size={15} />
      </button>
      <button
        className="icon-btn"
        onClick={() => setBrowser({ tab: "examples", folder: null })}
        title={t("topbar.loadExample")}
      >
        <Sparkles size={15} />
        <span className="hide-sm">{t("topbar.examples")}</span>
      </button>

      <div className="spacer" />

      <button className="icon-btn" onClick={onExport} title={t("topbar.exportWorksheet")}>
        <Download size={15} />
        <span className="hide-sm">{t("topbar.export")}</span>
      </button>
      <button className="icon-btn" onClick={() => fileRef.current?.click()} title={t("topbar.importWorksheet")}>
        <Upload size={15} />
        <span className="hide-sm">{t("topbar.import")}</span>
      </button>
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

      <LanguageSwitcher />

      <button
        className="icon-btn"
        onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
        title={theme === "dark" ? t("topbar.lightTheme") : t("topbar.darkTheme")}
      >
        {theme === "dark" ? <Sun size={15} /> : <Moon size={15} />}
      </button>
      <button className="icon-btn" onClick={() => setHelpOpen(true)} title={t("topbar.help")}>
        <HelpCircle size={15} />
      </button>

      {helpOpen && <HelpModal onClose={() => setHelpOpen(false)} />}
      {browser && (
        <WorksheetBrowser initialTab={browser.tab} initialFolder={browser.folder} onClose={() => setBrowser(null)} />
      )}
    </header>
  );
};
