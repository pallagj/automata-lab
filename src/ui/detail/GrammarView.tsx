import React, { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  classify,
  generateWords,
  Grammar,
  grammarAccepts,
  ruleToString
} from "../../core/grammar/grammar";
import { cykAnimation, cykMembership, cykOrder, Membership } from "../../core/grammar/cyk";
import { decideEmptyGrammar, decideFiniteGrammar } from "../../core/grammar/decide";
import { LanguageSummary } from "../../core/fsm/decide";
import { LanguageNote } from "./LanguageNote";
import { showSymbols, withSubscript } from "../../core/symbols";
import { rich } from "../Rich";
import { isCNF } from "../../core/grammar/normalForm";
import { activeWorkspace, useAppStore } from "../../state/store";
import { uniqueName, usedNames } from "../../state/names";
import { tr } from "../../i18n/translate";
import { PlayerBar, usePlayer } from "./AnimationPlayer";
import { epsilonChange, typedWord } from "../editor/epsilon";
import { Check, ChevronRight, Clapperboard, Grid3x3, HelpCircle, ListOrdered, Wand2, X } from "lucide-react";

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
  // a context-free grammar: exactly whether its language is empty or finite, and how large
  const facts = useMemo((): LanguageSummary | null => {
    if (!cls.contextFreeForm) return null;
    if (decideEmptyGrammar(grammar).value!.empty) return { words: [], empty: true, finite: true, count: 0, countExact: true };
    const v = decideFiniteGrammar(grammar).value!;
    return { words: [], empty: false, finite: v.finite, count: v.finite ? Number(v.count) : undefined, countExact: v.countExact };
  }, [grammar, cls]);
  const allShown = facts ? facts.finite && facts.countExact && facts.count === gen.words.length : gen.exhaustive;
  const addCell = useAppStore((s) => s.addCell);
  const activeCellId = useAppStore((s) => s.activeCellId);
  const ensureCellName = useAppStore((s) => s.ensureCellName);

  /** inserts `<prefix>_G = fn(G)` below; an unnamed grammar gets a name first */
  const convert = (fn: "toFsm" | "toPda" | "epsfree", prefix: string) => {
    if (!activeCellId) return;
    const source = grammar.name || ensureCellName(activeCellId, "G");
    const used = usedNames(activeWorkspace(useAppStore.getState()).cells);
    addCell(`${uniqueName(withSubscript(prefix, source), used)} = ${fn}(${source})`, activeCellId);
  };

  const [test, setTest] = useState("");
  const word = typedWord(test);
  // context-free: an exact decision with CYK; otherwise a bounded search for a derivation
  const membership = useMemo(
    () => (word === null || !cls.contextFreeForm ? null : cykMembership(grammar, word).value!),
    [grammar, word, cls]
  );
  const testResult = useMemo(() => {
    if (word === null) return null;
    if (!membership) return grammarAccepts(grammar, word);
    // a derivation to show, when the bounded search finds one
    const search = membership.accepted ? grammarAccepts(grammar, word) : null;
    return {
      verdict: membership.accepted ? ("yes" as const) : ("no" as const),
      derivation: search?.verdict === "yes" ? search.derivation : undefined
    };
  }, [grammar, word, membership]);
  const cnfForm = useMemo(() => isCNF(grammar), [grammar]);
  const [openDerivation, setOpenDerivation] = useState<string | null>(null);

  const byLeft = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const r of grammar.rules) {
      const left = showSymbols(r.left);
      if (!m.has(left)) m.set(left, []);
      m.get(left)!.push(showSymbols(r.right));
    }
    return m;
  }, [grammar]);

  return (
    <>
      <div className="card">
        <div className="card-title">
          {t("detail.grammar.title")}
          {grammar.name && <> — {rich(grammar.name)}</>}
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
            {cnfForm && <span className="badge accent">{t("detail.grammar.cnfBadge")}</span>}
          </div>

          <div className="class-grid">
            <span className="lvl" style={{ color: cls.reasons.type3.holds ? "var(--success)" : "var(--muted)" }}>
              {cls.reasons.type3.holds ? "✓" : "✗"} {t("detail.grammar.type3Short")}
            </span>
            <span className="why">
              {cls.reasons.type3.holds
                ? t("detail.grammar.type3Holds")
                : rich(tr(t, cls.reasons.type3.violations[0]))}
            </span>
            <span className="lvl" style={{ color: cls.reasons.type2.holds ? "var(--success)" : "var(--muted)" }}>
              {cls.reasons.type2.holds ? "✓" : "✗"} {t("detail.grammar.type2Short")}
            </span>
            <span className="why">
              {cls.reasons.type2.holds
                ? t("detail.grammar.type2Holds")
                : rich(tr(t, cls.reasons.type2.violations[0]))}
            </span>
            <span className="lvl" style={{ color: cls.reasons.type1.holds ? "var(--success)" : "var(--muted)" }}>
              {cls.reasons.type1.holds ? "✓" : "✗"} {t("detail.grammar.type1Short")}
            </span>
            <span className="why">
              {cls.reasons.type1.holds
                ? t("detail.grammar.type1Holds")
                : rich(tr(t, cls.reasons.type1.violations[0]))}
            </span>
          </div>

          {/* what still follows about the language when the grammar's own class is lower */}
          {(() => {
            const notes: { key: string; fix?: React.ReactNode }[] = [];
            if (cls.type < 2 && cls.contextFreeForm)
              notes.push({
                key: "detail.grammar.notes.contextFreeForm",
                fix: (
                  <button className="icon-btn" onClick={() => convert("epsfree", "E")}>
                    <Wand2 size={14} /> {t("detail.grammar.toEpsilonFree")}
                  </button>
                )
              });
            if (cls.type < 3 && cls.rightLinear) notes.push({ key: "detail.grammar.notes.rightLinear" });
            if (cls.type < 3 && cls.leftLinear && !cls.rightLinear) notes.push({ key: "detail.grammar.notes.leftLinear" });
            if (cls.type < 1 && cls.nonContracting) notes.push({ key: "detail.grammar.notes.nonContracting" });
            if (notes.length === 0) return null;
            return (
              <div className="class-notes" style={{ marginTop: 12, display: "grid", gap: 8, fontSize: 13 }}>
                {notes.map((n) => (
                  <div key={n.key}>
                    {rich(t(n.key))}
                    {n.fix && <div style={{ marginTop: 6 }}>{n.fix}</div>}
                  </div>
                ))}
              </div>
            );
          })()}

          <div className="badges" style={{ marginTop: 14 }}>
            {cls.rightLinear && (
              <button className="icon-btn" onClick={() => convert("toFsm", "M")}>
                <Wand2 size={14} /> {t("detail.grammar.toFsm")}
              </button>
            )}
            {cls.contextFreeForm && (
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
              <span className="nt">{rich(left)}</span> → {rich(rights.join(" | "))}
            </div>
          ))}
          <div style={{ marginTop: 6, fontSize: 12.5, color: "var(--muted)", fontFamily: "var(--font-sans)" }}>
            {t("detail.grammar.startSymbol")}: {rich(grammar.start)} · {t("detail.grammar.terminals")}: {grammar.terminals.join(", ")} · {t("detail.grammar.nonterminals")}:{" "}
            {rich(grammar.nonterminals.join(", "))}
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
              onChange={(e) => epsilonChange(e, setTest)}
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
          {membership && (
            <div style={{ marginTop: 6, fontSize: 12.5, color: "var(--muted)" }}>{t("detail.grammar.exact")}</div>
          )}
          {testResult?.derivation && (
            <div className="derivation">
              {testResult.derivation.map((f, i) => (
                <span key={i}>
                  {i > 0 && " ⇒ "}
                  {i === testResult.derivation!.length - 1 ? <b>{f || "ε"}</b> : rich(f || "ε")}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>

      {membership?.table && <CykCard membership={membership} grammarName={grammar.name || "G"} epsilonFree={cls.epsilonFree} />}

      <details className="card" open>
        <summary className="card-title">
          <ListOrdered size={15} />
          {t("detail.grammar.generatedWords", { count: gen.words.length, plus: allShown ? "" : "+" })}
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
            {gen.words.length === 0 && !facts && (
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
                      {i === w.derivation.length - 1 ? <b>{f || "ε"}</b> : rich(f || "ε")}
                    </span>
                  ))}
                </div>
              );
            })()}
          {facts ? (
            <LanguageNote summary={facts} shownCount={gen.words.length} emptyKey="detail.language.emptyGrammar" />
          ) : (
            !gen.exhaustive && (
              <div style={{ marginTop: 8, fontSize: 12.5, color: "var(--muted)" }}>
                {t("detail.grammar.moreWordsPossible")}
              </div>
            )
          )}
        </div>
      </details>
    </>
  );
};

