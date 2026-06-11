import React, { useState } from "react";
import { Workspace, useAppStore } from "../../state/store";
import { CellResult } from "../../core/workspace";
import { CellEditor } from "./CellEditor";
import { CELL_TEMPLATES } from "../../state/examples";
import { Boxes, Braces, CircleDot, FunctionSquare, Layers, Plus, Regex, SquareStack } from "lucide-react";

interface Props {
  workspace: Workspace;
  results: CellResult[];
}

/** Foglalt nevek a munkalapon (definíciók + értékadások). */
function usedNames(ws: Workspace): Set<string> {
  const used = new Set<string>();
  for (const c of ws.cells) {
    const def = /^\s*name:\s*([A-Za-z][A-Za-z0-9_'′]*)/m.exec(c.source);
    if (def) used.add(def[1]);
    const asg = /^\s*([A-Za-z][A-Za-z0-9_'′]*)\s*=/.exec(c.source);
    if (asg) used.add(asg[1]);
  }
  return used;
}

function uniqueName(base: string, used: Set<string>): string {
  if (!used.has(base)) return base;
  let i = 2;
  while (used.has(`${base}${i}`)) i++;
  return `${base}${i}`;
}

interface InsertOption {
  label: string;
  icon: React.ReactNode;
  /** sablon a {NAME} helyére kerülő egyedi névvel */
  make: (used: Set<string>) => string;
}

/** A gépek erősorrendben, utána nyelvtan, regex, végül a szabad kifejezés. */
const INSERT_OPTIONS: InsertOption[] = [
  {
    label: "Véges automata",
    icon: <CircleDot size={15} />,
    make: (used) => CELL_TEMPLATES.fsm.replace("name: M", `name: ${uniqueName("M", used)}`)
  },
  {
    label: "Veremautomata",
    icon: <Layers size={15} />,
    make: (used) => CELL_TEMPLATES.pda.replace("name: P", `name: ${uniqueName("P", used)}`)
  },
  {
    label: "Turing-gép",
    icon: <SquareStack size={15} />,
    make: (used) => CELL_TEMPLATES.tm.replace("name: T", `name: ${uniqueName("T", used)}`)
  },
  {
    label: "Egyedi gép (tárolókkal)",
    icon: <Boxes size={15} />,
    make: (used) => CELL_TEMPLATES.machine.replace("name: Gep", `name: ${uniqueName("Gep", used)}`)
  },
  {
    label: "Nyelvtan",
    icon: <Braces size={15} />,
    make: (used) => CELL_TEMPLATES.grammar.replace("name: G", `name: ${uniqueName("G", used)}`)
  },
  {
    label: "Reguláris kifejezés",
    icon: <Regex size={15} />,
    make: (used) => `${uniqueName("R", used)} = regex()`
  },
  { label: "Kifejezés / művelet", icon: <FunctionSquare size={15} />, make: () => "" }
];

export const EditorColumn: React.FC<Props> = ({ workspace, results }) => {
  const addCell = useAppStore((s) => s.addCell);
  const setCellSource = useAppStore((s) => s.setCellSource);
  const setActiveCell = useAppStore((s) => s.setActiveCell);
  const [menuOpen, setMenuOpen] = useState(false);

  /** az első üres cellát tölti ki; ha nincs, a lista végére kerül */
  const insert = (source: string) => {
    const empty = workspace.cells.find((c) => c.source.trim() === "");
    if (empty) {
      setCellSource(empty.id, source);
      setActiveCell(empty.id);
    } else {
      addCell(source);
    }
  };

  return (
    <>
      <div className="pane-head">
        <span className="pane-title">{workspace.name}</span>
        <span className="pane-count">{workspace.cells.length} cella</span>
        <span className="spacer" />
        <div className="menu-anchor">
          <button
            className="icon-btn primary"
            title="Új cella beszúrása — válaszd ki, mit szeretnél"
            onClick={() => setMenuOpen((o) => !o)}
          >
            <Plus size={15} /> Beszúrás
          </button>
          {menuOpen && (
            <div className="menu insert-menu" onMouseLeave={() => setMenuOpen(false)}>
              {INSERT_OPTIONS.map((opt) => (
                <button
                  key={opt.label}
                  onClick={() => {
                    insert(opt.make(usedNames(workspace)));
                    setMenuOpen(false);
                  }}
                >
                  <span className="ins-icon">{opt.icon}</span> {opt.label}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="cell-list">
        {workspace.cells.map((cell, i) => (
          <CellEditor key={cell.id} cell={cell} index={i} result={results[i]} />
        ))}

        <div
          className="cell ghost"
          title="Kattints új cellához (Alt+Enter is működik)"
          onClick={() => addCell("")}
        >
          <div className="cell-gutter">
            <span className="cell-index">{workspace.cells.length + 1}</span>
          </div>
          <div className="ghost-line" />
        </div>
      </div>
    </>
  );
};
