import React, { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { RegexDef, RegexNodeInfo, regexToNFA, regexTree } from "../../core/fsm/regex";
import { acceptsFSM, enumerateWords } from "../../core/fsm/fsm";
import { useAppStore, activeWorkspace } from "../../state/store";
import { tr } from "../../i18n/translate";
import { ArrowRight, Check, X } from "lucide-react";

/**
 * Regex-elemző nézet: a kifejezés szerkezete, szó-teszt és minta-szavak —
 * az érték regex marad, automatává a toFsm() alakítja.
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

export const RegexView: React.FC<{ regex: RegexDef }> = ({ regex }) => {
  const { t } = useTranslation();
  const addCell = useAppStore((s) => s.addCell);
  const activeCellId = useAppStore((s) => s.activeCellId);
  const ws = useAppStore(activeWorkspace);

  // belső ε-NFA csak az elemzéshez (szó-teszt, minta-szavak)
  const nfa = useMemo(() => regexToNFA(regex.pattern, regex.name).value ?? null, [regex]);
  const tree = useMemo(() => regexTree(regex.pattern), [regex.pattern]);
  const words = useMemo(() => (nfa ? enumerateWords(nfa, 7, 24) : null), [nfa]);

  const [test, setTest] = useState("");
  const testOk = useMemo(
    () => (test === "" || !nfa ? null : acceptsFSM(nfa, test)),
    [nfa, test]
  );

  const insertToFsm = () => {
    // egyedi név az automatának
    const used = new Set<string>();
    for (const c of ws.cells) {
      const m = /^\s*([A-Za-z][A-Za-z0-9_'′]*)\s*=/.exec(c.source);
      if (m) used.add(m[1]);
      const d = /^\s*name:\s*([A-Za-z][A-Za-z0-9_'′]*)/m.exec(c.source);
      if (d) used.add(d[1]);
    }
    let name = `${regex.name}_fsm`;
    let i = 2;
    while (used.has(name)) name = `${regex.name}_fsm${i++}`;
    addCell(`${name} = toFsm(${regex.name})`, activeCellId);
  };

  return (
    <>
      <div className="card">
        <div className="card-title">{t("detail.regex.title")} — {regex.name}</div>
        <div className="card-body">
          <div className="rx-pattern">{regex.pattern === "" ? "ε" : regex.pattern}</div>
          <div className="rx-legend">
            <code>|</code> {t("detail.regex.or")} <code>+</code> {t("detail.regex.union")} · <code>*</code> {t("detail.regex.closure")} ·{" "}
            <code>?</code> {t("detail.regex.optional")} · <code>$</code>/<code>ε</code> {t("detail.regex.emptyWord")} · {t("detail.regex.parens")}
          </div>
          <button className="fix-btn rx-tofsm" onClick={insertToFsm} title={t("detail.regex.toFsmHint")}>
            <ArrowRight size={13} />
            toFsm({regex.name}) — {t("detail.regex.toFsmLabel")}
          </button>
        </div>
      </div>

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

      {words && words.words.length > 0 && (
        <div className="card">
          <div className="card-title">{t("detail.regex.sampleWords")}</div>
          <div className="card-body">
            <div className="words">
              {words.words.map((w) => (
                <code key={w} className="word-chip">
                  {w === "" ? "ε" : w}
                </code>
              ))}
              {!words.exhaustive && <span style={{ color: "var(--muted)" }}>…</span>}
            </div>
          </div>
        </div>
      )}
    </>
  );
};