/** The CYK triangle as in the lecture notes: the longest subword on top, the letters below. */
const CykCard: React.FC<{ membership: Membership; grammarName: string; epsilonFree: boolean }> = ({
  membership,
  grammarName,
  epsilonFree
}) => {
  const { t } = useTranslation();
  const { table, cnf, converted } = membership;
  // the clicked cell, [length − 1, start]: its variables and how each got there
  const [picked, setPicked] = useState<[number, number] | null>(null);
  // the table filling in, cell by cell
  const frames = useMemo(() => (table && cnf ? cykAnimation(cnf, table) : []), [table, cnf]);
  const [animating, setAnimating] = useState(false);
  useEffect(() => setAnimating(false), [frames]);
  const player = usePlayer(frames, animating);
  const played = animating ? frames[player.index] : undefined;
  if (!table || !cnf) return null;
  const n = table.word.length;
  const at = (cells: [number, number][] | undefined, j: number, i: number) =>
    !!cells?.some(([a, b]) => a === j && b === i);
  const expr = epsilonFree ? `cnf(${grammarName})` : `cnf(epsfree(${grammarName}))`;
  const rules = new Map<string, string[]>();
  for (const r of cnf.rules) rules.set(r.left[0], [...(rules.get(r.left[0]) ?? []), showSymbols(r.right)]);
  return (
    <div className="card">
      <div className="card-title">
        <Grid3x3 size={15} />
        {t("detail.grammar.cykTitle")}
      </div>
      <div className="card-body">
        <div className="cyk-note">{t("detail.grammar.cykIntro")}</div>
        {converted && (
          <div className="cyk-note">
            {t("detail.grammar.cykConverted", { expr })}
            <div className="cyk-rules">
              {[...rules].map(([left, rights]) => (
                <span key={left}>{rich(`${left} → ${rights.join(" | ")}`)}</span>
              ))}
            </div>
          </div>
        )}
        {!animating && (
          <button className="anim-start" onClick={() => setAnimating(true)} title={t("detail.grammar.cykPlayHint")}>
            <Clapperboard size={14} /> {t("detail.anim.start")}
          </button>
        )}
        <div className="t-wrap">
          <table className="t cyk">
            <tbody>
              {Array.from({ length: n }, (_, k) => n - 1 - k).map((j) => (
                <tr key={j}>
                  <th>{j + 1}</th>
                  {Array.from({ length: n }, (_, i) => {
                    const cell = table.cells[j][i];
                    if (!cell) return <td key={i} className="void" />;
                    const hit = j === n - 1 && cell.has(cnf.start);
                    const isPicked = !played && picked?.[0] === j && picked?.[1] === i;
                    const state = !played
                      ? ""
                      : cykOrder(j, i, n) >= played.filled
                        ? "unfilled"
                        : at(played.cell && [played.cell], j, i)
                          ? "focus"
                          : at(played.uses, j, i)
                            ? "used"
                            : "";
                    return (
                      <td
                        key={i}
                        className={`${hit && state !== "unfilled" ? "hit" : ""} ${isPicked ? "picked" : ""} ${state}`}
                        style={{ cursor: "pointer" }}
                        title={t("detail.grammar.cykCellHint")}
                        onClick={() => setPicked(isPicked ? null : [j, i])}
                      >
                        {cell.size > 0 ? rich([...cell.keys()].join(", ")) : "–"}
                      </td>
                    );
                  })}
                </tr>
              ))}
              <tr className="cyk-word">
                <th />
                {table.word.map((c, i) => {
                  // the letters of the subword whose cell is being filled
                  const sub = played?.cell && i >= played.cell[1] && i <= played.cell[1] + played.cell[0];
                  return (
                    <td key={i} className={sub ? "sub" : undefined}>
                      {c}
                    </td>
                  );
                })}
              </tr>
            </tbody>
          </table>
        </div>
        {animating && (
          <PlayerBar
            player={player}
            caption={played && rich(tr(t, played.caption))}
            inline
            onClose={() => setAnimating(false)}
          />
        )}
        {!played && picked && table.why[picked[0]]?.[picked[1]] && (
          <div className="cyk-note" style={{ marginTop: 8 }}>
            <b>{`T[${picked[0] + 1},${picked[1] + 1}]`}</b>
            {" — "}
            {t("detail.grammar.cykCellIntro", {
              word: table.word.slice(picked[1], picked[1] + picked[0] + 1).join("")
            })}
            {table.why[picked[0]][picked[1]].size === 0 ? (
              <div>{t("detail.grammar.cykCellEmpty")}</div>
            ) : (
              <ul style={{ margin: "4px 0 0", paddingLeft: 18 }}>
                {[...table.why[picked[0]][picked[1]]].flatMap(([A, reasons]) =>
                  reasons.map((r) => <li key={`${A}${r}`}>{rich(r)}</li>)
                )}
              </ul>
            )}
          </div>
        )}
        {!converted && table.accepted && (
          <div className="cyk-note" style={{ marginTop: 8 }}>
            {table.trees === 1n
              ? t("detail.grammar.cykUnambiguous")
              : t("detail.grammar.cykAmbiguous", { count: table.trees.toString() })}
          </div>
        )}
      </div>
    </div>
  );
};
