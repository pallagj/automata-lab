import React, { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  classify,
  generateWords,
  Grammar,
  grammarAccepts,
  ruleToString
} from "../../core/grammar/grammar";
import { activeWorkspace, useAppStore } from "../../state/store";
import { uniqueName, usedNames } from "../../state/names";
import { tr } from "../../i18n/translate";
import { Check, ChevronRight, HelpCircle, ListOrdered, Wand2, X } from "lucide-react";

const TYPE_KEYS: Record<number, string> = {
  3: "detail.grammar.type3",
  2: "detail.grammar.type2",
  1: "detail.grammar.type1",
  0: "detail.grammar.type0"
};

export const GrammarView: React.FC<{ grammar: Grammar }> = ({ grammar }) => {
  const { t } = useTranslation();
  const cls = useMemo(() => classify(grammar), [grammar]);
  const gen = useMemo(() => generateWords(grammar, 8, 36), [grammar]);
  const addCell = useAppStore((s) => s.addCell);
  const activeCellId = useAppStore((s) => s.activeCellId);
  const ensureCellName = useAppStore((s) => s.ensureCellName);

  /** inserts `<prefix>_G = fn(G)` below; an unnamed grammar gets a name first */
  const convert = (fn: "toFsm" | "toPda", prefix: string) => {
    if (!activeCellId) return;
    const source = grammar.name || ensureCellName(activeCellId, "G");
    const used = usedNames(activeWorkspace(useAppStore.getState()).cells);
    addCell(`${uniqueName(`${prefix}_${source}`, used)} = ${fn}(${source})`, activeCellId);
  };

  const [test, setTest] = useState("");
  const testResult = useMemo(
    () => (test === "" ? null : grammarAccepts(grammar, test)),
    [grammar, test]
  );
  const [openDerivation, setOpenDerivation] = useState<string | null>(null);

  const byLeft = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const r of grammar.rules) {
      if (!m.has(r.left)) m.set(r.left, []);
      m.get(r.left)!.push(r.right === "" ? "ε" : r.right);
    }
    return m;
  }, [grammar]);

  return (
    <>
      <div className="card">
        <div className="card-title">
          {t("detail.grammar.title")}
          {grammar.name && ` — ${grammar.name}`}
        </div>
        <div className="card-body">
          <div className="class-hero">
            <span className="big">{t(TYPE_KEYS[cls.type])}</span>
            <span
              className={`badge ${cls.epsilonFree ? "ok" : "warn"}`}
              title={cls.epsilonIssues.length > 0 ? cls.epsilonIssues.map((i) => tr(t, i)).join("; ") : t("detail.grammar.epsilonFreeHint")}
            >
              {cls.epsilonFree ? t("detail.grammar.epsilonFreeForm") : t("detail.grammar.epsilonRuled")}
            </span>
            {cls.type === 3 && (
              <span className="badge accent">{cls.direction === "right" ? t("detail.grammar.rightLinear") : t("detail.grammar.leftLinear")}</span>
            )}
          </div>

          <div className="class-grid">
            <span className="lvl" style={{ color: cls.reasons.type3.holds ? "var(--success)" : "var(--muted)" }}>
              {cls.reasons.type3.holds ? "✓" : "✗"} {t("detail.grammar.type3Short")}
            </span>
            <span className="why">
              {cls.reasons.type3.holds
                ? t("detail.grammar.type3Holds")
                : cls.reasons.type3.violations[0] ? tr(t, cls.reasons.type3.violations[0]) : t("detail.grammar.notLinear")}
            </span>
            <span className="lvl" style={{ color: cls.reasons.type2.holds ? "var(--success)" : "var(--muted)" }}>
              {cls.reasons.type2.holds ? "✓" : "✗"} {t("detail.grammar.type2Short")}
            </span>
            <span className="why">
              {cls.reasons.type2.holds
                ? t("detail.grammar.type2Holds")
                : tr(t, cls.reasons.type2.violations[0])}
            </span>
            <span className="lvl" style={{ color: cls.reasons.type1.holds ? "var(--success)" : "var(--muted)" }}>
              {cls.reasons.type1.holds ? "✓" : "✗"} {t("detail.grammar.type1Short")}
            </span>
            <span className="why">
              {cls.reasons.type1.holds
                ? t("detail.grammar.type1Holds")
                : tr(t, cls.reasons.type1.violations[0])}
            </span>
          </div>

          <div className="badges" style={{ marginTop: 14 }}>
            {cls.type === 3 && cls.direction === "right" && (
              <button className="icon-btn" onClick={() => convert("toFsm", "M")}>
                <Wand2 size={14} /> {t("detail.grammar.toFsm")}
              </button>
            )}
            {cls.reasons.type2.holds && (
              <button className="icon-btn" onClick={() => convert("toPda", "P")}>
                <Wand2 size={14} /> {t("detail.grammar.toPda")}
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-title">{t("detail.grammar.rules")}</div>
        <div className="card-body rule-list">
          {[...byLeft.entries()].map(([left, rights]) => (
            <div key={left}>
              <span className="nt">{left}</span> → {rights.join(" | ")}
            </div>
          ))}
          <div style={{ marginTop: 6, fontSize: 12.5, color: "var(--muted)", fontFamily: "var(--font-sans)" }}>
            {t("detail.grammar.startSymbol")}: {grammar.start} · {t("detail.grammar.terminals")}: {grammar.terminals.join(", ")} · {t("detail.grammar.nonterminals")}:{" "}
            {grammar.nonterminals.join(", ")}
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-title">
          <HelpCircle size={15} />
          {t("detail.grammar.isDerivable")}
        </div>
        <div className="card-body">
          <div className="sim-row">
            <input
              className="sim-input"
              value={test}
              placeholder={t("detail.grammar.testPlaceholder")}
              onChange={(e) => setTest(e.target.value)}
              spellCheck={false}
            />
            {testResult && (
              <span
                className={`verdict-pill ${
                  testResult.verdict === "yes" ? "accepted" : testResult.verdict === "no" ? "rejected" : "limit"
                }`}
              >
                {testResult.verdict === "yes" && (
                  <>
                    <Check size={15} /> {t("detail.grammar.derivable")}
                  </>
                )}
                {testResult.verdict === "no" && (
                  <>
                    <X size={15} /> {t("detail.grammar.notDerivable")}
                  </>
                )}
                {testResult.verdict === "unknown" && <>{t("detail.grammar.undecidedWithinLimit")}</>}
              </span>
            )}
          </div>
          {testResult?.derivation && (
            <div className="derivation">
              {testResult.derivation.map((f, i) => (
                <span key={i}>
                  {i > 0 && " ⇒ "}
                  {i === testResult.derivation!.length - 1 ? <b>{f || "ε"}</b> : f || "ε"}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>

      <details className="card" open>
        <summary className="card-title">
          <ListOrdered size={15} />
          {t("detail.grammar.generatedWords", { count: gen.words.length, plus: gen.exhaustive ? "" : "+" })}
          <ChevronRight size={15} className="chev" />
        </summary>
        <div className="card-body">
          <div className="words">
            {gen.words.map((w) => (
              <button
                key={w.word}
                className="word-chip"
                title={t("detail.grammar.clickForDerivation")}
                onClick={() => setOpenDerivation(openDerivation === w.word ? null : w.word)}
              >
                {w.word === "" ? "ε" : w.word}
              </button>
            ))}
            {gen.words.length === 0 && (
              <span style={{ color: "var(--muted)" }}>{t("detail.grammar.noDerivableWords")}</span>
            )}
          </div>
          {openDerivation !== null &&
            (() => {
              const w = gen.words.find((x) => x.word === openDerivation);
              if (!w) return null;
              return (
                <div className="derivation">
                  {w.derivation.map((f, i) => (
                    <span key={i}>
                      {i > 0 && " ⇒ "}
                      {i === w.derivation.length - 1 ? <b>{f || "ε"}</b> : f || "ε"}
                    </span>
                  ))}
                </div>
              );
            })()}
          {!gen.exhaustive && (
            <div style={{ marginTop: 8, fontSize: 12.5, color: "var(--muted)" }}>
              {t("detail.grammar.moreWordsPossible")}
            </div>
          )}
        </div>
      </details>
    </>
  );
};
