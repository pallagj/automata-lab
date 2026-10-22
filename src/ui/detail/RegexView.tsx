import React, { useEffect, useMemo, useState } from "react";
import { rich } from "../Rich";
import { useTranslation } from "react-i18next";
import { RegexDef, RegexNodeInfo, regexToNFA, regexTree } from "../../core/fsm/regex";
import { acceptsFSM } from "../../core/fsm/fsm";
import { languageSummary } from "../../core/fsm/decide";
import { LanguageNote } from "./LanguageNote";
import { useAppStore, activeWorkspace } from "../../state/store";
import { uniqueName, usedNames } from "../../state/names";
import { withSubscript } from "../../core/symbols";
import { tr } from "../../i18n/translate";
import { StepGroup } from "../../core/expr/expression";
import { GraphView } from "../graph/GraphView";
import { fsmGraphSpec } from "./FSMView";
import { FrameCaption, PlayerBar, playedFrames, toGraphFrame, usePlayer } from "./AnimationPlayer";
import { ArrowRight, Check, Clapperboard, X } from "lucide-react";

/**
 * Regex analyser view: the expression's structure, a word test and sample words —
 * the value stays a regex; toFsm() turns it into an automaton.
 */

const TreeNode: React.FC<{ node: RegexNodeInfo }> = ({ node }) => {
  const { t } = useTranslation();
  return (
    <li>
      <span className="rx-node">{tr(t, node.label)}</span>
      {node.children.length > 0 && (
        <ul>
          {node.children.map((c, i) => (
            <TreeNode key={i} node={c} />
          ))}
        </ul>
      )}
    </li>
  );
};

export const RegexView: React.FC<{ regex: RegexDef; stepGroups?: StepGroup[] }> = ({ regex, stepGroups }) => {
  const { t } = useTranslation();
  const addCell = useAppStore((s) => s.addCell);
  const activeCellId = useAppStore((s) => s.activeCellId);
  const ensureCellName = useAppStore((s) => s.ensureCellName);

  // internal ε-NFA only for the analysis (word test, sample words)
  const nfa = useMemo(() => regexToNFA(regex.pattern, regex.name).value ?? null, [regex]);
  const tree = useMemo(() => regexTree(regex.pattern), [regex.pattern]);
  const words = useMemo(() => (nfa ? languageSummary(nfa, 24) : null), [nfa]);

  const [test, setTest] = useState("");
  const testOk = useMemo(
    () => (test === "" || !nfa ? null : acceptsFSM(nfa, test)),
    [nfa, test]
  );

  // the algorithm that built the expression (the r(p, q, t) rounds), played on its automaton
  const frames = useMemo(() => playedFrames(stepGroups), [stepGroups]);
  const [animating, setAnimating] = useState(false);
  useEffect(() => setAnimating(false), [frames]);
  const player = usePlayer(frames, animating);
  const played = animating ? frames[player.index]?.frame : undefined;
  const playedSpec = useMemo(() => (played ? fsmGraphSpec(played.graph) : null), [played?.graph]);
  const graphFrame = useMemo(
    () => (played && playedSpec ? toGraphFrame(played, playedSpec) : null),
    [played, playedSpec]
  );

  const insertToFsm = () => {
    if (!activeCellId) return;
    // an unnamed regex gets a name first, so the new cell can refer to it
    const source = regex.name || ensureCellName(activeCellId, "R");
    const used = usedNames(activeWorkspace(useAppStore.getState()).cells);
    addCell(`${uniqueName(withSubscript(source, "fsm"), used)} = toFsm(${source})`, activeCellId);
  };

  return (
    <>
      <div className="card">
        <div className="card-title">
          {t("detail.regex.title")}
          {regex.name && <> — {rich(regex.name)}</>}
        </div>
        <div className="card-body">
          <div className="rx-pattern">{regex.pattern === "" ? "ε" : regex.pattern}</div>
          <div className="rx-legend">
            <code>|</code> {t("detail.regex.or")} <code>+</code> {t("detail.regex.union")} · <code>*</code> {t("detail.regex.closure")} ·{" "}
            <code>?</code> {t("detail.regex.optional")} · <code>ε</code> (eps) {t("detail.regex.emptyWord")} · {t("detail.regex.parens")}
          </div>
          <button className="fix-btn rx-tofsm" onClick={insertToFsm} title={t("detail.regex.toFsmHint")}>
            <ArrowRight size={13} />
            toFsm({regex.name ? rich(regex.name) : "…"}) — {t("detail.regex.toFsmLabel")}
          </button>
          {frames.length > 0 && !animating && (
            <button className="anim-start rx-play" onClick={() => setAnimating(true)} title={t("detail.regex.playHint")}>
              <Clapperboard size={14} /> {t("detail.anim.start")}
            </button>
          )}
        </div>
      </div>

      {animating && playedSpec && (
        <div className="card">
          <div className="card-title">{t("detail.anim.title")}</div>
          <div className="card-body">
            <div className="anim-graph">
              <GraphView spec={playedSpec} frame={graphFrame} exportName={played?.graph.name} />
            </div>
            <PlayerBar
              player={player}
              caption={<FrameCaption frames={frames} index={player.index} />}
              inline
              onClose={() => setAnimating(false)}
            />
          </div>
        </div>
      )}

      {tree && (
        <div className="card">
          <div className="card-title">{t("detail.regex.structure")}</div>
          <div className="card-body">
            <ul className="rx-tree">
              <TreeNode node={tree} />
            </ul>
          </div>
        </div>
      )}

      <div className="card">
        <div className="card-title">{t("detail.regex.wordTest")}</div>
        <div className="card-body">
          <div className="word-test">
            <input
              value={test}
              onChange={(e) => setTest(e.target.value)}
              placeholder={t("detail.regex.wordTestPlaceholder")}
              spellCheck={false}
            />
            {testOk !== null && (
              <span className={`badge ${testOk ? "ok" : "danger"}`}>
                {testOk ? <Check size={13} /> : <X size={13} />}
                {testOk ? t("detail.regex.matches") : t("detail.regex.noMatch")}
              </span>
            )}
          </div>
        </div>
      </div>

      {words && (
        <div className="card">
          <div className="card-title">{t("detail.regex.sampleWords")}</div>
          <div className="card-body">
            {words.words.length > 0 && (
              <div className="words">
                {words.words.map((w) => (
                  <code key={w} className="word-chip">
                    {w === "" ? "ε" : w}
                  </code>
                ))}
              </div>
            )}
            <LanguageNote summary={words} shownCount={words.words.length} emptyKey="detail.language.emptyRegex" />
          </div>
        </div>
      )}
    </>
  );
};
