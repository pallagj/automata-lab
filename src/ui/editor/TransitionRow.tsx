import React from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { X } from "lucide-react";
import { StorageSpec } from "../../core/machine/machine";
import { moveLetters } from "../machineLabels";
import { SymbolField } from "./SymbolField";

/**
 * One transition, the same in the form and in the graph's edge dialog: either in the lecture
 * notes' notation — δ(q, a) = p, δ(q, a, Z) = (p, γ), δ(q, a) = (p, b, D), with more storages
 * one argument and one result per storage — or as a table row under column headers. Between
 * the states are the parts of the storage operations (editor/opFields.ts); the dialog edits
 * the transitions of one edge, so there the states are fixed.
 */

/** A field between the states: a symbol read, a word written, or a head move. */
export interface TransitionField {
  /** the column header, and the field's tooltip in the notation */
  label: string;
  placeholder: string;
  kind: "symbol" | "word" | "move";
  /** an argument of δ (what is read) or a part of its value (what is written, the move) */
  side: "arg" | "value";
}

/** The fields in the order of tokensToFields: the input symbol, then each storage's parts. */
export function transitionFields(
  t: TFunction,
  hasHead: boolean,
  storages: Pick<StorageSpec, "id" | "type">[]
): TransitionField[] {
  const fields: TransitionField[] = [];
  if (hasHead) fields.push({ label: t("editor.form.col.symbol"), placeholder: "a", kind: "symbol", side: "arg" });
  for (const { id, type } of storages) {
    if (type === "tape") {
      fields.push({ label: t("editor.form.col.read", { id }), placeholder: "a", kind: "symbol", side: "arg" });
      fields.push({ label: t("editor.form.col.write", { id }), placeholder: "b", kind: "symbol", side: "value" });
      fields.push({ label: t("editor.form.col.move", { id }), placeholder: "", kind: "move", side: "value" });
    } else if (type === "stack") {
      fields.push({ label: t("editor.form.col.pop", { id }), placeholder: "Z", kind: "symbol", side: "arg" });
      fields.push({ label: t("editor.form.col.push", { id }), placeholder: "AZ", kind: "word", side: "value" });
    } else {
      fields.push({ label: t("editor.form.col.dequeue", { id }), placeholder: "A", kind: "symbol", side: "arg" });
      fields.push({ label: t("editor.form.col.enqueue", { id }), placeholder: "BA", kind: "word", side: "value" });
    }
  }
  return fields;
}

/** A new transition's fields: all empty, a head moving right. */
export const emptyFields = (fields: TransitionField[]): string[] => fields.map((f) => (f.kind === "move" ? "R" : ""));

const MOVES = ["L", "R", "S"] as const;

/** Move picker: the move's letter (J, B, H in Hungarian); the YAML keeps R, L, S. */
export const MoveSelect: React.FC<{
  value: string;
  onChange: (v: string) => void;
}> = ({ value, onChange }) => {
  const { t } = useTranslation();
  const letters = moveLetters(t);
  return (
    <select className="move-select" value={value} onChange={(e) => onChange(e.target.value)} title={t("editor.form.moveHint")}>
      {!MOVES.some((m) => m === value) && <option value={value} hidden />}
      {MOVES.map((m) => (
        <option key={m} value={m}>
          {letters[m]}
        </option>
      ))}
    </select>
  );
};

/** The column headers over table rows. */
export const TransitionHead: React.FC<{ fields: TransitionField[] }> = ({ fields }) => {
  const { t } = useTranslation();
  return (
    <div className="ef-row ef-row-head">
      <span>{t("editor.form.col.from")}</span>
      {fields.map((f, n) => (
        <span key={n}>{f.label}</span>
      ))}
      <span>{t("editor.form.col.to")}</span>
      <span />
    </div>
  );
};

export const TransitionRow: React.FC<{
  fields: TransitionField[];
  /** δ(q, a, Z) = (p, γ) as in the lecture notes, or a row under TransitionHead */
  notation: boolean;
  from: string;
  to: string;
  /** the fields' values, in the order of `fields` */
  values: string[];
  onChange: (values: string[]) => void;
  /** without them the states are fixed */
  onFrom?: (v: string) => void;
  onTo?: (v: string) => void;
  onRemove: () => void;
  /** Enter in a field (the dialog saves) */
  onEnter?: () => void;
}> = ({ fields, notation, from, to, values, onChange, onFrom, onTo, onRemove, onEnter }) => {
  const { t } = useTranslation();
  const set = (n: number, v: string) => onChange(fields.map((_, k) => (k === n ? v : (values[k] ?? ""))));

  const state = (key: string, value: string, onSet: ((v: string) => void) | undefined, placeholder: string) => (
    <SymbolField
      key={key}
      value={value}
      onChange={onSet ?? (() => {})}
      readOnly={!onSet}
      digits
      placeholder={placeholder}
      onEnter={onEnter}
    />
  );
  const field = (n: number) =>
    fields[n].kind === "move" ? (
      <MoveSelect key={n} value={values[n] ?? "R"} onChange={(v) => set(n, v)} />
    ) : (
      <SymbolField
        key={n}
        value={values[n] ?? ""}
        onChange={(v) => set(n, v)}
        digits={false}
        epsilon
        placeholder={fields[n].placeholder}
        onEnter={onEnter}
        // in the notation the position tells what a field is; the tooltip names it
        title={notation ? fields[n].label : undefined}
      />
    );
  const remove = (
    <button className="ef-remove" title={t("editor.form.deleteRow")} onClick={onRemove}>
      <X size={13} />
    </button>
  );

  if (!notation)
    return (
      <div className="ef-row">
        {state("from", from, onFrom, "S")}
        {fields.map((_, n) => field(n))}
        {state("to", to, onTo, "A")}
        {remove}
      </div>
    );

  const args = [state("from", from, onFrom, "q"), ...fields.flatMap((f, n) => (f.side === "arg" ? [field(n)] : []))];
  const results = [state("to", to, onTo, "p"), ...fields.flatMap((f, n) => (f.side === "value" ? [field(n)] : []))];
  const list = (els: React.ReactElement[]) =>
    els.flatMap((el, i) => (i === 0 ? [el] : [<span key={`c${el.key}`} className="ef-op ef-comma">,</span>, el]));
  return (
    <div className="ef-row ef-row-delta">
      <span className="ef-op ef-delta">δ(</span>
      {list(args)}
      <span className="ef-op ef-eq">) =</span>
      {results.length === 1 ? (
        results[0]
      ) : (
        <>
          <span className="ef-op">(</span>
          {list(results)}
          <span className="ef-op">)</span>
        </>
      )}
      {remove}
    </div>
  );
};
