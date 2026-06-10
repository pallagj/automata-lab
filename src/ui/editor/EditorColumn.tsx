import React, { useState } from "react";
import { Workspace, useAppStore } from "../../state/store";
import { CellResult } from "../../core/workspace";
import { CellEditor } from "./CellEditor";
import { EXAMPLES } from "../../state/examples";
import { Plus, Sparkles } from "lucide-react";

interface Props {
  workspace: Workspace;
  results: CellResult[];
}

export const EditorColumn: React.FC<Props> = ({ workspace, results }) => {
  const addCell = useAppStore((s) => s.addCell);
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <>
      {workspace.cells.map((cell, i) => (
        <CellEditor key={cell.id} cell={cell} index={i} result={results[i]} />
      ))}

      <div className="add-cell-row">
        <button className="icon-btn primary" onClick={() => addCell("")}>
          <Plus size={15} /> Új cella
        </button>
        <button className="icon-btn" onClick={() => setMenuOpen((o) => !o)}>
          <Sparkles size={15} /> Példák
        </button>
        {menuOpen && (
          <div className="menu" onMouseLeave={() => setMenuOpen(false)}>
            {[...new Set(EXAMPLES.map((e) => e.group))].map((group) => (
              <React.Fragment key={group}>
                <div className="menu-group">{group}</div>
                {EXAMPLES.filter((e) => e.group === group).map((e) => (
                  <button
                    key={e.title}
                    onClick={() => {
                      addCell(e.source);
                      setMenuOpen(false);
                    }}
                  >
                    {e.title}
                  </button>
                ))}
              </React.Fragment>
            ))}
          </div>
        )}
      </div>
    </>
  );
};
