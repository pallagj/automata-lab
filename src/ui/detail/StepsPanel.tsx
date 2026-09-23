import React from "react";
import { useTranslation } from "react-i18next";
import { StepGroup } from "../../core/expr/expression";
import { AlgoStep } from "../../core/types";
import { tr } from "../../i18n/translate";
import { ChevronRight, ListTree } from "lucide-react";

const Step: React.FC<{ step: AlgoStep }> = ({ step }) => {
  const { t } = useTranslation();
  return (
  <div className="step">
    <div className="step-title">{tr(t, step.title)}</div>
    {step.detail && <div className="step-detail">{tr(t, step.detail)}</div>}
    {step.table && (
      <div className="t-wrap">
        <table className="t">
          <thead>
            <tr>
              {step.table.headers.map((h, i) => (
                <th key={i}>{tr(t, h)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {step.table.rows.map((row, i) => (
              <tr key={i}>
                {row.map((c, j) => (
                  <td key={j}>{c}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )}
  </div>
  );
};

/** A lépéslista tartalma — kártyában és lebegő panelben is használható. */
export const StepsContent: React.FC<{ stepGroups: StepGroup[] }> = ({ stepGroups }) => (
  <>
    {stepGroups.map((g, i) => (
      <div key={i}>
        {stepGroups.length > 1 && <div className="step-op">{g.operation}</div>}
        {g.steps.map((s, j) => (
          <Step key={j} step={s} />
        ))}
      </div>
    ))}
  </>
);

export const StepsPanel: React.FC<{ stepGroups: StepGroup[] }> = ({ stepGroups }) => {
  const { t } = useTranslation();
  if (stepGroups.length === 0) return null;
  return (
    <details className="card" open={stepGroups.length === 1}>
      <summary className="card-title">
        <ListTree size={15} />
        {t("detail.stepsPanel.title")}
        <ChevronRight size={15} className="chev" />
      </summary>
      <div className="card-body">
        <StepsContent stepGroups={stepGroups} />
      </div>
    </details>
  );
};
