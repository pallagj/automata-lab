import React, { useRef, useState } from "react";
import {
  activeWorkspace,
  exportWorkspaceJSON,
  useAppStore,
  Workspace
} from "../state/store";
import { Download, HelpCircle, Moon, Pencil, Plus, Sun, Trash2, Upload } from "lucide-react";
import { HelpModal } from "./HelpModal";

export const TopBar: React.FC = () => {
  const theme = useAppStore((s) => s.theme);
  const setTheme = useAppStore((s) => s.setTheme);
  const workspaces = useAppStore((s) => s.workspaces);
  const ws = useAppStore(activeWorkspace);
  const setActiveWorkspace = useAppStore((s) => s.setActiveWorkspace);
  const addWorkspace = useAppStore((s) => s.addWorkspace);
  const renameWorkspace = useAppStore((s) => s.renameWorkspace);
  const deleteWorkspace = useAppStore((s) => s.deleteWorkspace);
  const importWorkspace = useAppStore((s) => s.importWorkspace);
  const [helpOpen, setHelpOpen] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

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
      alert("Nem sikerült beolvasni a fájlt — érvényes .automata.json kell.");
    }
  };

  const onRename = () => {
    const name = prompt("Munkalap új neve:", ws.name);
    if (name && name.trim()) renameWorkspace(ws.id, name.trim());
  };

  const onDelete = () => {
    if (confirm(`Biztosan törlöd a(z) „${ws.name}” munkalapot?`)) deleteWorkspace(ws.id);
  };

  return (
    <header className="topbar">
      <div className="logo">
        <img src="/icon.svg" alt="" />
        <span>
          Automata<span className="accent">Lab</span>
        </span>
      </div>

      <select value={ws.id} onChange={(e) => setActiveWorkspace(e.target.value)} title="Munkalap választása">
        {workspaces.map((w) => (
          <option key={w.id} value={w.id}>
            {w.name}
          </option>
        ))}
      </select>

      <button className="icon-btn" onClick={() => addWorkspace()} title="Új munkalap">
        <Plus size={15} />
      </button>
      <button className="icon-btn" onClick={onRename} title="Munkalap átnevezése">
        <Pencil size={15} />
      </button>
      <button className="icon-btn danger" onClick={onDelete} title="Munkalap törlése">
        <Trash2 size={15} />
      </button>

      <div className="spacer" />

      <button className="icon-btn" onClick={onExport} title="Munkalap mentése fájlba">
        <Download size={15} />
        <span className="hide-sm">Export</span>
      </button>
      <button className="icon-btn" onClick={() => fileRef.current?.click()} title="Munkalap betöltése fájlból">
        <Upload size={15} />
        <span className="hide-sm">Import</span>
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

      <button
        className="icon-btn"
        onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
        title={theme === "dark" ? "Világos téma" : "Sötét téma"}
      >
        {theme === "dark" ? <Sun size={15} /> : <Moon size={15} />}
      </button>
      <button className="icon-btn" onClick={() => setHelpOpen(true)} title="Súgó">
        <HelpCircle size={15} />
      </button>

      {helpOpen && <HelpModal onClose={() => setHelpOpen(false)} />}
    </header>
  );
};
