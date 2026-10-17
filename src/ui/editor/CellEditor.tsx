import React, { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import CodeMirror, { EditorView, keymap, Prec, ReactCodeMirrorRef } from "@uiw/react-codemirror";
import { yaml } from "@codemirror/lang-yaml";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { activeWorkspace, Cell, useAppStore } from "../../state/store";
import { uniqueName, usedNames } from "../../state/names";
import { splitAssignment } from "../../core/expr/expression";
import { subscripts, yamlDigits } from "./subscript";
import { withSubscript } from "../../core/symbols";
import { CellResult } from "../../core/workspace";
import { DiagnosticsList } from "../detail/DiagnosticsList";
import { Code2, FileCode2, FunctionSquare, SlidersHorizontal, X } from "lucide-react";
import { serializeDefinition } from "../../core/parse/serialize";
import { machineCaps } from "../../core/machine/machine";
import { opApplicability, OpInfo, OPS } from "./ops";
import { detectEntityKind, EntityForm, parseEntityDraft } from "./EntityForm";
import { machineKindLabel } from "../machineLabels";
import { epsilonInputHandler, insideRegex, regexEpsilonInputHandler } from "./epsilon";
import { isNoteSource, noteSource, noteText } from "./note";
import { KindIcon, ValueKind } from "../kinds";

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

/** The kind shown as a badge in the gutter; null while the cell has no value. */
function cellKind(result: CellResult | undefined): ValueKind | null {
  if (result?.comment) return "note";
  const value = result?.value;
  if (!value) return null;
  if (value.kind === "machine") return machineCaps(value as never).kind;
  if (value.kind === "grammar" || value.kind === "regex" || value.kind === "verdict") return value.kind;
  return null;
}

/** Drag & drop between cells: the id of the cell being dragged. */
let draggingId: string | null = null;

/** Puts the caret at the end of a cell: its editor's text, or a form's last field. */
function focusCellEnd(cellId: string) {
  const el = document.querySelector<HTMLElement>(`[data-cell-id="${cellId}"]`);
  if (!el) return;
  const view = EditorView.findFromDOM(el);
  if (view) {
    view.focus();
    view.dispatch({ selection: { anchor: view.state.doc.length } });
    return;
  }
  const fields = el.querySelectorAll<HTMLInputElement>("input");
  const last = fields[fields.length - 1];
  if (!last) return;
  last.focus();
  last.setSelectionRange(last.value.length, last.value.length);
}

/** A proper warning badge for the gutter (not an emoji). */
const SeverityBadge: React.FC<{ level: "error" | "warning" }> = ({ level }) => {
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


export const CellEditor: React.FC<Props> = ({ cell, index, result }) => {
  const { t } = useTranslation();
  const theme = useAppStore((s) => s.theme);
  const activeCellId = useAppStore((s) => s.activeCellId);
  const setActiveCell = useAppStore((s) => s.setActiveCell);
  const setCellSource = useAppStore((s) => s.setCellSource);
  const removeCell = useAppStore((s) => s.removeCell);
  const moveCellTo = useAppStore((s) => s.moveCellTo);
  const addCell = useAppStore((s) => s.addCell);
  const ensureCellName = useAppStore((s) => s.ensureCellName);

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


  const isActive = cell.id === activeCellId;
  const diagnostics = result?.diagnostics ?? [];
  // the gutter flags problems only; infos are read as notes in the detail pane
  const worst: "error" | "warning" | null = diagnostics.some((d) => d.level === "error")
    ? "error"
    : diagnostics.some((d) => d.level === "warning")
      ? "warning"
      : null;
  const hasError = worst === "error";
  const isYaml = /^\s*[A-Za-z]+\s*:/.test(cell.source);
  // a note is edited as plain text: its # markers stay in the source, out of sight
  const isNote = isNoteSource(cell.source);
  const text = isNote ? noteText(cell.source) : cell.source;

  // expressions and notes are one line, as in Desmos: Enter starts a new cell below (Shift+Enter still breaks
  // the line); YAML definitions are multi-line, so there Enter stays a newline
  const extensions = useMemo(() => {
    if (isYaml) return [yaml(), epsilonInputHandler, subscripts(yamlDigits)];
    const newCellOnEnter = { key: "Enter", run: () => (addCell("", cell.id), true) };
    // Backspace in an empty cell deletes it and goes on at the end of the cell above, as in Desmos;
    // the first cell stays, and if it is an empty note it turns back into an expression cell
    const backspaceWhenEmpty = {
      key: "Backspace",
      run: (view: EditorView) => {
        if (view.state.doc.length > 0) return false;
        const cells = activeWorkspace(useAppStore.getState()).cells;
        const prev = cells[cells.findIndex((c) => c.id === cell.id) - 1];
        if (prev) {
          focusCellEnd(prev.id);
          removeCell(cell.id);
          setActiveCell(prev.id);
          return true;
        }
        if (!isNote) return false;
        setCellSource(cell.id, "");
        return true;
      }
    };
    const keys = Prec.high(keymap.of([newCellOnEnter, backspaceWhenEmpty]));
    if (isNote) return [EditorView.lineWrapping, keys];
    // names in expressions: M1 is M₁ (inside regex(…) digits are letters of the pattern)
    const exprDigits = subscripts((state, pos) => !insideRegex(state.doc.sliceString(0, pos)));
    return [regexEpsilonInputHandler, exprDigits, keys];
  }, [isYaml, isNote, addCell, removeCell, setActiveCell, setCellSource, cell.id]);

  // a new, empty cell (Enter, the ghost cell) takes the keyboard focus as soon as its editor exists;
  // an empty cell that becomes active later (e.g. by deleting the one below) gets it on the next frame
  const autoFocus = useRef(isActive && text === "").current;
  const cellRef = useRef<HTMLDivElement>(null);
  const cmRef = useRef<ReactCodeMirrorRef>(null);
  useEffect(() => {
    if (!isActive || text !== "") return;
    const frame = requestAnimationFrame(() => {
      if (!cellRef.current?.contains(document.activeElement)) cmRef.current?.view?.focus();
    });
    return () => cancelAnimationFrame(frame);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isActive]);

  // typing # (or Backspace in an empty first note) switches modes and remounts the editor — the shown text
  // changes under it — so the new editor takes over the caret as soon as it exists, at the end of its text
  const wasNote = useRef(isNote);
  const caretMoves = useRef(false);
  if (wasNote.current !== isNote) {
    wasNote.current = isNote;
    caretMoves.current = isActive;
  }
  const onCreateEditor = (view: EditorView) => {
    if (!caretMoves.current) return;
    caretMoves.current = false;
    view.focus();
    view.dispatch({ selection: { anchor: view.state.doc.length } });
  };

  const kind = cellKind(result);
  const kindLabel = result?.comment
    ? t("editor.cell.kind.note")
    : result?.value
      ? valueKindLabel(t, result.value)
      : undefined;
  // a single line: expressions and notes; a block: the form or the YAML of a definition
  const inline = !showForm && !isYaml;

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
    const asg = splitAssignment(src);
    if (asg) {
      // named expression cell: wrap the right-hand side
      setCellSource(cell.id, `${asg.rawName} = ${op.name}(${asg.expr}${second})`);
    } else if (result?.isExpression) {
      // unnamed expression cell: wrap the whole expression
      setCellSource(cell.id, `${op.name}(${src}${second})`);
    } else if (result?.value) {
      // YAML definition: a new expression cell below, referring to the definition by name
      const name = ensureCellName(cell.id, result.value.kind === "grammar" ? "G" : "M");
      const used = usedNames(activeWorkspace(useAppStore.getState()).cells);
      addCell(`${uniqueName(withSubscript(name, op.name), used)} = ${op.name}(${name}${second})`, cell.id);
    } else {
      // empty / uninterpretable cell: an expression template
      setCellSource(cell.id, `${op.name}(${second})`);
    }
  };

  /* ---- drag & drop via the gutter ---- */
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
      ref={cellRef}
      data-cell-id={cell.id}
      className={`cell ${inline ? "inline" : "block"} ${isNote ? "note" : ""} ${isActive ? "active" : ""} ${hasError ? "has-error" : ""} ${
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
        {/* one indicator only: a problem if there is one, otherwise what the cell holds */}
        {!worst && kind && <KindIcon kind={kind} title={kindLabel} />}
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
        <div className="cell-body">
          {showForm ? (
            <EntityForm source={cell.source} onChange={(s) => setCellSource(cell.id, s)} />
          ) : (
            <div className="cell-editor">
              <CodeMirror
                key={isNote ? "note" : "code"}
                ref={cmRef}
                autoFocus={autoFocus}
                value={text}
                theme={theme}
                extensions={extensions}
                placeholder={isNote ? t("editor.cell.notePlaceholder") : undefined}
                onChange={(value) => setCellSource(cell.id, isNote ? noteSource(value) : value)}
                onFocus={() => setActiveCell(cell.id)}
                onCreateEditor={onCreateEditor}
                basicSetup={{
                  lineNumbers: !isNote && cell.source.split("\n").length > 3,
                  foldGutter: false,
                  autocompletion: false,
                  highlightActiveLine: false,
                  highlightActiveLineGutter: false
                }}
              />
            </div>
          )}
        </div>

        <div className="cell-tools">
          {!isNote && (
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
          )}
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
