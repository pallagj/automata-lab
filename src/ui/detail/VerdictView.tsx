import React from "react";
import { EquivalenceVerdict } from "../../core/fsm/ops";

export const VerdictView: React.FC<{ verdict: EquivalenceVerdict }> = ({ verdict }) => {
  return (
    <div className="card">
      <div className="card-title">Ekvivalencia-vizsgálat</div>
      <div className="verdict-card">
        <div className="mark">{verdict.equal ? "🟰" : "≠"}</div>
        <h2>
          {verdict.machineA} {verdict.equal ? "≡" : "≢"} {verdict.machineB}
        </h2>
        {verdict.equal ? (
          <p style={{ color: "var(--text-soft)" }}>
            A két automata <b>ugyanazt a nyelvet</b> ismeri fel: a szorzatautomata egyetlen elérhető
            állapotpárjában sem tér el az elfogadás.
          </p>
        ) : (
          <>
            <p style={{ color: "var(--text-soft)" }}>
              A két automata <b>nem ekvivalens</b>. A legrövidebb megkülönböztető szó:
            </p>
            <div className="ce">{verdict.counterexample!.word}</div>
            <p style={{ color: "var(--text-soft)", fontSize: 13.5 }}>
              Ezt a szót a(z) <b>{verdict.counterexample!.acceptedBy}</b> elfogadja, a(z){" "}
              <b>{verdict.counterexample!.rejectedBy}</b> viszont elutasítja.
            </p>
          </>
        )}
      </div>
    </div>
  );
};
