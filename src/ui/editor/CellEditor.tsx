import React, { useMemo } from "react";
import CodeMirror from "@uiw/react-codemirror";
import { yaml } from "@codemirror/lang-yaml";
import { Cell, useAppStore } from "../../state/store";
import { CellResult } from "../../core/workspace";
import { DiagnosticsList } from "../detail/DiagnosticsList";
import { ArrowDown, ArrowUp, FileCode2, Trash2 } from "lucide-react";
import { serializeDefinition } from "../../core/parse/serialize";

interface Props {
  cell: Cell;
  index: number;
  result: CellResult | undefined;
}

const KIND_LABEL: Record<string, string> = {
  fsm: "véges automata",
  pda: "veremautomata",
  tm: "Turing-gép",
  grammar: "nyelvtan",
  verdict: "összehasonlítás"
};

export const CellEditor: React.FC<Props> = ({ cell, index, result }) => {
  const theme = useAppStore((s) => s.theme);
  const activeCellId = useAppStore((s) => s.activeCellId);
  const setActiveCell = useAppStore((s) => s.setActiveCell);
  const setCellSource = useAppStore((s) => s.setCellSource);
  const removeCell = useAppStore((s) => s.removeCell);
  const moveCell = useAppStore((s) => s.moveCell);

  const isActive = cell.id === activeCellId;
  const hasError = (result?.diagnostics ?? []).some((d) => d.level === "error");
  const isYaml = /^\s*[A-Za-z]+\s*:/.test(cell.source);

  const extensions = useMemo(() => (isYaml ? [yaml()] : []), [isYaml]);

  // kifejezés-cella eredménye kibontható szerkeszthető YAML-lá
  const expandable =
    result?.isExpression && result.value && result.value.kind !== "verdict" ? result.value : null;

  const applyFix = (code: string) => {
    const asg = /^\s*([A-Za-z][A-Za-z0-9_'′]*)\s*=/.exec(cell.source);
    setCellSource(cell.id, asg ? `${asg[1]} = ${code}` : code);
  };

  return (
    <div
      className={`cell ${isActive ? "active" : ""} ${hasError ? "has-error" : ""}`}
      onFocusCapture={() => setActiveCell(cell.id)}
      onClick={() => setActiveCell(cell.id)}
    >
      <div className="cell-head">
        {result?.name && <span className="cell-name">{result.name}</span>}
        {result?.value && <span className="cell-kind">{KIND_LABEL[result.value.kind]}</span>}
        <span className="spacer" />
        {expandable && (
          <button
            className="cell-tool"
            title="Kibontás szerkeszthető definícióvá"
            onClick={(e) => {
              e.stopPropagation();
              setCellSource(cell.id, serializeDefinition(expandable));
            }}
          >
            <FileCode2 size={15} />
          </button>
        )}
        <button
          className="cell-tool"
          title="Mozgatás felfelé"
          onClick={(e) => {
            e.stopPropagation();
            moveCell(cell.id, -1);
          }}
        >
          <ArrowUp size={15} />
        </button>
        <button
          className="cell-tool"
          title="Mozgatás lefelé"
          onClick={(e) => {
            e.stopPropagation();
            moveCell(cell.id, 1);
          }}
        >
          <ArrowDown size={15} />
        </button>
        <button
          className="cell-tool danger"
          title="Cella törlése"
          onClick={(e) => {
            e.stopPropagation();
            removeCell(cell.id);
          }}
        >
          <Trash2 size={15} />
        </button>
      </div>

      <div className="cell-editor">
        <CodeMirror
          value={cell.source}
          theme={theme}
          extensions={extensions}
          onChange={(value) => setCellSource(cell.id, value)}
          onFocus={() => setActiveCell(cell.id)}
          placeholder={'YAML-definíció (pl. "StateMachine:") vagy kifejezés (pl. "D = det(M)")'}
          basicSetup={{
            lineNumbers: cell.source.split("\n").length > 3,
            foldGutter: false,
            autocompletion: false,
            highlightActiveLine: false,
            highlightActiveLineGutter: false
          }}
        />
      </div>

      {result && isActive && (
        <DiagnosticsList diagnostics={result.diagnostics} onApplyFix={applyFix} />
      )}
    </div>
  );
};
