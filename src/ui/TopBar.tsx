import React, { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  activeWorkspace,
  exportWorkspaceJSON,
  useAppStore,
  Workspace
} from "../state/store";
import {
  Download,
  FolderOpen,
  HelpCircle,
  Moon,
  Pencil,
  Plus,
  Sparkles,
  Sun,
  Trash2,
  Upload
} from "lucide-react";
import { HelpModal } from "./HelpModal";
import { LanguageSwitcher } from "./LanguageSwitcher";
import { EXAMPLE_WORKSHEETS, exampleWorksheetName } from "../state/examples";

export const TopBar: React.FC = () => {
  const { t } = useTranslation();
  const theme = useAppStore((s) => s.theme);
  const setTheme = useAppStore((s) => s.setTheme);
  const workspaces = useAppStore((s) => s.workspaces);
  const ws = useAppStore(activeWorkspace);
  const setActiveWorkspace = useAppStore((s) => s.setActiveWorkspace);
  const addWorkspace = useAppStore((s) => s.addWorkspace);
  const renameWorkspace = useAppStore((s) => s.renameWorkspace);
  const setWorkspaceFolder = useAppStore((s) => s.setWorkspaceFolder);
  const deleteWorkspace = useAppStore((s) => s.deleteWorkspace);
  const importWorkspace = useAppStore((s) => s.importWorkspace);
  const [helpOpen, setHelpOpen] = useState(false);
  const [examplesOpen, setExamplesOpen] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const loadExample = (name: string, cells: string[]) => {
    importWorkspace({
      name,
      cells: cells.map((source) => ({ id: "", source }))
    } as Workspace);
    setExamplesOpen(false);
  };

  const onExport = () => {
    const blob = new Blob([exportWorkspaceJSON(ws)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${ws.name.replaceAll(/[^\wáéíóöőúüű -]/gi, "")}.automata.json`;
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

  const onRename = () => {
    const name = prompt(t("topbar.renamePrompt"), ws.name);
    if (name && name.trim()) renameWorkspace(ws.id, name.trim());
  };

  const onSetFolder = () => {
    const folder = prompt(t("topbar.folderPrompt"), ws.folder ?? "");
    if (folder !== null) setWorkspaceFolder(ws.id, folder);
  };

  const onDelete = () => {
    if (confirm(t("topbar.deleteConfirm", { name: ws.name }))) deleteWorkspace(ws.id);
  };

  return (
    <header className="topbar">
      <div className="logo">
        <img src="/icon.svg" alt="" />
        <span>
          Automata<span className="accent">Lab</span>
        </span>
      </div>

      <select value={ws.id} onChange={(e) => setActiveWorkspace(e.target.value)} title={t("topbar.selectWorksheet")}>
        {workspaces
          .filter((w) => !w.folder)
          .map((w) => (
            <option key={w.id} value={w.id}>
              {w.name}
            </option>
          ))}
        {[...new Set(workspaces.filter((w) => w.folder).map((w) => w.folder!))].sort().map((folder) => (
          <optgroup key={folder} label={`📁 ${folder}`}>
            {workspaces
              .filter((w) => w.folder === folder)
              .map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
          </optgroup>
        ))}
      </select>

      <button className="icon-btn" onClick={() => addWorkspace()} title={t("topbar.newWorksheet")}>
        <Plus size={15} />
      </button>
      <button className="icon-btn" onClick={onRename} title={t("topbar.renameWorksheet")}>
        <Pencil size={15} />
      </button>
      <button className="icon-btn" onClick={onSetFolder} title={t("topbar.setFolder")}>
        <FolderOpen size={15} />
      </button>
      <button className="icon-btn danger" onClick={onDelete} title={t("topbar.deleteWorksheet")}>
        <Trash2 size={15} />
      </button>

      <div className="menu-anchor">
        <button
          className="icon-btn"
          onClick={() => setExamplesOpen((o) => !o)}
          title={t("topbar.loadExample")}
        >
          <Sparkles size={15} />
          <span className="hide-sm">{t("topbar.examples")}</span>
        </button>
        {examplesOpen && (
          <div className="menu insert-menu" onMouseLeave={() => setExamplesOpen(false)}>
            <div className="menu-group">{t("topbar.exampleWorksheets")}</div>
            {EXAMPLE_WORKSHEETS.map((e) => (
              <button key={e.key} onClick={() => loadExample(exampleWorksheetName(t, e), e.cells)}>
                {exampleWorksheetName(t, e)}
              </button>
            ))}
          </div>
        )}
      </div>

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
    </header>
  );
};
