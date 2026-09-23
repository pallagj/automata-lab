import React from "react";
import { useTranslation } from "react-i18next";
import { Diagnostic } from "../../core/types";
import { tr } from "../../i18n/translate";
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
