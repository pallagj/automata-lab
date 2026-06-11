import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Plus, Trash2, X } from "lucide-react";
import { EdgeField, EdgeMiddle, StatePatch } from "./editing";

/** Kidolgozott szerkesztő-dialógusok a gráfhoz (állapot / átmenet). */

const Modal: React.FC<{ title: string; onClose: () => void; children: React.ReactNode }> = ({
  title,
  onClose,
  children
}) => {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return createPortal(
    <div className="modal-back" onClick={onClose}>
      <div className="modal gdialog" onClick={(e) => e.stopPropagation()}>
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

/* ----------------------------- állapot ----------------------------- */

interface StateDialogProps {
  mode: "new" | "edit";
  initial: StatePatch;
  /** mentés; hibaüzenettel tér vissza, ha nem sikerült */
  onSave: (p: StatePatch) => string | null;
  onDelete?: () => void;
  onClose: () => void;
}

export const StateDialog: React.FC<StateDialogProps> = ({ mode, initial, onSave, onDelete, onClose }) => {
  const [name, setName] = useState(initial.name);
  const [isInit, setIsInit] = useState(initial.isInit);
  const [isAccept, setIsAccept] = useState(initial.isAccept);
  const [error, setError] = useState<string | null>(null);
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    nameRef.current?.focus();
    nameRef.current?.select();
  }, []);

  const save = () => {
    const err = onSave({ name: name.trim(), isInit, isAccept });
    if (err) setError(err);
    else onClose();
  };

  return (
    <Modal title={mode === "new" ? "Új állapot" : `Állapot — ${initial.name}`} onClose={onClose}>
      <div className="gd-body">
        <label className="gd-field">
          <span>Név</span>
          <input
            ref={nameRef}
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && save()}
            spellCheck={false}
          />
        </label>
        <label className="gd-check">
          <input type="checkbox" checked={isInit} onChange={(e) => setIsInit(e.target.checked)} />
          <span>
            Kezdőállapot
            {initial.isInit && !isInit && (
              <em className="gd-note"> — a kezdőállapot máshova jelöléssel vihető át</em>
            )}
          </span>
        </label>
        <label className="gd-check">
          <input type="checkbox" checked={isAccept} onChange={(e) => setIsAccept(e.target.checked)} />
          <span>Elfogadó állapot</span>
        </label>
        {error && <div className="gd-error">{error}</div>}
      </div>
      <div className="gd-actions">
        {mode === "edit" && onDelete && (
          <button
            className="gd-btn danger"
            onClick={() => {
              if (confirm(`Törlöd a(z) „${initial.name}” állapotot az átmeneteivel együtt?`)) {
                onDelete();
                onClose();
              }
            }}
          >
            <Trash2 size={14} /> Törlés
          </button>
        )}
        <span className="spacer" />
        <button className="gd-btn" onClick={onClose}>
          Mégse
        </button>
        <button className="gd-btn primary" onClick={save}>
          Mentés
        </button>
      </div>
    </Modal>
  );
};

/* ----------------------------- átmenet ----------------------------- */

interface EdgeDialogProps {
  /** a gép tárolóiból generált mezők (l. editing.edgeFieldsFor) */
  fields: EdgeField[];
  from: string;
  to: string;
  initial: EdgeMiddle[];
  onSave: (middles: EdgeMiddle[]) => void;
  onClose: () => void;
}

export const EdgeDialog: React.FC<EdgeDialogProps> = ({ fields, from, to, initial, onSave, onClose }) => {
  const empty = () => fields.map((f) => (f.widget === "move" ? ">" : ""));
  const [rows, setRows] = useState<EdgeMiddle[]>(initial.length > 0 ? initial : [empty()]);

  const setCell = (i: number, j: number, v: string) =>
    setRows((rs) => rs.map((r, k) => (k === i ? r.map((c, l) => (l === j ? v : c)) : r)));

  const save = () => {
    onSave(rows);
    onClose();
  };

  return (
    <Modal title={`Átmenet — ${from} → ${to}`} onClose={onClose}>
      <div className="gd-body">
        <div className="gd-edge-grid" style={{ gridTemplateColumns: `repeat(${fields.length}, 1fr) 28px` }}>
          {fields.map((f) => (
            <span key={f.label} className="gd-col-label">
              {f.label}
            </span>
          ))}
          <span />
          {rows.map((row, i) => (
            <React.Fragment key={i}>
              {row.map((val, j) =>
                fields[j]?.widget === "move" ? (
                  <select key={j} value={val} onChange={(e) => setCell(i, j, e.target.value)}>
                    {![">", "<", "="].includes(val) && <option value={val} hidden />}
                    <option value=">">→ jobbra</option>
                    <option value="<">← balra</option>
                    <option value="=">• helyben</option>
                  </select>
                ) : (
                  <input
                    key={j}
                    value={val}
                    placeholder={fields[j].placeholder}
                    onChange={(e) => setCell(i, j, e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && save()}
                    spellCheck={false}
                  />
                )
              )}
              <button
                className="ef-remove"
                title="Sor törlése"
                onClick={() => setRows((rs) => rs.filter((_, k) => k !== i))}
              >
                <X size={13} />
              </button>
            </React.Fragment>
          ))}
        </div>
        <button className="ef-add" onClick={() => setRows((rs) => [...rs, empty()])}>
          <Plus size={13} /> új átmenet ezen az élen
        </button>
        {rows.length === 0 && (
          <div className="gd-note-row">Nincs sor — a mentés törli az él összes átmenetét.</div>
        )}
      </div>
      <div className="gd-actions">
        <span className="spacer" />
        <button className="gd-btn" onClick={onClose}>
          Mégse
        </button>
        <button className="gd-btn primary" onClick={save}>
          Mentés
        </button>
      </div>
    </Modal>
  );
};
