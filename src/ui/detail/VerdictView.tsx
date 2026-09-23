import React from "react";
import { useTranslation } from "react-i18next";
import { EquivalenceVerdict } from "../../core/fsm/ops";

export const VerdictView: React.FC<{ verdict: EquivalenceVerdict }> = ({ verdict }) => {
  const { t } = useTranslation();
  return (
    <div className="card">
      <div className="card-title">{t("detail.verdict.title")}</div>
      <div className="verdict-card">
        <div className="mark">{verdict.equal ? "🟰" : "≠"}</div>
        <h2>
          {verdict.machineA} {verdict.equal ? "≡" : "≢"} {verdict.machineB}
        </h2>
        {verdict.equal ? (
          <p style={{ color: "var(--text-soft)" }}>
            {t("detail.verdict.equalBody1")} <b>{t("detail.verdict.equalEmphasis")}</b>
            {t("detail.verdict.equalBody2")}
          </p>
        ) : (
          <>
            <p style={{ color: "var(--text-soft)" }}>
              {t("detail.verdict.notEqualBody1")} <b>{t("detail.verdict.notEqualEmphasis")}</b>
              {t("detail.verdict.notEqualBody2")}
            </p>
            <div className="ce">{verdict.counterexample!.word}</div>
            <p style={{ color: "var(--text-soft)", fontSize: 13.5 }}>
              {t("detail.verdict.counterexample1")} <b>{verdict.counterexample!.acceptedBy}</b>
              {t("detail.verdict.counterexample2")}{" "}
              <b>{verdict.counterexample!.rejectedBy}</b>
              {t("detail.verdict.counterexample3")}
            </p>
          </>
        )}
      </div>
    </div>
  );
};
