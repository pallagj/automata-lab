import React, { useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import CodeMirror from "@uiw/react-codemirror";
import { yaml } from "@codemirror/lang-yaml";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { Cell, useAppStore } from "../../state/store";
import { CellResult } from "../../core/workspace";
import { DiagnosticsList } from "../detail/DiagnosticsList";
import { Code2, FileCode2, FunctionSquare, GripVertical, SlidersHorizontal, X } from "lucide-react";
import { serializeDefinition } from "../../core/parse/serialize";
import { machineCaps } from "../../core/machine/machine";
import { opApplicability, OpInfo, OPS } from "./ops";
import { detectEntityKind, EntityForm, parseEntityDraft } from "./EntityForm";
import { machineKindLabel } from "../machineLabels";
import { epsilonChange, epsilonInputHandler, REGEX_BOUNDARY } from "./epsilon";

interface Props {
  cell: Cell;
  index: number;
  result: CellResult | undefined;
}

const KIND_KEY: Record<string, string> = {
  grammar: "editor.cell.kind.grammar",
  regex: "editor.cell.kind.regex",
  verdict: "editor.cell.kind.verdict"
};

/** The recognised machine kind's name for the cell header — from its configuration. */
function valueKindLabel(t: TFunction, value: { kind: string }): string | undefined {
  if (value.kind === "machine") {
    const caps = machineCaps(value as never);
    if (caps.isFSMLike) return t("editor.cell.kind.fsm");
    if (caps.isPDALike) return t("editor.cell.kind.pda");
    if (caps.isTMLike) return t("editor.cell.kind.tm");
    return machineKindLabel(t, caps, true);
  }
  return KIND_KEY[value.kind] ? t(KIND_KEY[value.kind]) : undefined;
}

/** Drag & drop between cells: the id of the cell being dragged. */
let draggingId: string | null = null;

/** A proper warning badge for the gutter (not an emoji). */
const SeverityBadge: React.FC<{ level: "error" | "warning" | "info" }> = ({ level }) => {
  if (level === "info") {
    return (
      <svg viewBox="0 0 24 24" width="17" height="17" className={`gutter-warn ${level}`}>
        <circle cx="12" cy="12" r="9.5" fill="currentColor" />
        <circle cx="12" cy="7.6" r="1.5" fill="var(--panel)" />
        <rect x="10.7" y="10.4" width="2.6" height="7" rx="1.3" fill="var(--panel)" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" className={`gutter-warn ${level}`}>
      <path
        d="M10.43 4.1 2.9 17.4a1.8 1.8 0 0 0 1.57 2.7h15.06a1.8 1.8 0 0 0 1.57-2.7L13.57 4.1a1.8 1.8 0 0 0-3.14 0Z"
        fill="currentColor"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <rect x="10.8" y="8.4" width="2.4" height="6" rx="1.2" fill="var(--panel)" />
      <circle cx="12" cy="16.8" r="1.45" fill="var(--panel)" />
    </svg>
  );
};

const REGEX_CELL = /^\s*([A-Za-z][A-Za-z0-9_'′]*)\s*=\s*regex\(([\s\S]*)\)\s*$/;

export const CellEditor: React.FC<Props> = ({ cell, index, result }) => {
  const { t } = useTranslation();
  const theme = useAppStore((s) => s.theme);
  const activeCellId = useAppStore((s) => s.activeCellId);
  const setActiveCell = useAppStore((s) => s.setActiveCell);
  const setCellSource = useAppStore((s) => s.setCellSource);
  const removeCell = useAppStore((s) => s.removeCell);
  const moveCellTo = useAppStore((s) => s.moveCellTo);
  const addCell = useAppStore((s) => s.addCell);

  const [opsOpen, setOpsOpen] = useState(false);
  const [menuPos, setMenuPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 });
  const opsBtnRef = useRef<HTMLButtonElement>(null);

  const [diagOpen, setDiagOpen] = useState(false);
  const [diagPos, setDiagPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 });
  const diagTimer = useRef<number | null>(null);
  const warnRef = useRef<HTMLSpanElement>(null);

  const [dragReady, setDragReady] = useState(false);
  const [dropPos, setDropPos] = useState<"above" | "below" | null>(null);

  // entity cell: form or code view
  const entityKind = detectEntityKind(cell.source);
  const formAvailable = entityKind !== null && parseEntityDraft(cell.source) !== null;
  const [codeView, setCodeView] = useState(false);
  const showForm = formAvailable && !codeView;

  const regexMatch = REGEX_CELL.exec(cell.source);

  const isActive = cell.id === activeCellId;
  const diagnostics = result?.diagnostics ?? [];
  const worst: "error" | "warning" | "info" | null = diagnostics.some((d) => d.level === "error")
    ? "error"
    : diagnostics.some((d) => d.level === "warning")
      ? "warning"
      : diagnostics.length > 0
        ? "info"
        : null;
  const hasError = worst === "error";
  const isYaml = /^\s*[A-Za-z]+\s*:/.test(cell.source);

  const extensions = useMemo(() => (isYaml ? [yaml(), epsilonInputHandler] : []), [isYaml]);

  // an expression cell's result can be expanded into editable YAML
  const expandable =
    result?.isExpression && result.value && (result.value.kind === "machine" || result.value.kind === "grammar")
      ? result.value
      : null;

  const openOpsMenu = () => {
    const rect = opsBtnRef.current?.getBoundingClientRect();
    if (rect) {
      const width = Math.min(400, window.innerWidth - 16);
      setMenuPos({
        top: Math.min(rect.bottom + 6, window.innerHeight - 60),
        left: Math.max(8, Math.min(rect.left - width + rect.width, window.innerWidth - width - 8))
      });
    }
    setOpsOpen(true);
  };

  const openDiag = () => {
    if (diagTimer.current) window.clearTimeout(diagTimer.current);
    const rect = warnRef.current?.getBoundingClientRect();
    if (rect) {
      setDiagPos({
        top: Math.max(8, Math.min(rect.top - 6, window.innerHeight - 220)),
        left: rect.right + 8
      });
    }
    setDiagOpen(true);
  };
  const closeDiagSoon = () => {
    if (diagTimer.current) window.clearTimeout(diagTimer.current);
    diagTimer.current = window.setTimeout(() => setDiagOpen(false), 180);
  };

  const applyFix = (code: string) => {
    const asg = /^\s*([A-Za-z][A-Za-z0-9_'′]*)\s*=/.exec(cell.source);
    setCellSource(cell.id, asg ? `${asg[1]} = ${code}` : code);
    setDiagOpen(false);
  };

  /** Wraps the cell's expression in the selected operation. */
  const applyOp = (op: OpInfo) => {
    setOpsOpen(false);
    const src = cell.source.trim();
    const second = op.args === 2 ? ", " : "";
    const asg = /^\s*([A-Za-z][A-Za-z0-9_'′]*)\s*=\s*([\s\S]+)$/.exec(src);
    if (asg) {
      // expression cell: wrap the right-hand side
      setCellSource(cell.id, `${asg[1]} = ${op.name}(${asg[2].trim()}${second})`);
    } else if (result?.name && !result.isExpression) {
      // YAML definition: a new expression cell below, referring to the definition
      addCell(`${result.name}_${op.name} = ${op.name}(${result.name}${second})`, cell.id);
    } else {
      // empty / uninterpretable cell: expression template
      setCellSource(cell.id, `result = ${op.name}(${second})`);
    }
  };

  /* ---- drag & drop a gutterrel ---- */
  const onDragStart = (e: React.DragEvent) => {
    if (!dragReady) {
      e.preventDefault();
      return;
    }
    draggingId = cell.id;
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", cell.id);
  };
  const onDragEnd = () => {
    draggingId = null;
    setDragReady(false);
    setDropPos(null);
  };
  const onDragOver = (e: React.DragEvent) => {
    if (!draggingId || draggingId === cell.id) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    const rect = e.currentTarget.getBoundingClientRect();
    setDropPos(e.clientY < rect.top + rect.height / 2 ? "above" : "below");
  };
  const onDrop = (e: React.DragEvent) => {
    if (!draggingId || draggingId === cell.id) return;
    e.preventDefault();
    moveCellTo(draggingId, dropPos === "above" ? index : index + 1);
    setDropPos(null);
  };

  /* ---- operation menu with groups ---- */
  const renderOpsMenu = () => {
    const value = result?.value ?? null;
    const items: React.ReactNode[] = [];
    let lastGroup = "";
    for (const op of OPS) {
      if (op.groupKey !== lastGroup) {
        lastGroup = op.groupKey;
        items.push(
          <div className="menu-group" key={`g-${op.groupKey}`}>
            {t(op.groupKey)}
          </div>
        );
      }
      const app = opApplicability(op, value);
      const reasonText = app.reason ? t(app.reason.key, app.reason.params) : t("editor.ops.reason.unknown");
      items.push(
        <button
          key={op.name}
          className={app.ok ? "" : "not-applicable"}
          disabled={!app.ok}
          title={app.ok ? t(op.descKey) : t("editor.cell.notApplicable", { reason: reasonText })}
          onClick={(e) => {
            e.stopPropagation();
            if (app.ok) applyOp(op);
          }}
        >
          <code className="op-name">{op.name}(…)</code> {t(op.descKey)}
          {!app.ok && (
            <span className="op-reason">
              {reasonText}
              {app.fixChain ? (
                <>
                  {" "}
                  — {t("editor.cell.workingChain")}: <code>{app.fixChain}</code>
                </>
              ) : null}
            </span>
          )}
        </button>
      );
    }
    return items;
  };

  return (
    <div
      className={`cell ${isActive ? "active" : ""} ${hasError ? "has-error" : ""} ${
        dropPos ? `drop-${dropPos}` : ""
      }`}
      onFocusCapture={() => setActiveCell(cell.id)}
      onClick={() => setActiveCell(cell.id)}
      onKeyDownCapture={(e) => {
        if (e.key === "Enter" && e.altKey) {
          e.preventDefault();
          e.stopPropagation();
          addCell("", cell.id);
        }
      }}
      draggable={dragReady}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragOver={onDragOver}
      onDragLeave={() => setDropPos(null)}
      onDrop={onDrop}
    >
      <div
        className="cell-gutter"
        title={t("editor.cell.dragToReorder")}
        onMouseDown={() => setDragReady(true)}
        onMouseUp={() => setDragReady(false)}
      >
        <span className="cell-index">{index + 1}</span>
        <GripVertical size={13} className="grip" />
        {worst && (
          <span
            ref={warnRef}
            className="gutter-warn-wrap"
            onMouseEnter={openDiag}
            onMouseLeave={closeDiagSoon}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <SeverityBadge level={worst} />
          </span>
        )}
      </div>

      <div className="cell-main">
        <div className="cell-head">
          {result?.name && <span className="cell-name">{result.name}</span>}
          {result?.value && <span className="cell-kind">{valueKindLabel(t, result.value)}</span>}
          {result?.comment && <span className="cell-kind">{t("editor.cell.kind.note")}</span>}
          {regexMatch && !result?.value && <span className="cell-kind">{t("editor.cell.kind.regex")}</span>}
          <span className="spacer" />
          <button
            ref={opsBtnRef}
            className="cell-tool"
            title={t("editor.cell.operationsHint")}
            onClick={(e) => {
              e.stopPropagation();
              opsOpen ? setOpsOpen(false) : openOpsMenu();
            }}
          >
            <FunctionSquare size={15} />
          </button>
          {formAvailable && (
            <button
              className="cell-tool"
              title={showForm ? t("editor.cell.editYaml") : t("editor.cell.backToForm")}
              onClick={(e) => {
                e.stopPropagation();
                setCodeView((v) => !v);
              }}
            >
              {showForm ? <Code2 size={15} /> : <SlidersHorizontal size={15} />}
            </button>
          )}
          {expandable && (
            <button
              className="cell-tool"
              title={t("editor.cell.expandToDefinition")}
              onClick={(e) => {
                e.stopPropagation();
                setCellSource(cell.id, serializeDefinition(expandable));
              }}
            >
              <FileCode2 size={15} />
            </button>
          )}
          <button
            className="cell-tool danger"
            title={t("editor.cell.deleteCell")}
            onClick={(e) => {
              e.stopPropagation();
              removeCell(cell.id);
            }}
          >
            <X size={15} />
          </button>
        </div>

        {regexMatch ? (
          <div className="regex-row">
            <input
              className="rx-name"
              value={regexMatch[1]}
              onChange={(e) =>
                setCellSource(cell.id, `${e.target.value} = regex(${regexMatch[2]})`)
              }
              title={t("editor.cell.resultingAutomatonName")}
            />
            <span className="rx-eq">=</span>
            <span className="rx-chip">regex</span>
            <input
              className="rx-body"
              value={regexMatch[2]}
              onChange={(e) =>
                epsilonChange(e, (v) => setCellSource(cell.id, `${regexMatch[1]} = regex(${v})`), {
                  boundary: REGEX_BOUNDARY
                })
              }
              placeholder="(a|b)*abb"
              title={t("editor.cell.regexHint")}
            />
          </div>
        ) : showForm ? (
          <EntityForm source={cell.source} onChange={(s) => setCellSource(cell.id, s)} />
        ) : (
          <div className="cell-editor">
            <CodeMirror
              value={cell.source}
              theme={theme}
              extensions={extensions}
              onChange={(value) => setCellSource(cell.id, value)}
              onFocus={() => setActiveCell(cell.id)}
              basicSetup={{
                lineNumbers: cell.source.split("\n").length > 3,
                foldGutter: false,
                autocompletion: false,
                highlightActiveLine: false,
                highlightActiveLineGutter: false
              }}
            />
          </div>
        )}
      </div>

      {opsOpen &&
        createPortal(
          <>
            <div className="popover-back" onClick={() => setOpsOpen(false)} />
            <div className="menu popover" style={{ top: menuPos.top, left: menuPos.left }}>
              {renderOpsMenu()}
            </div>
          </>,
          document.body
        )}

      {diagOpen &&
        diagnostics.length > 0 &&
        createPortal(
          <div
            className="diag-popover"
            style={{ top: diagPos.top, left: diagPos.left }}
            onMouseEnter={openDiag}
            onMouseLeave={closeDiagSoon}
          >
            <DiagnosticsList diagnostics={diagnostics} onApplyFix={applyFix} />
          </div>,
          document.body
        )}
    </div>
  );
};
