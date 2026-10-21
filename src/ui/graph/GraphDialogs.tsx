import React, { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { Plus, Trash2, X } from "lucide-react";
import { EdgeMiddle, StatePatch } from "./editing";
import { SymbolField } from "../editor/SymbolField";
import { emptyFields, TransitionField, TransitionHead, TransitionRow } from "../editor/TransitionRow";
import { arrowKeysAcrossFields } from "../editor/formNav";
import { useAppStore } from "../../state/store";
import { rich } from "../Rich";

/** Editor dialogs for the graph (state / transition). */

const Modal: React.FC<{ title: React.ReactNode; onClose: () => void; wide?: boolean; children: React.ReactNode }> = ({
  title,
  onClose,
  wide = false,
  children
}) => {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return createPortal(
    <div className="modal-back" onClick={onClose}>
      <div className={`modal gdialog ${wide ? "wide" : ""}`} onClick={(e) => e.stopPropagation()}>
        <div className="gd-head">
          <h2>{title}</h2>
          <button className="icon-btn" onClick={onClose}>
            <X size={15} />
          </button>
        </div>
        {children}
      </div>
    </div>,
    document.body
  );
};

/* ------------------------------ state ------------------------------ */

interface StateDialogProps {
  mode: "new" | "edit";
  initial: StatePatch;
  /** save; returns an error message if it failed */
  onSave: (p: StatePatch) => string | null;
  onDelete?: () => void;
  onClose: () => void;
}

export const StateDialog: React.FC<StateDialogProps> = ({ mode, initial, onSave, onDelete, onClose }) => {
  const { t } = useTranslation();
  const [name, setName] = useState(initial.name);
  const [isInit, setIsInit] = useState(initial.isInit);
  const [isAccept, setIsAccept] = useState(initial.isAccept);
  const [error, setError] = useState<string | null>(null);
  const save = () => {
    const err = onSave({ name: name.trim(), isInit, isAccept });
    if (err) setError(err);
    else onClose();
  };

  return (
    <Modal
      title={mode === "new" ? t("graph.stateDialog.newTitle") : t("graph.stateDialog.editTitle", { name: initial.name })}
      onClose={onClose}
    >
      <div className="gd-body">
        <label className="gd-field">
          <span>{t("editor.form.name")}</span>
          <SymbolField value={name} onChange={setName} digits onEnter={save} autoFocus />
        </label>
        <label className="gd-check">
          <input type="checkbox" checked={isInit} onChange={(e) => setIsInit(e.target.checked)} />
          <span>
            {t("graph.stateDialog.startState")}
            {initial.isInit && !isInit && (
              <em className="gd-note"> {t("graph.stateDialog.startStateNote")}</em>
            )}
          </span>
        </label>
        <label className="gd-check">
          <input type="checkbox" checked={isAccept} onChange={(e) => setIsAccept(e.target.checked)} />
          <span>{t("graph.stateDialog.acceptState")}</span>
        </label>
        {error && <div className="gd-error">{error}</div>}
      </div>
      <div className="gd-actions">
        {mode === "edit" && onDelete && (
          <button
            className="gd-btn danger"
            onClick={() => {
              if (confirm(t("graph.stateDialog.deleteConfirm", { name: initial.name }))) {
                onDelete();
                onClose();
              }
            }}
          >
            <Trash2 size={14} /> {t("graph.stateDialog.delete")}
          </button>
        )}
        <span className="spacer" />
        <button className="gd-btn" onClick={onClose}>
          {t("graph.cancel")}
        </button>
        <button className="gd-btn primary" onClick={save}>
          {t("graph.save")}
        </button>
      </div>
    </Modal>
  );
};

/* --------------------------- transition ---------------------------- */

interface EdgeDialogProps {
  /** fields generated from the machine's storages (see TransitionRow.transitionFields) */
  fields: TransitionField[];
  from: string;
  to: string;
  initial: EdgeMiddle[];
  onSave: (middles: EdgeMiddle[]) => void;
  onClose: () => void;
}

/** The transitions of one edge, set as the form sets them — its states fixed. */
export const EdgeDialog: React.FC<EdgeDialogProps> = ({ fields, from, to, initial, onSave, onClose }) => {
  const { t } = useTranslation();
  const notation = useAppStore((s) => s.formLabels) === "symbols";
  const [rows, setRows] = useState<EdgeMiddle[]>(initial.length > 0 ? initial : [emptyFields(fields)]);

  const save = () => {
    onSave(rows);
    onClose();
  };

  return (
    <Modal
      title={
        <>
          {t("graph.edgeDialog.title")} — {rich(from)} → {rich(to)}
        </>
      }
      onClose={onClose}
      wide={!notation}
    >
      <div className="gd-body">
        <div className="ef-rows" onKeyDownCapture={arrowKeysAcrossFields}>
          {!notation && <TransitionHead fields={fields} />}
          {rows.map((row, i) => (
            <TransitionRow
              key={i}
              fields={fields}
              notation={notation}
              from={from}
              to={to}
              values={row}
              onChange={(values) => setRows((rs) => rs.map((r, k) => (k === i ? values : r)))}
              onRemove={() => setRows((rs) => rs.filter((_, k) => k !== i))}
              onEnter={save}
            />
          ))}
        </div>
        <button className="ef-add" onClick={() => setRows((rs) => [...rs, emptyFields(fields)])}>
          <Plus size={13} /> {t("graph.edgeDialog.addRow")}
        </button>
        {rows.length === 0 && (
          <div className="gd-note-row">{t("graph.edgeDialog.emptyNote")}</div>
        )}
      </div>
      <div className="gd-actions">
        <span className="spacer" />
        <button className="gd-btn" onClick={onClose}>
          {t("graph.cancel")}
        </button>
        <button className="gd-btn primary" onClick={save}>
          {t("graph.save")}
        </button>
      </div>
    </Modal>
  );
};
