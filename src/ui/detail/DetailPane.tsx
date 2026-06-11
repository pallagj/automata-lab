import React from "react";
import { CellResult } from "../../core/workspace";
import { useAppStore, activeWorkspace } from "../../state/store";
import { serializeEntityDraft } from "../editor/EntityForm";
import { FSMView } from "./FSMView";
import { MachineView } from "./MachineView";
import { GrammarView } from "./GrammarView";
import { machineToFSM } from "../../core/machine/machine";
import { RegexView } from "./RegexView";
import { VerdictView } from "./VerdictView";
import { StepsPanel } from "./StepsPanel";
import { DiagnosticsList } from "./DiagnosticsList";

/** Üres cella: teljes vászon — dupla kattintásra megszületik az első állapot. */
const EmptyCanvas: React.FC = () => {
  const activeCellId = useAppStore((s) => s.activeCellId);
  const setCellSource = useAppStore((s) => s.setCellSource);
  const setNodePos = useAppStore((s) => s.setNodePos);
  const ws = useAppStore(activeWorkspace);

  const onDoubleClick = (e: React.MouseEvent) => {
    if (!activeCellId) return;
    const rect = e.currentTarget.getBoundingClientRect();
    // egyedi gépnév a munkalapon
    const used = new Set<string>();
    for (const c of ws.cells) {
      const m = /^\s*name:\s*([A-Za-z][A-Za-z0-9_'′]*)/m.exec(c.source);
      if (m) used.add(m[1]);
      const a = /^\s*([A-Za-z][A-Za-z0-9_'′]*)\s*=/.exec(c.source);
      if (a) used.add(a[1]);
    }
    let name = "M";
    let i = 2;
    while (used.has(name)) name = `M${i++}`;
    setNodePos(activeCellId, "S", e.clientX - rect.left, e.clientY - rect.top);
    setCellSource(
      activeCellId,
      serializeEntityDraft({
        kind: "fsm",
        yamlKey: "StateMachine",
        name,
        charset: "a, b",
        states: "S",
        init: "S",
        accept: "",
        acceptMode: "finalState",
        input: "head",
        storages: "",
        rows: []
      })
    );
  };

  return (
    <div className="stage">
      <div className="stage-canvas empty-canvas" onDoubleClick={onDoubleClick}>
        <div className="empty-canvas-hint">
          <div className="big">⟿</div>
          <b>Dupla kattintás</b> ide: véges automata első állapota —
          <br />
          vagy válassz a bal oldali <b>+ Beszúrás</b> menüből (regex, veremautomata, Turing-gép,
          nyelvtan…).
          <br />
          <span className="soft">Minden munkád automatikusan, offline mentődik.</span>
        </div>
      </div>
    </div>
  );
};

export const DetailPane: React.FC<{ result: CellResult | null }> = ({ result }) => {
  const activeCellId = useAppStore((s) => s.activeCellId);
  const setCellSource = useAppStore((s) => s.setCellSource);
  const ws = useAppStore(activeWorkspace);

  if (!result || result.empty) {
    return <EmptyCanvas />;
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

  // gépek: canvas-first elrendezés (a lépés-panel a lebegő panelek közé kerül)
  if (v.kind === "fsm") return <FSMView fsm={v} stepGroups={result.stepGroups} />;
  if (v.kind === "machine") {
    // tárolómentes gép: a teljes automata-nézetet kapja (analízis, szavak, idővonal)
    const f = machineToFSM(v);
    if (f) return <FSMView fsm={f} stepGroups={result.stepGroups} />;
    return <MachineView machine={v} stepGroups={result.stepGroups} />;
  }

  return (
    <>
      {v.kind === "grammar" && <GrammarView grammar={v} />}
      {v.kind === "regex" && <RegexView regex={v} />}
      {v.kind === "verdict" && <VerdictView verdict={v} />}
      <StepsPanel stepGroups={result.stepGroups} />
    </>
  );
};
