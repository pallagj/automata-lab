import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import yaml from "js-yaml";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { Plus, TriangleAlert, X } from "lucide-react";
import { Machine, machineCaps, MachineCaps, StorageSpec, StorageType } from "../../core/machine/machine";
import { parseStorageEntry } from "../../core/parse/definitionParser";
import { useAppStore } from "../../state/store";
import { machineKindLabel } from "../machineLabels";

/**
 * Interactive entity editor: the machine/grammar can be entered in a form
 * instead of YAML — the cell's source stays YAML and is converted back and forth.
 *
 * There is a single machine type (Machine); whether it is an automaton, a pushdown
 * automaton or a Turing machine is decided by its storage configuration. Storages
 * are edited as structured rows and the transition columns are generated from them.
 */

export type EntityKind = "machine" | "grammar";

export interface EntityDraft {
  kind: EntityKind;
  name: string;
  charset: string;
  /** states (machine) / variables (grammar) */
  states: string;
  init: string;
  accept: string;
  acceptMode: string;
  /** "head" (read head) or the id of a storage */
  input: string;
  storages: StorageSpec[];
  /** transitions / rules split into parts (tokens) */
  rows: string[][];
}

/** Top-level keys; gep/gép/nyelvtan are legacy Hungarian aliases kept for old worksheets. */
const KIND_BY_KEY: Record<string, EntityKind> = {
  Machine: "machine",
  machine: "machine",
  gep: "machine",
  gép: "machine",
  Grammar: "grammar",
  grammar: "grammar",
  nyelvtan: "grammar"
};

/** Determines from the cell source whether it is an entity (and which kind). */
export function detectEntityKind(source: string): EntityKind | null {
  const m = /^\s*([A-Za-zÀ-ž]+)\s*:/.exec(source);
  return m ? (KIND_BY_KEY[m[1]] ?? null) : null;
}

export function draftStorages(d: EntityDraft): StorageSpec[] {
  return d.kind === "machine" ? d.storages : [];
}

/** how many tokens a storage occupies in a transition line */
const tokensOf = (t: StorageType) => (t === "tape" ? 2 : 1);

export function rowArity(d: EntityDraft): number {
  if (d.kind === "grammar") return 2;
  return 2 + (d.input === "head" ? 1 : 0) + d.storages.reduce((n, s) => n + tokensOf(s.type), 0);
}

function fieldText(v: unknown): string {
  if (v === undefined || v === null) return "";
  if (Array.isArray(v)) return v.map((x) => String(x)).join(", ");
  return String(v);
}

function splitRow(arity: number, isGrammar: boolean, raw: string): string[] {
  if (isGrammar) {
    const i = raw.indexOf("->");
    return i >= 0 ? [raw.slice(0, i).trim(), raw.slice(i + 2).trim()] : [raw.trim(), ""];
  }
  const parts = raw.trim() === "" ? [] : raw.trim().split(/\s+/);
  while (parts.length < arity) parts.push("");
  return parts.slice(0, arity);
}

