import React, { useMemo, useState } from "react";
import CodeMirror from "@uiw/react-codemirror";
import { yaml } from "@codemirror/lang-yaml";
import { Cell, useAppStore } from "../../state/store";
import { CellResult } from "../../core/workspace";
import { DiagnosticsList } from "../detail/DiagnosticsList";
import { ArrowDown, ArrowUp, FileCode2, FunctionSquare, Trash2 } from "lucide-react";
import { serializeDefinition } from "../../core/parse/serialize";
import { OpInfo, OPS } from "./ops";

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
  const addCell = useAppStore((s) => s.addCell);
  const [opsOpen, setOpsOpen] = useState(false);

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

  /** A kiválasztott művelettel körbeveszi a cella kifejezését. */
  const applyOp = (op: OpInfo) => {
    setOpsOpen(false);
    const src = cell.source.trim();
    const second = op.args === 2 ? ", " : "";
    const asg = /^\s*([A-Za-z][A-Za-z0-9_'′]*)\s*=\s*([\s\S]+)$/.exec(src);
    if (asg) {
      // kifejezés-cella: a jobb oldalt csomagoljuk be
      setCellSource(cell.id, `${asg[1]} = ${op.name}(${asg[2].trim()}${second})`);
    } else if (result?.name && !result.isExpression) {
      // YAML-definíció: új kifejezés-cella alá, a definícióra hivatkozva
      addCell(`${result.name}_${op.name} = ${op.name}(${result.name}${second})`, cell.id);
    } else {
      // üres / értelmezhetetlen cella: kifejezés-sablon
      setCellSource(cell.id, `eredmeny = ${op.name}(${second})`);
    }
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
        <button
          className="cell-tool"
          title="Műveletek — a kiválasztott művelettel körbeveszi a cellát"
          onClick={(e) => {
            e.stopPropagation();
            setOpsOpen((o) => !o);
          }}
        >
          <FunctionSquare size={15} />
        </button>
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

      {opsOpen && (
        <div className="ops-menu-wrap">
          <div className="menu" onMouseLeave={() => setOpsOpen(false)}>
            <div className="menu-group">Műveletek — kattints, és körbeveszi a cellát</div>
            {OPS.map((op) => (
              <button
                key={op.name}
                onClick={(e) => {
                  e.stopPropagation();
                  applyOp(op);
                }}
              >
                <code className="op-name">{op.name}(…)</code> {op.desc}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="cell-editor">
        <CodeMirror
          value={cell.source}
          theme={theme}
          extensions={extensions}
          onChange={(value) => setCellSource(cell.id, value)}
          onFocus={() => setActiveCell(cell.id)}
          placeholder="kifejezés…"
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
