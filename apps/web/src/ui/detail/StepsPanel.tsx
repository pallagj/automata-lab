import React from "react";
import { rich } from "../Rich";
import { useTranslation } from "react-i18next";
import { OpDefinition, StepGroup } from "@automatalab/core/expr/expression";
import { AlgoStep } from "@automatalab/core/types";
import { tr } from "@automatalab/core/i18n/translate";
import { ChevronRight, ListTree } from "lucide-react";

const Step: React.FC<{ step: AlgoStep }> = ({ step }) => {
  const { t } = useTranslation();
  return (
  <div className="step">
    <div className="step-title">{rich(tr(t, step.title))}</div>
    {step.detail && <div className="step-detail">{rich(tr(t, step.detail))}</div>}
    {step.table && (
      <div className="t-wrap">
        <table className="t">
          <thead>
            <tr>
              {step.table.headers.map((h, i) => (
                <th key={i}>{rich(tr(t, h))}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {step.table.rows.map((row, i) => (
              <tr key={i}>
                {row.map((c, j) => (
                  <td key={j}>{rich(c)}</td>
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

/** What an operation means — input, output and what it guarantees — set apart before its steps. */
const DefinitionBox: React.FC<{ group: StepGroup; definition: OpDefinition }> = ({ group, definition }) => {
  const { t } = useTranslation();
  const params = { op: group.operation, a: definition.args[0] ?? "", b: definition.args[1] ?? "" };
  const text = (field: string) => rich(t(`definition.${definition.id}.${field}`, { ns: "core", ...params }));
  // an operation done in two ways has one name: union.product and union.epsilon are both a union
  const name = t(`opNames.${definition.id.split(".")[0]}`, { ns: "core" });
  return (
    <div className="definition">
      <div className="definition-head">
        <span className="definition-label">{t("detail.definition.label")}</span>
        <span className="definition-name">{name}</span>
        <code className="definition-op">{rich(group.operation)}</code>
      </div>
      <div className="definition-summary">{text("summary")}</div>
      <dl className="definition-terms">
        <dt>{t("detail.definition.input")}</dt>
        <dd>{text("input")}</dd>
        <dt>{t("detail.definition.output")}</dt>
        <dd>{text("output")}</dd>
        <dt>{t("detail.definition.guarantee")}</dt>
        <dd className="definition-guarantee">{text("guarantee")}</dd>
      </dl>
    </div>
  );
};

/** The step list's content — usable both in a card and in a floating panel. */
export const StepsContent: React.FC<{ stepGroups: StepGroup[] }> = ({ stepGroups }) => (
  <>
    {stepGroups.map((g, i) => (
      <div key={i}>
        {g.definition ? (
          <DefinitionBox group={g} definition={g.definition} />
        ) : (
          stepGroups.length > 1 && <div className="step-op">{g.operation}</div>
        )}
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
