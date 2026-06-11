import React from "react";
import { CellResult } from "../../core/workspace";
import { useAppStore, activeWorkspace } from "../../state/store";
import { FSMView } from "./FSMView";
import { PDAView } from "./PDAView";
import { TMView } from "./TMView";
import { GrammarView } from "./GrammarView";
import { VerdictView } from "./VerdictView";
import { StepsPanel } from "./StepsPanel";
import { DiagnosticsList } from "./DiagnosticsList";

export const DetailPane: React.FC<{ result: CellResult | null }> = ({ result }) => {
  const activeCellId = useAppStore((s) => s.activeCellId);
  const setCellSource = useAppStore((s) => s.setCellSource);
  const ws = useAppStore(activeWorkspace);

  if (!result || result.empty) {
    return (
      <div className="empty-hint">
        <div className="big">⟿</div>
        Szúrj be cellát balra fent a <b>+ Beszúrás</b> gombbal, vagy tölts be egy kész munkalapot a{" "}
        <b>Példák</b> menüből.
        <br />
        Minden munkád automatikusan, offline mentődik.
      </div>
    );
  }

  if (!result.value) {
    // a javítási javaslat az aktív cella kifejezését cseréli
    const applyFix = (code: string) => {
      const cell = ws.cells.find((c) => c.id === activeCellId);
      if (!cell) return;
      const asg = /^\s*([A-Za-z][A-Za-z0-9_'′]*)\s*=/.exec(cell.source);
      setCellSource(cell.id, asg ? `${asg[1]} = ${code}` : code);
    };
    return (
      <div className="card">
        <div className="card-title">Miért nem értékelhető ki a cella?</div>
        <DiagnosticsList diagnostics={result.diagnostics} onApplyFix={applyFix} />
      </div>
    );
  }

  const v = result.value;

  return (
    <>
      {v.kind === "fsm" && <FSMView fsm={v} />}
      {v.kind === "pda" && <PDAView pda={v} />}
      {v.kind === "tm" && <TMView tm={v} />}
      {v.kind === "grammar" && <GrammarView grammar={v} />}
      {v.kind === "verdict" && <VerdictView verdict={v} />}
      <StepsPanel stepGroups={result.stepGroups} />
    </>
  );
};