/** YAML → form draft; null if it cannot be interpreted (right now). */
export function parseEntityDraft(source: string): EntityDraft | null {
  const kind = detectEntityKind(source);
  if (!kind) return null;
  let parsed: unknown;
  try {
    parsed = yaml.load(source);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const key = Object.keys(parsed as object).find((k) => KIND_BY_KEY[k] === kind);
  if (!key) return null;
  const body = (parsed as Record<string, unknown>)[key];
  if (typeof body !== "object" || body === null) return null;
  const b = body as Record<string, unknown>;

  const storages: StorageSpec[] = [];
  if (kind === "machine") {
    const raw = b["storages"];
    if (raw !== undefined && raw !== null) {
      if (typeof raw !== "object" || Array.isArray(raw)) return null;
      for (const [id, v] of Object.entries(raw as Record<string, unknown>)) {
        const r = parseStorageEntry(id.trim(), v);
        if (!r.ok) return null;
        storages.push(r.value!);
      }
    }
  }

  const draft: EntityDraft = {
    kind,
    name: fieldText(b["name"]),
    charset: fieldText(b["charset"]),
    states: fieldText(kind === "grammar" ? b["variables"] : b["states"]),
    init: fieldText(b["init"]),
    accept: fieldText(b["accept"]),
    acceptMode: fieldText(b["acceptMode"]) === "emptyStorages" ? "emptyStorages" : "finalState",
    input: fieldText(b["input"]) || "head",
    storages,
    rows: []
  };
  const arity = rowArity(draft);
  const rowsRaw = b[kind === "grammar" ? "rules" : "transitions"];
  draft.rows = (Array.isArray(rowsRaw) ? rowsRaw : []).map((r) =>
    splitRow(arity, kind === "grammar", r === null ? "" : String(r))
  );
  return draft;
}

/** Quotes YAML-unsafe scalars (as in serialize.ts). */
const NEEDS_QUOTE = /[{}[\]:#'"&*?|>%@`]|^[\s-]|^$/;
const scalar = (s: string) => (NEEDS_QUOTE.test(s) ? `"${s.replaceAll('"', '\\"')}"` : s);

const defaultInit = (type: StorageType) => (type === "stack" ? "Z" : "");

export function serializeEntityDraft(d: EntityDraft): string {
  if (d.kind === "grammar") {
    const lines = [
      "Grammar:",
      `  name: ${scalar(d.name)}`,
      `  charset: ${scalar(d.charset)}`,
      `  variables: ${scalar(d.states)}`,
      `  init: ${scalar(d.init)}`,
      "  rules:"
    ];
    for (const r of d.rows) lines.push(`    - ${r[0].trim()} -> ${r[1].trim()}`);
    return lines.join("\n");
  }

  const lines = [
    "Machine:",
    `  name: ${scalar(d.name)}`,
    `  charset: ${scalar(d.charset)}`,
    `  states: ${scalar(d.states)}`,
    `  init: ${scalar(d.init)}`,
    `  accept: ${scalar(d.accept)}`
  ];
  if (d.acceptMode === "emptyStorages") lines.push("  acceptMode: emptyStorages");
  if (d.input !== "head") lines.push(`  input: ${scalar(d.input)}`);
  if (d.storages.length > 0) {
    lines.push("  storages:");
    for (const s of d.storages) {
      if (s.init === defaultInit(s.type)) {
        lines.push(`    ${s.id}: ${s.type}`);
      } else {
        lines.push(`    ${s.id}:`);
        lines.push(`      type: ${s.type}`);
        lines.push(`      init: ${scalar(s.init)}`);
      }
    }
  }
  lines.push("  transitions:");
  for (const r of d.rows) lines.push(`    - ${scalar(r.join(" ").trim())}`);
  return lines.join("\n");
}

/* ---------------------- columns for transition rows ---------------------- */

export interface RowColumn {
  header: string;
  placeholder: string;
  widget: "text" | "move";
}

export function rowColumns(t: TFunction, d: EntityDraft): RowColumn[] {
  if (d.kind === "grammar")
    return [
      { header: t("editor.form.col.leftSide"), placeholder: "S", widget: "text" },
      { header: t("editor.form.col.rightSide"), placeholder: "aS | b", widget: "text" }
    ];
  const cols: RowColumn[] = [{ header: t("editor.form.col.from"), placeholder: "S", widget: "text" }];
  if (d.input === "head") cols.push({ header: t("editor.form.col.symbol"), placeholder: "a", widget: "text" });
  for (const s of d.storages) {
    if (s.type === "tape") {
      cols.push({ header: t("editor.form.col.readWrite", { id: s.id }), placeholder: "a/b", widget: "text" });
      cols.push({ header: t("editor.form.col.move"), placeholder: ">", widget: "move" });
    } else {
      cols.push({
        header: s.type === "stack" ? t("editor.form.col.pushPop", { id: s.id }) : t("editor.form.col.enqueueDequeue", { id: s.id }),
        placeholder: s.type === "stack" ? "Z/AZ" : "A/BA",
        widget: "text"
      });
    }
  }
  cols.push({ header: t("editor.form.col.to"), placeholder: "A", widget: "text" });
  return cols;
}

function emptyRow(cols: RowColumn[], isGrammar: boolean): string[] {
  if (isGrammar) return ["", ""];
  return cols.map((c) => (c.widget === "move" ? ">" : ""));
}

/** Move picker: arrows only, text would not fit anyway. */
export const MoveSelect: React.FC<{
  value: string;
  onChange: (v: string) => void;
}> = ({ value, onChange }) => {
  const { t } = useTranslation();
  return (
    <select className="move-select" value={value} onChange={(e) => onChange(e.target.value)} title={t("editor.form.moveHint")}>
      {![">", "<", "="].includes(value) && <option value={value} hidden />}
      <option value=">">→</option>
      <option value="<">←</option>
      <option value="=">•</option>
    </select>
  );
};

/** The recognised machine kind — depends only on the input and the storages. */
function draftKindCaps(d: EntityDraft): MachineCaps {
  const probe: Machine = {
    kind: "machine",
    name: "",
    alphabet: [],
    states: [],
    start: "",
    accept: [],
    acceptMode: "finalState",
    input: d.input,
    storages: d.storages,
    transitions: []
  };
  return machineCaps(probe);
}

/* ------------------- machine-kind change warning dialog ------------------- */

interface KindChangeRequest {
  fromCaps: MachineCaps;
  toCaps: MachineCaps;
  apply: () => void;
}

const KindChangeDialog: React.FC<{ req: KindChangeRequest; onClose: () => void }> = ({ req, onClose }) => {
  const { t } = useTranslation();
  const setHide = useAppStore((s) => s.setHideKindChangeWarning);
  const [dontAskAgain, setDontAskAgain] = useState(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return createPortal(
    <div className="modal-back" onClick={onClose}>
      <div className="modal gdialog" onClick={(e) => e.stopPropagation()}>
        <div className="gd-head">
          <h2>
            <TriangleAlert size={16} style={{ verticalAlign: "-3px", marginRight: 6 }} />
            {t("editor.form.kindChangeTitle")}
          </h2>
          <button className="icon-btn" onClick={onClose}>
            <X size={15} />
          </button>
        </div>
        <div className="gd-body">
          <p style={{ margin: 0 }}>
            {t("editor.form.kindChangeBody1")} <b>{machineKindLabel(t, req.fromCaps, true)}</b>{" "}
            {t("editor.form.kindChangeBody2")} <b>{machineKindLabel(t, req.toCaps, true)}</b>
            {t("editor.form.kindChangeBody3")}
          </p>
          <label className="gd-check">
            <input
              type="checkbox"
              checked={dontAskAgain}
              onChange={(e) => setDontAskAgain(e.target.checked)}
            />
            <span>{t("editor.form.dontAskAgain")}</span>
          </label>
        </div>
        <div className="gd-actions">
          <span className="spacer" />
          <button className="gd-btn" onClick={onClose}>
            {t("editor.form.cancel")}
          </button>
          <button
            className="gd-btn primary"
            onClick={() => {
              if (dontAskAgain) setHide(true);
              req.apply();
              onClose();
            }}
          >
            {t("editor.form.confirmChange")}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
};

/* ----------------------------- storages ---------------------------- */

const STORAGE_TYPE_KEY: Record<StorageType, string> = {
  stack: "editor.form.storageType.stack",
  queue: "editor.form.storageType.queue",
  tape: "editor.form.storageType.tape"
};

function freshStorageId(used: Set<string>): string {
  for (const base of ["v", "t", "s"]) {
    for (let i = 1; i < 10; i++) {
      if (!used.has(`${base}${i}`)) return `${base}${i}`;
    }
  }
  let i = 1;
  while (used.has(`st${i}`)) i++;
  return `st${i}`;
}

interface Props {
  source: string;
  onChange: (source: string) => void;
}

export const EntityForm: React.FC<Props> = ({ source, onChange }) => {
  const { t } = useTranslation();
  const [draft, setDraft] = useState<EntityDraft | null>(() => parseEntityDraft(source));
  const lastSerialized = useRef(source);
  const hideKindWarning = useAppStore((s) => s.hideKindChangeWarning);
  const [kindChange, setKindChange] = useState<KindChangeRequest | null>(null);

  // follow external source changes (e.g. editing in the code view)
  useEffect(() => {
    if (source !== lastSerialized.current) {
      lastSerialized.current = source;
      setDraft(parseEntityDraft(source));
    }
  }, [source]);

  if (!draft) return null;

  const update = (d: EntityDraft) => {
    setDraft(d);
    const s = serializeEntityDraft(d);
    lastSerialized.current = s;
    onChange(s);
  };

  /** the token(s) that leave the given storage untouched in a transition line */
  const noOpTokens = (s: StorageSpec): string[] => (s.type === "tape" ? ["./&", "="] : ["$/$"]);

  /**
   * When the storages or the input change, the existing rows are rearranged: the
   * remaining storages keep their operations (matched by id) and new ones get a
   * no-op — so the machine's behaviour does not change, it is only extended.
   */
  const reshapeRows = (prev: EntityDraft, next: EntityDraft, renames?: Map<string, string>): EntityDraft => {
    const prevStorages = prev.storages;
    return {
      ...next,
      rows: prev.rows.map((r) => {
        const from = r[0] ?? "";
        const to = r[r.length - 1] ?? "";
        let i = 1;
        let oldInput: string | null = null;
        if (prev.input === "head") oldInput = r[i++] ?? "$";
        const oldOps = new Map<string, string[]>();
        for (const s of prevStorages) {
          const n = tokensOf(s.type);
          oldOps.set(s.id, r.slice(i, i + n));
          i += n;
        }
        const middle: string[] = [];
        if (next.input === "head") middle.push(oldInput ?? "$");
        for (const s of next.storages) {
          const oldId = renames?.get(s.id) ?? s.id;
          const old = oldOps.get(oldId);
          const prevSpec = prevStorages.find((x) => x.id === oldId);
          // on a type change the old operation becomes meaningless → no-op
          if (old && prevSpec && prevSpec.type === s.type) middle.push(...old);
          else middle.push(...noOpTokens(s));
        }
        return [from, ...middle, to];
      })
    };
  };

  /**
   * Structural change (storages/input): if it would change the machine's recognised
   * kind, ask for confirmation first — unless the user has turned that off.
   */
  const commitStructural = (next: EntityDraft, renames?: Map<string, string>) => {
    const apply = () => update(reshapeRows(draft, next, renames));
    const fromCaps = draftKindCaps(draft);
    const toCaps = draftKindCaps(next);
    const sig = (c: MachineCaps) => `${c.kind}:${JSON.stringify(c.storageCounts ?? {})}`;
    if (sig(fromCaps) !== sig(toCaps) && !hideKindWarning) {
      setKindChange({ fromCaps, toCaps, apply });
    } else {
      apply();
    }
  };

  const setField = (field: keyof EntityDraft, value: string) => {
    const next: EntityDraft = { ...draft, [field]: value };
    if (field === "input") commitStructural(next);
    else update(next);
  };

  const setStorages = (storages: StorageSpec[]) => {
    const next: EntityDraft = { ...draft, storages };
    // if the input pointed at a deleted storage, fall back to the read head
    if (next.input !== "head" && !storages.some((s) => s.id === next.input)) next.input = "head";
    commitStructural(next);
  };

  const setStorage = (i: number, patch: Partial<StorageSpec>) => {
    const prev = draft.storages[i];
    const updated = { ...prev, ...patch };
    // on a type change the default initial content follows too, if it was the default
    if (patch.type && prev.init === defaultInit(prev.type)) updated.init = defaultInit(patch.type);
    // the input reference follows the rename
    const storages = draft.storages.map((s, k) => (k === i ? updated : s));
    const next: EntityDraft = { ...draft, storages };
    const renames = patch.id ? new Map([[updated.id, prev.id]]) : undefined;
    if (patch.id && draft.input === prev.id) next.input = patch.id;
    commitStructural(next, renames);
  };

  const addStorage = () => {
    const used = new Set(draft.storages.map((s) => s.id));
    setStorages([...draft.storages, { id: freshStorageId(used), type: "stack", init: "Z" }]);
  };

  const setRow = (i: number, j: number, value: string) => {
    const rows = draft.rows.map((r, k) => (k === i ? r.map((p, l) => (l === j ? value : p)) : r));
    update({ ...draft, rows });
  };
  const cols = rowColumns(t, draft);
  const addRow = () => update({ ...draft, rows: [...draft.rows, emptyRow(cols, draft.kind === "grammar")] });
  const removeRow = (i: number) => update({ ...draft, rows: draft.rows.filter((_, k) => k !== i) });

  const k = draft.kind;

  return (
    <div className="entity-form" onClick={(e) => e.stopPropagation()}>
      <div className="ef-grid">
        <label>
          <span>{t("editor.form.name")}</span>
          <input value={draft.name} onChange={(e) => setField("name", e.target.value)} placeholder="M" />
        </label>
        <label>
          <span>{t("editor.form.alphabet")}</span>
          <input value={draft.charset} onChange={(e) => setField("charset", e.target.value)} placeholder="a, b" />
        </label>
        <label>
          <span>{k === "grammar" ? t("editor.form.variables") : t("editor.form.states")}</span>
          <input value={draft.states} onChange={(e) => setField("states", e.target.value)} placeholder="S, A" />
        </label>
        <label>
          <span>{k === "grammar" ? t("editor.form.startVariable") : t("editor.form.startState")}</span>
          <input value={draft.init} onChange={(e) => setField("init", e.target.value)} placeholder="S" />
        </label>
        {k === "machine" && (
          <label>
            <span>{t("editor.form.accepting")}</span>
            <input value={draft.accept} onChange={(e) => setField("accept", e.target.value)} placeholder="A" />
          </label>
        )}
        {k === "machine" && draft.storages.length > 0 && (
          <>
            <label>
              <span>{t("editor.form.input")}</span>
              <select value={draft.input} onChange={(e) => setField("input", e.target.value)}>
                <option value="head">{t("editor.form.readHead")}</option>
                {draft.storages.map((s) => (
                  <option key={s.id} value={s.id}>
                    {t("editor.form.writtenToStorage", { id: s.id })}
                  </option>
                ))}
              </select>
            </label>
            {draft.input === "head" && (
              <label>
                <span>{t("editor.form.acceptance")}</span>
                <select value={draft.acceptMode} onChange={(e) => setField("acceptMode", e.target.value)}>
                  <option value="finalState">{t("editor.form.acceptFinalState")}</option>
                  <option value="emptyStorages">{t("editor.form.acceptEmptyStorages")}</option>
                </select>
              </label>
            )}
          </>
        )}
      </div>

      {k === "machine" && (
        <div className="ef-storages">
          {draft.storages.length > 0 && (
            <div className="ef-storage-row ef-storage-head">
              <span>{t("editor.form.storage")}</span>
              <span>{t("editor.form.type")}</span>
              <span>{t("editor.form.initialContent")}</span>
              <span />
            </div>
          )}
          {draft.storages.map((s, i) => (
            <div className="ef-storage-row" key={i}>
              <input
                value={s.id}
                onChange={(e) => setStorage(i, { id: e.target.value.trim() })}
                placeholder={t("editor.form.namePlaceholder")}
                spellCheck={false}
              />
              <select value={s.type} onChange={(e) => setStorage(i, { type: e.target.value as StorageType })}>
                {(Object.keys(STORAGE_TYPE_KEY) as StorageType[]).map((ty) => (
                  <option key={ty} value={ty}>
                    {t(STORAGE_TYPE_KEY[ty])}
                  </option>
                ))}
              </select>
              <input
                value={s.init}
                onChange={(e) => setStorage(i, { init: e.target.value })}
                placeholder={s.type === "tape" ? t("editor.form.tapeInitPlaceholder") : t("editor.form.initialContentPlaceholder")}
                spellCheck={false}
              />
              <button
                className="ef-remove"
                title={t("editor.form.deleteStorage")}
                onClick={() => setStorages(draft.storages.filter((_, j) => j !== i))}
              >
                <X size={13} />
              </button>
            </div>
          ))}
          <button className="ef-add" onClick={addStorage} title={t("editor.form.addStorageHint")}>
            <Plus size={13} /> {draft.storages.length === 0 ? t("editor.form.addStorage") : t("editor.form.newStorage")}
          </button>
        </div>
      )}

      <div className="ef-rows">
        <div className="ef-row ef-row-head">
          {cols.map((c, i) => (
            <span key={i}>{c.header}</span>
          ))}
          <span />
        </div>
        {draft.rows.map((row, i) => (
          <div className="ef-row" key={i}>
            {row.map((part, j) =>
              cols[j]?.widget === "move" ? (
                <MoveSelect key={j} value={part} onChange={(v) => setRow(i, j, v)} />
              ) : (
                <input
                  key={j}
                  value={part}
                  onChange={(e) => setRow(i, j, e.target.value)}
                  placeholder={cols[j]?.placeholder ?? ""}
                  className={k === "grammar" && j === 1 ? "wide" : ""}
                />
              )
            )}
            <button className="ef-remove" title={t("editor.form.deleteRow")} onClick={() => removeRow(i)}>
              <X size={13} />
            </button>
          </div>
        ))}
        <button className="ef-add" onClick={addRow}>
          <Plus size={13} /> {k === "grammar" ? t("editor.form.newRule") : t("editor.form.newTransition")}
        </button>
      </div>

      {kindChange && <KindChangeDialog req={kindChange} onClose={() => setKindChange(null)} />}
    </div>
  );
};
