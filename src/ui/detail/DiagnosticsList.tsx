import React from "react";
import { useTranslation } from "react-i18next";
import { Diagnostic } from "../../core/types";
import { tr } from "../../i18n/translate";
import { activeWorkspace, useAppStore } from "../../state/store";
import { StagePanel } from "./Stage";
import { AlertTriangle, Info, Wand2, XCircle } from "lucide-react";

interface Props {
  diagnostics: Diagnostic[];
  onApplyFix?: (code: string) => void;
}

const ICONS = {
  error: <XCircle size={16} />,
  warning: <AlertTriangle size={16} />,
  info: <Info size={16} />
};

export const DiagnosticsList: React.FC<Props> = ({ diagnostics, onApplyFix }) => {
  const { t } = useTranslation();
  if (diagnostics.length === 0) return null;
  return (
    <div>
      {diagnostics.map((d, i) => (
        <div key={i} className={`diag ${d.level}`}>
          <span className="diag-icon">{ICONS[d.level]}</span>
          <div className="diag-body">
            <div className="diag-title">{tr(t, d.title)}</div>
            {d.detail && <div className="diag-detail">{tr(t, d.detail)}</div>}
            {d.fix && onApplyFix && (
              <button className="fix-btn" onClick={() => onApplyFix(d.fix!.code)} title={tr(t, d.fix.label)}>
                <Wand2 size={13} />
                {d.fix.code}
              </button>
            )}
          </div>
        </div>
      ))}
    </div>
  );
};

/** A suggested fix replaces the active cell's expression, keeping its `name =` prefix. */
export function useApplyFix(): (code: string) => void {
  const activeCellId = useAppStore((s) => s.activeCellId);
  const setCellSource = useAppStore((s) => s.setCellSource);
  const ws = useAppStore(activeWorkspace);
  return (code: string) => {
    const cell = ws.cells.find((c) => c.id === activeCellId);
    if (!cell) return;
    const asg = /^\s*([A-Za-z][A-Za-z0-9_'′]*)\s*=/.exec(cell.source);
    setCellSource(cell.id, asg ? `${asg[1]} = ${code}` : code);
  };
}

/** The notes of an evaluated cell (infos, warnings) — the gutter only flags problems, so they are read here. */
export const ResultNotes: React.FC<{ diagnostics: Diagnostic[] }> = ({ diagnostics }) => {
  const applyFix = useApplyFix();
  return <DiagnosticsList diagnostics={diagnostics} onApplyFix={applyFix} />;
};

/** The notes as a floating panel on a machine's canvas; collapsed, so it never covers the graph unasked. */
export function notesPanel(diagnostics: Diagnostic[] | undefined, title: string): StagePanel | null {
  if (!diagnostics || diagnostics.length === 0) return null;
  return {
    key: "notes",
    title: (
      <>
        <Info size={14} /> {title} <span className="panel-count">{diagnostics.length}</span>
      </>
    ),
    content: <ResultNotes diagnostics={diagnostics} />
  };
}
