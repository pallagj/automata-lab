import React, { useMemo, useState } from "react";
import {
  classify,
  generateWords,
  Grammar,
  grammarAccepts,
  ruleToString
} from "../../core/grammar/grammar";
import { useAppStore } from "../../state/store";
import { Check, ChevronRight, HelpCircle, ListOrdered, Wand2, X } from "lucide-react";

const TYPE_NAMES: Record<number, string> = {
  3: "3. típusú — reguláris",
  2: "2. típusú — környezetfüggetlen",
  1: "1. típusú — környezetfüggő",
  0: "0. típusú — általános (mondatszerkezetű)"
};

export const GrammarView: React.FC<{ grammar: Grammar }> = ({ grammar }) => {
  const cls = useMemo(() => classify(grammar), [grammar]);
  const gen = useMemo(() => generateWords(grammar, 8, 36), [grammar]);
  const addCell = useAppStore((s) => s.addCell);

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
        <div className="card-title">Nyelvtan — {grammar.name}</div>
        <div className="card-body">
          <div className="class-hero">
            <span className="big">{TYPE_NAMES[cls.type]}</span>
            <span className={`badge ${cls.epsilonFree ? "ok" : "warn"}`} title={cls.epsilonIssues.join("; ") || "Az ε legfeljebb S → ε alakban szerepel, és S nem áll jobb oldalon."}>
              {cls.epsilonFree ? "ε-mentes alak" : "ε-szabályos"}
            </span>
            {cls.type === 3 && (
              <span className="badge accent">{cls.direction === "right" ? "jobblineáris" : "ballineáris"}</span>
            )}
          </div>

          <div className="class-grid">
            <span className="lvl" style={{ color: cls.reasons.type3.holds ? "var(--success)" : "var(--muted)" }}>
              {cls.reasons.type3.holds ? "✓" : "✗"} 3. típus
            </span>
            <span className="why">
              {cls.reasons.type3.holds
                ? "Minden szabály A → uB vagy A → u alakú (u terminális szó)."
                : cls.reasons.type3.violations[0] ?? "nem lineáris alak"}
            </span>
            <span className="lvl" style={{ color: cls.reasons.type2.holds ? "var(--success)" : "var(--muted)" }}>
              {cls.reasons.type2.holds ? "✓" : "✗"} 2. típus
            </span>
            <span className="why">
              {cls.reasons.type2.holds
                ? "Minden szabály bal oldala egyetlen nemterminális."
                : cls.reasons.type2.violations[0]}
            </span>
            <span className="lvl" style={{ color: cls.reasons.type1.holds ? "var(--success)" : "var(--muted)" }}>
              {cls.reasons.type1.holds ? "✓" : "✗"} 1. típus
            </span>
            <span className="why">
              {cls.reasons.type1.holds
                ? "Egyik szabály sem rövidít (a megengedett S → ε kivétellel)."
                : cls.reasons.type1.violations[0]}
            </span>
          </div>

          <div className="badges" style={{ marginTop: 14 }}>
            {cls.type === 3 && cls.direction === "right" && (
              <button className="icon-btn" onClick={() => addCell(`M_${grammar.name} = toFsm(${grammar.name})`)}>
                <Wand2 size={14} /> Véges automatává
              </button>
            )}
            {cls.reasons.type2.holds && (
              <button className="icon-btn" onClick={() => addCell(`P_${grammar.name} = toPda(${grammar.name})`)}>
                <Wand2 size={14} /> Veremautomatává
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-title">Szabályok</div>
        <div className="card-body rule-list">
          {[...byLeft.entries()].map(([left, rights]) => (
            <div key={left}>
              <span className="nt">{left}</span> → {rights.join(" | ")}
            </div>
          ))}
          <div style={{ marginTop: 6, fontSize: 12.5, color: "var(--muted)", fontFamily: "var(--font-sans)" }}>
            kezdőszimbólum: {grammar.start} · terminálisok: {grammar.terminals.join(", ")} · nemterminálisok:{" "}
            {grammar.nonterminals.join(", ")}
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-title">
          <HelpCircle size={15} />
          Levezethető-e egy szó?
        </div>
        <div className="card-body">
          <div className="sim-row">
            <input
              className="sim-input"
              value={test}
              placeholder="írj be egy szót, pl. aabb"
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
                    <Check size={15} /> levezethető
                  </>
                )}
                {testResult.verdict === "no" && (
                  <>
                    <X size={15} /> nem vezethető le
                  </>
                )}
                {testResult.verdict === "unknown" && <>a korláton belül nem dönthető el</>}
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
          Generált szavak ({gen.words.length}
          {gen.exhaustive ? "" : "+"})
          <ChevronRight size={15} className="chev" />
        </summary>
        <div className="card-body">
          <div className="words">
            {gen.words.map((w) => (
              <button
                key={w.word}
                className="word-chip"
                title="Kattints a levezetéshez"
                onClick={() => setOpenDerivation(openDerivation === w.word ? null : w.word)}
              >
                {w.word === "" ? "ε" : w.word}
              </button>
            ))}
            {gen.words.length === 0 && (
              <span style={{ color: "var(--muted)" }}>Nem található levezethető szó 8 hosszig.</span>
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
              …a nyelv ennél bővebb lehet (a felsorolás 8 hosszig terjed).
            </div>
          )}
        </div>
      </details>
    </>
  );
};
