import React from "react";
import { rich } from "../Rich";
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
          {rich(verdict.machineA)} {verdict.equal ? "≡" : "≢"} {rich(verdict.machineB)}
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
              {t("detail.verdict.counterexample1")} <b>{rich(verdict.counterexample!.acceptedBy)}</b>
              {t("detail.verdict.counterexample2")}{" "}
              <b>{rich(verdict.counterexample!.rejectedBy)}</b>
              {t("detail.verdict.counterexample3")}
            </p>
          </>
        )}
      </div>
    </div>
  );
};
