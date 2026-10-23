import React from "react";
import { rich } from "../Rich";
import { useTranslation } from "react-i18next";
import {
  DisjointnessVerdict,
  EmptinessVerdict,
  EquivalenceVerdict,
  FinitenessVerdict,
  Pumping,
  pumpedWords,
  showWord,
  Verdict
} from "@automatalab/core/verdict";

export const VerdictView: React.FC<{ verdict: Verdict }> = ({ verdict }) => {
  switch (verdict.question) {
    case "equal":
      return <EquivalenceView verdict={verdict} />;
    case "empty":
      return <EmptinessView verdict={verdict} />;
    case "finite":
      return <FinitenessView verdict={verdict} />;
    case "disjoint":
      return <DisjointnessView verdict={verdict} />;
  }
};

const VerdictCard: React.FC<{ title: string; mark: string; heading: React.ReactNode; children: React.ReactNode }> = ({
  title,
  mark,
  heading,
  children
}) => (
  <div className="card">
    <div className="card-title">{title}</div>
    <div className="verdict-card">
      <div className="mark">{mark}</div>
      <h2>{heading}</h2>
      {children}
    </div>
  </div>
);

const Body: React.FC<{ children: React.ReactNode }> = ({ children }) => <p style={{ color: "var(--text-soft)" }}>{children}</p>;

const EquivalenceView: React.FC<{ verdict: EquivalenceVerdict }> = ({ verdict }) => {
  const { t } = useTranslation();
  return (
    <VerdictCard
      title={t("detail.verdict.equal.title")}
      mark={verdict.equal ? "🟰" : "≠"}
      heading={
        <>
          {rich(verdict.machineA)} {verdict.equal ? "≡" : "≢"} {rich(verdict.machineB)}
        </>
      }
    >
      {verdict.equal ? (
        <Body>
          {t("detail.verdict.equal.equalBody1")} <b>{t("detail.verdict.equal.equalEmphasis")}</b>
          {t("detail.verdict.equal.equalBody2")}
        </Body>
      ) : (
        <>
          <Body>
            {t("detail.verdict.equal.notEqualBody1")} <b>{t("detail.verdict.equal.notEqualEmphasis")}</b>
            {t("detail.verdict.equal.notEqualBody2")}
          </Body>
          <div className="ce">{verdict.counterexample!.word}</div>
          <p style={{ color: "var(--text-soft)", fontSize: 13.5 }}>
            {t("detail.verdict.equal.counterexample1")} <b>{rich(verdict.counterexample!.acceptedBy)}</b>
            {t("detail.verdict.equal.counterexample2")} <b>{rich(verdict.counterexample!.rejectedBy)}</b>
            {t("detail.verdict.equal.counterexample3")}
          </p>
        </>
      )}
    </VerdictCard>
  );
};

/** L(X), with the name's subscripts. */
const lang = (subject: string) => <>L({rich(subject)})</>;

const EmptinessView: React.FC<{ verdict: EmptinessVerdict }> = ({ verdict }) => {
  const { t } = useTranslation();
  return (
    <VerdictCard
      title={t("detail.verdict.empty.title")}
      mark={verdict.empty ? "∅" : "∃"}
      heading={
        <>
          {lang(verdict.subject)} {verdict.empty ? "=" : "≠"} ∅
        </>
      }
    >
      {verdict.empty ? (
        <Body>{t("detail.verdict.empty.emptyBody")}</Body>
      ) : (
        <>
          <Body>{t("detail.verdict.empty.notEmptyBody")}</Body>
          <div className="ce">{showWord(verdict.word!)}</div>
        </>
      )}
    </VerdictCard>
  );
};

const DisjointnessView: React.FC<{ verdict: DisjointnessVerdict }> = ({ verdict }) => {
  const { t } = useTranslation();
  return (
    <VerdictCard
      title={t("detail.verdict.disjoint.title")}
      mark={verdict.disjoint ? "∅" : "∩"}
      heading={
        <>
          {lang(verdict.machineA)} ∩ {lang(verdict.machineB)} {verdict.disjoint ? "=" : "≠"} ∅
        </>
      }
    >
      {verdict.disjoint ? (
        <Body>{t("detail.verdict.disjoint.disjointBody")}</Body>
      ) : (
        <>
          <Body>{t("detail.verdict.disjoint.notDisjointBody")}</Body>
          <div className="ce">{showWord(verdict.common!)}</div>
        </>
      )}
    </VerdictCard>
  );
};

const FinitenessView: React.FC<{ verdict: FinitenessVerdict }> = ({ verdict }) => {
  const { t } = useTranslation();
  const words = verdict.words ?? [];
  const more = verdict.finite ? BigInt(verdict.count!) - BigInt(words.length) : 0n;
  return (
    <VerdictCard
      title={t("detail.verdict.finite.title")}
      mark={verdict.finite ? "<∞" : "∞"}
      heading={
        <>
          {lang(verdict.subject)} {t(verdict.finite ? "detail.verdict.finite.isFinite" : "detail.verdict.finite.isInfinite")}
        </>
      }
    >
      {verdict.finite && words.length === 0 && <Body>{t("detail.verdict.finite.emptyBody")}</Body>}
      {verdict.finite && words.length > 0 && (
        <>
          <Body>
            {t(verdict.countExact ? "detail.verdict.finite.finiteBody" : "detail.verdict.finite.finiteBodyAtLeast", {
              count: verdict.count
            })}
          </Body>
          <div className="words verdict-words">
            {words.map((w) => (
              <span key={w} className="word-chip static">
                {showWord(w)}
              </span>
            ))}
          </div>
          {more > 0n && verdict.countExact && (
            <p style={{ color: "var(--muted)", fontSize: 13 }}>{t("detail.verdict.finite.moreWords", { count: more.toString() })}</p>
          )}
        </>
      )}
      {!verdict.finite && <PumpingView pumping={verdict.pumping!} />}
    </VerdictCard>
  );
};

/** The word cut into its parts, the pumped ones marked, and what pumping gives. */
const PumpingView: React.FC<{ pumping: Pumping }> = ({ pumping }) => {
  const { t } = useTranslation();
  const parts: [string, string, boolean][] =
    pumping.kind === "regular"
      ? [
          ["u", pumping.u, false],
          ["v", pumping.v, true],
          ["w", pumping.w, false]
        ]
      : [
          ["u", pumping.u, false],
          ["v", pumping.v, true],
          ["w", pumping.w, false],
          ["x", pumping.x, true],
          ["y", pumping.y, false]
        ];
  return (
    <>
      <Body>{t("detail.verdict.finite.infiniteBody")}</Body>
      <div className="pump-parts">
        {parts.map(([label, text, pumped]) => (
          <span key={label} className={`pump-part${pumped ? " pumped" : ""}`}>
            <span className="pump-text">{showWord(text)}</span>
            <span className="pump-label">{label}</span>
          </span>
        ))}
      </div>
      <p style={{ color: "var(--text-soft)", fontSize: 13.5 }}>
        {t(pumping.kind === "regular" ? "detail.verdict.finite.pumpedRegular" : "detail.verdict.finite.pumpedContextFree")}
      </p>
      <div className="words verdict-words">
        {pumpedWords(pumping).map((w, k) => (
          <span key={k} className="word-chip static">
            {showWord(w)}
          </span>
        ))}
        <span style={{ color: "var(--muted)" }}>…</span>
      </div>
    </>
  );
};
