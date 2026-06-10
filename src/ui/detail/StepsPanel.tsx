import React from "react";
import { StepGroup } from "../../core/expr/expression";
import { AlgoStep } from "../../core/types";
import { ChevronRight, ListTree } from "lucide-react";

const Step: React.FC<{ step: AlgoStep }> = ({ step }) => (
  <div className="step">
    <div className="step-title">{step.title}</div>
    {step.detail && <div className="step-detail">{step.detail}</div>}
    {step.table && (
      <div className="t-wrap">
        <table className="t">
          <thead>
            <tr>
              {step.table.headers.map((h, i) => (
                <th key={i}>{h}</th>
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

export const StepsPanel: React.FC<{ stepGroups: StepGroup[] }> = ({ stepGroups }) => {
  if (stepGroups.length === 0) return null;
  return (
    <details className="card" open={stepGroups.length === 1}>
      <summary className="card-title">
        <ListTree size={15} />
        Hogyan készült? — az algoritmus lépései
        <ChevronRight size={15} className="chev" />
      </summary>
      <div className="card-body">
        {stepGroups.map((g, i) => (
          <div key={i}>
            {stepGroups.length > 1 && <div className="step-op">{g.operation}</div>}
            {g.steps.map((s, j) => (
              <Step key={j} step={s} />
            ))}
          </div>
        ))}
      </div>
    </details>
  );
};
