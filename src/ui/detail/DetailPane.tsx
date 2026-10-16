import React from "react";
import { useTranslation } from "react-i18next";
import { CellResult } from "../../core/workspace";
import { useAppStore, activeWorkspace } from "../../state/store";
import { uniqueName, usedNames } from "../../state/names";
import { serializeEntityDraft } from "../editor/EntityForm";
import { FSMView } from "./FSMView";
import { MachineView } from "./MachineView";
import { GrammarView } from "./GrammarView";
import { machineToFSM } from "../../core/machine/machine";
import { RegexView } from "./RegexView";
import { VerdictView } from "./VerdictView";
import { StepsPanel } from "./StepsPanel";
import { DiagnosticsList, ResultNotes, useApplyFix } from "./DiagnosticsList";
import { Info } from "lucide-react";

/** Empty cell: a full canvas — double-click creates the first state. */
const EmptyCanvas: React.FC = () => {
  const { t } = useTranslation();
  const activeCellId = useAppStore((s) => s.activeCellId);
  const setCellSource = useAppStore((s) => s.setCellSource);
  const setNodePos = useAppStore((s) => s.setNodePos);
  const ws = useAppStore(activeWorkspace);

  const onDoubleClick = (e: React.MouseEvent) => {
    if (!activeCellId) return;
    const rect = e.currentTarget.getBoundingClientRect();
    // a machine name that is unique within the worksheet
    const name = uniqueName("M", usedNames(ws.cells));
    setNodePos(activeCellId, "S", e.clientX - rect.left, e.clientY - rect.top);
    setCellSource(
      activeCellId,
      serializeEntityDraft({
        kind: "machine",
        name,
        charset: "a, b",
        states: "S",
        init: "S",
        accept: "",
        acceptMode: "finalState",
        input: "head",
        storages: [],
        rows: []
      })
    );
  };

  return (
    <div className="stage">
      <div className="stage-canvas empty-canvas" onDoubleClick={onDoubleClick}>
        <div className="empty-canvas-hint">
          <div className="big">⟿</div>
          <b>{t("detail.emptyCanvas.doubleClick")}</b> {t("detail.emptyCanvas.hereText")}
          <br />
          {t("detail.emptyCanvas.orChoose1")} <b>{t("detail.emptyCanvas.insertMenu")}</b>
          {t("detail.emptyCanvas.orChoose2")}
          <br />
          <span className="soft">{t("detail.emptyCanvas.autosave")}</span>
        </div>
      </div>
    </div>
  );
};

export const DetailPane: React.FC<{ result: CellResult | null }> = ({ result }) => {
  const { t } = useTranslation();
  const activeCellId = useAppStore((s) => s.activeCellId);
  const ws = useAppStore(activeWorkspace);
  const applyFix = useApplyFix();

  if (!result || result.empty) {
    return <EmptyCanvas />;
  }

  if (result.comment) {
    const cell = ws.cells.find((c) => c.id === activeCellId);
    const text = (cell?.source ?? "")
      .split("\n")
      .map((l) => l.replace(/^\s*#\s?/, ""))
      .join("\n")
      .trim();
    return (
      <div className="card">
        <div className="card-title">{t("detail.note")}</div>
        <p style={{ whiteSpace: "pre-wrap", margin: 0 }}>{text}</p>
      </div>
    );
  }

  if (!result.value) {
    return (
      <div className="card">
        <div className="card-title">{t("detail.whyNotEvaluable")}</div>
        <DiagnosticsList diagnostics={result.diagnostics} onApplyFix={applyFix} />
      </div>
    );
  }

  const v = result.value;

  // machines: canvas-first layout (the steps panel joins the floating panels)
  if (v.kind === "fsm") return <FSMView fsm={v} stepGroups={result.stepGroups} diagnostics={result.diagnostics} />;
  if (v.kind === "machine") {
    // storage-free machine: gets the full automaton view (analysis, words, timeline)
    const f = machineToFSM(v);
    if (f) return <FSMView fsm={f} stepGroups={result.stepGroups} diagnostics={result.diagnostics} />;
    return <MachineView machine={v} stepGroups={result.stepGroups} diagnostics={result.diagnostics} />;
  }

  return (
    <>
      {v.kind === "grammar" && <GrammarView grammar={v} />}
      {v.kind === "regex" && <RegexView regex={v} />}
      {v.kind === "verdict" && <VerdictView verdict={v} />}
      {result.diagnostics.length > 0 && (
        <div className="card">
          <div className="card-title">
            <Info size={15} />
            {t("detail.notes")}
          </div>
          <ResultNotes diagnostics={result.diagnostics} />
        </div>
      )}
      <StepsPanel stepGroups={result.stepGroups} />
    </>
  );
};
