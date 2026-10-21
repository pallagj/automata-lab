import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Workspace, canRedo, canUndo, useAppStore } from "../../state/store";
import { CellResult } from "../../core/workspace";
import { CellEditor } from "./CellEditor";
import { CELL_TEMPLATES } from "../../state/examples";
import { uniqueName, usedNames } from "../../state/names";
import { Plus, Redo2, Undo2 } from "lucide-react";
import { KindIcon } from "../kinds";

interface Props {
  workspace: Workspace;
  results: CellResult[];
}

interface InsertOption {
  labelKey: string;
  icon: React.ReactNode;
  /** template; {NAME} is replaced by a unique name */
  make: (used: Set<string>) => string;
}

/** Machines in order of power, then grammar, regex, and finally a free expression. */
const INSERT_OPTIONS: InsertOption[] = [
  {
    labelKey: "editor.insertMenu.fsm",
    icon: <KindIcon kind="fsm" size={15} />,
    make: (used) => CELL_TEMPLATES.fsm.replace("name: M", `name: ${uniqueName("M", used)}`)
  },
  {
    labelKey: "editor.insertMenu.pda",
    icon: <KindIcon kind="pda" size={15} />,
    make: (used) => CELL_TEMPLATES.pda.replace("name: P", `name: ${uniqueName("P", used)}`)
  },
  {
    labelKey: "editor.insertMenu.tm",
    icon: <KindIcon kind="tm" size={15} />,
    make: (used) => CELL_TEMPLATES.tm.replace("name: T", `name: ${uniqueName("T", used)}`)
  },
  {
    labelKey: "editor.insertMenu.machine",
    icon: <KindIcon kind="general" size={15} />,
    make: (used) => CELL_TEMPLATES.machine.replace("name: C", `name: ${uniqueName("C", used)}`)
  },
  {
    labelKey: "editor.insertMenu.grammar",
    icon: <KindIcon kind="grammar" size={15} />,
    make: (used) => CELL_TEMPLATES.grammar.replace("name: G", `name: ${uniqueName("G", used)}`)
  },
  {
    labelKey: "editor.insertMenu.regex",
    icon: <KindIcon kind="regex" size={15} />,
    make: (used) => `${uniqueName("R", used)} = regex()`
  },
  { labelKey: "editor.insertMenu.expression", icon: <KindIcon kind="expression" size={15} />, make: () => "" },
  {
    labelKey: "editor.insertMenu.note",
    icon: <KindIcon kind="note" size={15} />,
    make: () => "# "
  }
];

export const EditorColumn: React.FC<Props> = ({ workspace, results }) => {
  const { t } = useTranslation();
  const addCell = useAppStore((s) => s.addCell);
  const setCellSource = useAppStore((s) => s.setCellSource);
  const setActiveCell = useAppStore((s) => s.setActiveCell);
  const activeCellId = useAppStore((s) => s.activeCellId);
  const undo = useAppStore((s) => s.undo);
  const redo = useAppStore((s) => s.redo);
  const undoable = useAppStore(canUndo);
  const redoable = useAppStore(canRedo);
  const [menuOpen, setMenuOpen] = useState(false);
  /** the list is scrolled away from the top: the header casts a shadow over it */
  const [scrolled, setScrolled] = useState(false);

  /** fill an empty active cell, otherwise insert below it */
  const insert = (source: string) => {
    const active = workspace.cells.find((c) => c.id === activeCellId);
    if (active && active.source.trim() === "") {
      setCellSource(active.id, source);
      setActiveCell(active.id);
    } else {
      addCell(source, active?.id ?? null);
    }
  };

  // Ctrl+Z / Ctrl+Shift+Z (or Ctrl+Y) step through the worksheet's edits anywhere but in dialogs and
  // the text fields outside the cells; the cells' own editors do the same (worksheetUndoKeys)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey || e.defaultPrevented) return;
      const key = e.key.toLowerCase();
      const back = key === "z" && !e.shiftKey;
      const forward = (key === "z" && e.shiftKey) || (key === "y" && !e.shiftKey);
      if (!back && !forward) return;
      const target = e.target instanceof HTMLElement ? e.target : null;
      if (target?.closest(".cm-editor") || document.querySelector(".modal-back")) return;
      if (target?.matches("input, textarea, [contenteditable='true']") && !target.closest(".cell-list")) return;
      e.preventDefault();
      if (back) undo();
      else redo();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undo, redo]);

  return (
    <>
      <div className={`pane-head ${scrolled ? "scrolled" : ""}`}>
        <span className="pane-count">{t("editor.column.cellCount", { count: workspace.cells.length })}</span>
        <div className="history-btns">
          <button className="icon-btn ghost" title={t("editor.column.undo")} disabled={!undoable} onClick={undo}>
            <Undo2 size={16} />
          </button>
          <button className="icon-btn ghost" title={t("editor.column.redo")} disabled={!redoable} onClick={redo}>
            <Redo2 size={16} />
          </button>
        </div>
        <div className="menu-anchor">
          <button
            className="icon-btn primary"
            title={t("editor.insertMenu.buttonTitle")}
            onClick={() => setMenuOpen((o) => !o)}
          >
            <Plus size={15} /> {t("editor.insertMenu.insert")}
          </button>
          {menuOpen && (
            <div className="menu insert-menu" onMouseLeave={() => setMenuOpen(false)}>
              {INSERT_OPTIONS.map((opt) => (
                <button
                  key={opt.labelKey}
                  onClick={() => {
                    insert(opt.make(usedNames(workspace.cells)));
                    setMenuOpen(false);
                  }}
                >
                  {opt.icon} {t(opt.labelKey)}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="cell-list" onScroll={(e) => setScrolled(e.currentTarget.scrollTop > 0)}>
        {workspace.cells.map((cell, i) => (
          <CellEditor key={cell.id} cell={cell} index={i} result={results[i]} />
        ))}

        <div
          className="cell ghost"
          title={t("editor.column.ghostCellTitle")}
          onClick={() => addCell("")}
        >
          <div className="cell-gutter">
            <span className="cell-index">{workspace.cells.length + 1}</span>
          </div>
        </div>
      </div>
    </>
  );
};
