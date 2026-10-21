import React, { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import yaml from "js-yaml";
import { useTranslation } from "react-i18next";
import { ChevronRight, Plus, TriangleAlert, X } from "lucide-react";
import { Machine, machineCaps, MachineCaps, StorageType, TAPE_BLANK, TapeExtent } from "../../core/machine/machine";
import { deltaToRow, fieldCount, readDelta, rowToDelta, transitionScalar, writeDelta } from "../../core/parse/delta";
import { symbolsText } from "../../core/symbols";
import { SymbolField } from "./SymbolField";
import { arrowKeysAcrossFields } from "./formNav";
import { emptyFields, TransitionHead, TransitionRow, transitionFields } from "./TransitionRow";
import { RuleHead, RuleRow } from "./RuleRow";
import { parseMachine, parseStorageEntry } from "../../core/parse/definitionParser";
import { useAppStore } from "../../state/store";
import { machineKindLabel } from "../machineLabels";
import { EPS } from "../../core/types";

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
  storages: DraftStorage[];
  /**
   * transitions as δ's fields — the state, the input symbol, each storage's fields, the next
   * state (see parse/delta.ts) — and rules as the left-hand side, then each alternative
   */
  rows: string[][];
}

const KIND_BY_KEY: Record<string, EntityKind> = {
  Machine: "machine",
  machine: "machine",
  Grammar: "grammar",
  grammar: "grammar"
};

/** Determines from the cell source whether it is an entity (and which kind). */
export function detectEntityKind(source: string): EntityKind | null {
  const m = /^\s*([A-Za-zÀ-ž]+)\s*:/.exec(source);
  return m ? (KIND_BY_KEY[m[1]] ?? null) : null;
}

/** A storage as the form edits it: its alphabet and initial content as typed ("" = the default). */
export interface DraftStorage {
  id: string;
  type: StorageType;
  charset: string;
  init: string;
  /** a tape's extent; "right" for the other storages too, where it means nothing */
  infinite: TapeExtent;
}

export function draftStorages(d: EntityDraft): DraftStorage[] {
  return d.kind === "machine" ? d.storages : [];
}

function fieldText(v: unknown): string {
  if (v === undefined || v === null) return "";
  if (Array.isArray(v)) return v.map((x) => String(x)).join(", ");
  return String(v);
}

const list = (s: string) => s.split(",").map((x) => x.trim()).filter(Boolean);

/** A rule: its left-hand side, then the alternatives of its right-hand side. */
function splitRule(raw: string): string[] {
  const i = raw.indexOf("->");
  if (i < 0) return [raw.trim(), ""];
  return [raw.slice(0, i).trim(), ...raw.slice(i + 2).split("|").map((alt) => alt.trim())];
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

  const storages: DraftStorage[] = [];
  if (kind === "machine") {
    const raw = b["storages"];
    if (raw !== undefined && raw !== null) {
      if (typeof raw !== "object" || Array.isArray(raw)) return null;
      for (const [id, v] of Object.entries(raw as Record<string, unknown>)) {
        const r = parseStorageEntry(id.trim(), v);
        if (!r.ok) return null;
        const charset = typeof v === "object" && v !== null ? fieldText((v as Record<string, unknown>)["charset"]) : "";
        storages.push({
          id: r.value!.id,
          type: r.value!.type,
          charset,
          init: symbolsText(r.value!.init),
          infinite: r.value!.infinite ?? "right"
        });
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
  const rowsRaw = b[kind === "grammar" ? "rules" : "transitions"];
  const types = storages.map((s) => s.type);
  draft.rows = (Array.isArray(rowsRaw) ? rowsRaw : []).map((r) => {
    const raw = r === null ? "" : String(r);
    return kind === "grammar" ? splitRule(raw) : deltaToRow(readDelta(raw), draft.input === "head", types);
  });
  return draft;
}

/** Quotes YAML-unsafe scalars (as in serialize.ts). */
const NEEDS_QUOTE = /[{}[\]:#'"&*?|>%@`]|^[\s-]|^$/;
const scalar = (s: string) => (NEEDS_QUOTE.test(s) ? `"${s.replaceAll('"', '\\"')}"` : s);

const defaultInit = (type: StorageType) => (type === "stack" ? "Z" : "");

/** what an alphabet looks like, where the default one is not known yet */
const CHARSET_PLACEHOLDER: Record<StorageType, string> = { stack: "Z, A", queue: "A, B", tape: "a, b, _" };

export function serializeEntityDraft(d: EntityDraft): string {
  if (d.kind === "grammar") {
    const lines = [
      "Grammar:",
      // an empty name leaves the definition unnamed
      ...(d.name.trim() ? [`  name: ${scalar(d.name)}`] : []),
      `  charset: ${scalar(d.charset)}`,
      `  variables: ${scalar(d.states)}`,
      `  init: ${scalar(d.init)}`,
      "  rules:"
    ];
    // an alternative left empty in the form is not written: the empty word is ε
    for (const r of d.rows) {
      const right = r.slice(1).map((alt) => alt.trim()).filter((alt) => alt !== "");
      lines.push(`    - ${r[0].trim()} -> ${right.join(" | ")}`);
    }
    return lines.join("\n");
  }

  const lines = [
    "Machine:",
    ...(d.name.trim() ? [`  name: ${scalar(d.name)}`] : []),
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
      const charset = s.charset.trim();
      const bothWays = s.type === "tape" && s.infinite === "both";
      if (charset === "" && s.init === defaultInit(s.type) && !bothWays) {
        lines.push(`    ${s.id}: ${s.type}`);
      } else {
        lines.push(`    ${s.id}:`);
        lines.push(`      type: ${s.type}`);
        if (bothWays) lines.push("      infinite: both");
        if (charset !== "") lines.push(`      charset: ${scalar(charset)}`);
        if (s.init !== defaultInit(s.type)) lines.push(`      init: ${scalar(s.init)}`);
      }
    }
  }
  lines.push("  transitions:");
  const types = d.storages.map((s) => s.type);
  for (const r of d.rows) {
    const { args, values } = rowToDelta(r.map((p) => p.trim()), d.input === "head", types);
    lines.push(`    - ${transitionScalar(writeDelta(args, values))}`);
  }
  return lines.join("\n");
}

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
    storages: d.storages.map((s) => ({ id: s.id, type: s.type, alphabet: [], init: [] })),
    transitions: []
  };
  return machineCaps(probe);
}

/**
 * Whether the machine's setup is just what its kind implies: an automaton, a pushdown
 * automaton read with a head or a Turing machine with the input on its tape, each storage
 * starting with its default content and a head-read machine accepting in a final state.
 * Then the setup may fold away; otherwise it stays open, so nothing unusual hides.
 */
function setupFollowsKind(d: EntityDraft): boolean {
  if (draftKindCaps(d).kind === "general") return false;
  if (d.storages.some((s) => s.init !== defaultInit(s.type))) return false;
  // a tape infinite both ways differs from the notes' tape: it stays in sight
  if (d.storages.some((s) => s.type === "tape" && s.infinite === "both")) return false;
  return !(d.input === "head" && d.storages.length > 0 && d.acceptMode === "emptyStorages");
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

/** The storage kinds to choose from: a tape is infinite to the right (the notes' tape) or both ways. */
const STORAGE_CHOICES: { value: string; type: StorageType; infinite: TapeExtent; key: string }[] = [
  { value: "stack", type: "stack", infinite: "right", key: "editor.form.storageType.stack" },
  { value: "queue", type: "queue", infinite: "right", key: "editor.form.storageType.queue" },
  { value: "tape", type: "tape", infinite: "right", key: "editor.form.storageType.tape" },
  { value: "tape-both", type: "tape", infinite: "both", key: "editor.form.storageType.tapeBothWays" }
];
const storageChoice = (s: DraftStorage) => (s.type === "tape" && s.infinite === "both" ? "tape-both" : s.type);

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

  const formLabels = useAppStore((s) => s.formLabels);
  // a setup that its kind implies folds into the kind's name until asked for; any other stays open
  const [configOpen, setConfigOpen] = useState(false);
  const followsKind = draft?.kind === "machine" && setupFollowsKind(draft);
  useEffect(() => {
    if (!followsKind) setConfigOpen(true);
  }, [followsKind]);
  // a long list of transitions or rules can fold away; it starts open
  const [rowsOpen, setRowsOpen] = useState(true);
  // an alphabet left out is the default one: the field shows what it is
  const resolved = useMemo(() => (draft?.kind === "machine" ? parseMachine(source).value : undefined), [source, draft?.kind]);

  if (!draft) return null;

  const update = (d: EntityDraft) => {
    setDraft(d);
    const s = serializeEntityDraft(d);
    lastSerialized.current = s;
    onChange(s);
  };

  /**
   * the fields that leave a storage untouched: ε for a stack or a queue; a tape cell always
   * holds a symbol, which is written back — one row per symbol of the tape's alphabet
   */
  const noOps = (s: DraftStorage, d: EntityDraft): string[][] =>
    s.type !== "tape"
      ? [[EPS, EPS]]
      : (list(s.charset).length > 0 ? list(s.charset) : [...list(d.charset), TAPE_BLANK]).map((x) => [x, x, "S"]);

  /**
   * When the storages or the input change, the existing rows are rearranged: the
   * remaining storages keep their operations (matched by id) and new ones get a
   * no-op — so the machine's behaviour does not change, it is only extended.
   */
  const reshapeRows = (prev: EntityDraft, next: EntityDraft, renames?: Map<string, string>): EntityDraft => {
    const prevStorages = prev.storages;
    return {
      ...next,
      rows: prev.rows.flatMap((r) => {
        const from = r[0] ?? "";
        const to = r[r.length - 1] ?? "";
        let i = 1;
        let oldInput: string | null = null;
        if (prev.input === "head") oldInput = r[i++] ?? EPS;
        const oldOps = new Map<string, string[]>();
        for (const s of prevStorages) {
          const n = fieldCount(s.type);
          oldOps.set(s.id, r.slice(i, i + n));
          i += n;
        }
        let middles: string[][] = [next.input === "head" ? [oldInput ?? EPS] : []];
        for (const s of next.storages) {
          const oldId = renames?.get(s.id) ?? s.id;
          const old = oldOps.get(oldId);
          const prevSpec = prevStorages.find((x) => x.id === oldId);
          // on a type change the old operation becomes meaningless → no-op
          const options = old && prevSpec && prevSpec.type === s.type ? [old] : noOps(s, next);
          middles = middles.flatMap((m) => options.map((o) => [...m, ...o]));
        }
        return middles.map((m) => [from, ...m, to]);
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

  const setStorages = (storages: DraftStorage[]) => {
    const next: EntityDraft = { ...draft, storages };
    // if the input pointed at a deleted storage, fall back to the read head
    if (next.input !== "head" && !storages.some((s) => s.id === next.input)) next.input = "head";
    commitStructural(next);
  };

  const setStorage = (i: number, patch: Partial<DraftStorage>) => {
    const prev = draft.storages[i];
    const updated = { ...prev, ...patch };
    // on a type change the default initial content follows too, if it was the default; an
    // alphabet of the old type means little to the new one, so the default takes over
    if (patch.type && prev.init === defaultInit(prev.type)) updated.init = defaultInit(patch.type);
    if (patch.type) updated.charset = "";
    // the input reference follows the rename
    const storages = draft.storages.map((s, k) => (k === i ? updated : s));
    const next: EntityDraft = { ...draft, storages };
    const renames = patch.id ? new Map([[updated.id, prev.id]]) : undefined;
    if (patch.id && draft.input === prev.id) next.input = patch.id;
    commitStructural(next, renames);
  };

  const addStorage = () => {
    const used = new Set(draft.storages.map((s) => s.id));
    setStorages([...draft.storages, { id: freshStorageId(used), type: "stack", charset: "", init: "Z", infinite: "right" }]);
  };
  // the alphabet does not change the machine's shape: no rows to rearrange
  const setCharset = (i: number, charset: string) =>
    update({ ...draft, storages: draft.storages.map((s, k) => (k === i ? { ...s, charset } : s)) });
  const charsetPlaceholder = (i: number) =>
    resolved?.storages[i]?.alphabet.join(", ") ?? CHARSET_PLACEHOLDER[draft.storages[i].type];

  const setRowParts = (i: number, parts: string[]) =>
    update({ ...draft, rows: draft.rows.map((r, k) => (k === i ? parts : r)) });
  const hasHead = draft.input === "head";
  const fields = transitionFields(t, hasHead, draft.storages);
  const kindCaps = draftKindCaps(draft);
  const kindName = kindCaps.kind === "general" ? t("detail.machine.kind.general") : machineKindLabel(t, kindCaps);
  const addRow = () =>
    update({
      ...draft,
      rows: [...draft.rows, draft.kind === "grammar" ? ["", ""] : ["", ...emptyFields(fields), ""]]
    });
  const removeRow = (i: number) => update({ ...draft, rows: draft.rows.filter((_, k) => k !== i) });

  const k = draft.kind;
  const terminals = draft.charset.split(",").map((c) => c.trim());
  // with the notes' symbols a transition reads δ(q, a, Z) = (p, γ) and a rule A → α
  const symbols = formLabels === "symbols";
  // one storage's alphabet stands with Σ, as in the notes' tuples; several have a column each
  const single = k === "machine" && draft.storages.length === 1 ? draft.storages[0] : null;

  return (
    <div
      className={`entity-form ${symbols ? "ef-symbols" : ""}`}
      onKeyDownCapture={arrowKeysAcrossFields}
    >
      <div className="ef-grid">
        <label className="ef-name" title={t("editor.form.name")}>
          <span>{t("editor.form.name")}</span>
          <SymbolField value={draft.name} onChange={(v) => setField("name", v)} digits placeholder={t("editor.form.name")} />
        </label>
        <label title={t("editor.form.alphabet")}>
          <span data-sym="Σ">{t("editor.form.alphabet")}</span>
          <SymbolField value={draft.charset} onChange={(v) => setField("charset", v)} digits={false} placeholder="a, b" />
        </label>
        {single && (
          <label title={t(`editor.form.storageAlphabet.${single.type}`)}>
            <span data-sym="Γ">{t(`editor.form.storageAlphabet.${single.type}`)}</span>
            <SymbolField value={single.charset} onChange={(v) => setCharset(0, v)} digits={false} placeholder={charsetPlaceholder(0)} />
          </label>
        )}
        <label title={k === "grammar" ? t("editor.form.variables") : t("editor.form.states")}>
          <span data-sym={k === "grammar" ? "V" : "Q"}>{k === "grammar" ? t("editor.form.variables") : t("editor.form.states")}</span>
          <SymbolField value={draft.states} onChange={(v) => setField("states", v)} digits placeholder="S, A" />
        </label>
        <label title={k === "grammar" ? t("editor.form.startVariable") : t("editor.form.startState")}>
          <span data-sym={k === "grammar" ? "S" : "q₀"}>{k === "grammar" ? t("editor.form.startVariable") : t("editor.form.startState")}</span>
          <SymbolField value={draft.init} onChange={(v) => setField("init", v)} digits placeholder="S" />
        </label>
        {k === "machine" && (
          <label title={t("editor.form.accepting")}>
            <span data-sym="F">{t("editor.form.accepting")}</span>
            <SymbolField value={draft.accept} onChange={(v) => setField("accept", v)} digits placeholder="A" />
          </label>
        )}
      </div>

      {k === "machine" && (
        <div className="ef-config">
          {followsKind ? (
            <button
              className={`ef-section-head ef-section-toggle ${configOpen ? "open" : ""}`}
              onClick={() => setConfigOpen(!configOpen)}
              aria-expanded={configOpen}
              title={t("editor.form.configHint")}
            >
              <ChevronRight size={13} />
              {kindName}
            </button>
          ) : (
            <div className="ef-section-head">{kindName}</div>
          )}
          {configOpen && draft.storages.length > 0 && (
            <div className="ef-grid">
              <label className="ef-choice">
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
                <label className="ef-choice">
                  <span>{t("editor.form.acceptance")}</span>
                  <select value={draft.acceptMode} onChange={(e) => setField("acceptMode", e.target.value)}>
                    <option value="finalState">{t("editor.form.acceptFinalState")}</option>
                    <option value="emptyStorages">{t("editor.form.acceptEmptyStorages")}</option>
                  </select>
                </label>
              )}
            </div>
          )}
          {configOpen && draft.storages.length > 0 && (
            <div className={`ef-storage-row ef-storage-head ${single ? "" : "ef-with-alphabet"}`}>
              <span>{t("editor.form.storage")}</span>
              <span>{t("editor.form.type")}</span>
              {!single && <span>{t("editor.form.storageAlphabetColumn")}</span>}
              <span>{t("editor.form.initialContent")}</span>
              <span />
            </div>
          )}
          {configOpen && draft.storages.map((s, i) => (
            <div className={`ef-storage-row ${single ? "" : "ef-with-alphabet"}`} key={i}>
              <input
                value={s.id}
                onChange={(e) => setStorage(i, { id: e.target.value.trim() })}
                placeholder={t("editor.form.namePlaceholder")}
                spellCheck={false}
              />
              <select
                value={storageChoice(s)}
                onChange={(e) => {
                  const c = STORAGE_CHOICES.find((x) => x.value === e.target.value)!;
                  // the extent alone keeps the tape's operations: only a new type resets them
                  setStorage(i, c.type === s.type ? { infinite: c.infinite } : { type: c.type, infinite: c.infinite });
                }}
              >
                {STORAGE_CHOICES.map((c) => (
                  <option key={c.value} value={c.value}>
                    {t(c.key)}
                  </option>
                ))}
              </select>
              {!single && (
                <SymbolField value={s.charset} onChange={(v) => setCharset(i, v)} digits={false} placeholder={charsetPlaceholder(i)} />
              )}
              <SymbolField
                value={s.init}
                onChange={(init) => setStorage(i, { init })}
                digits={false}
                epsilon
                placeholder={s.type === "tape" ? undefined : t("editor.form.initialContentPlaceholder")}
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
          {configOpen && (
            <button className="ef-add" onClick={addStorage} title={t("editor.form.addStorageHint")}>
              <Plus size={13} /> {draft.storages.length === 0 ? t("editor.form.addStorage") : t("editor.form.newStorage")}
            </button>
          )}
        </div>
      )}

      <div className="ef-rows">
        <button
          className={`ef-section-head ef-section-toggle ${rowsOpen ? "open" : ""}`}
          onClick={() => setRowsOpen(!rowsOpen)}
          aria-expanded={rowsOpen}
        >
          <ChevronRight size={13} />
          {k === "grammar" ? t("editor.form.rules") : t("editor.form.transitions")}
          <span className="ef-count">{draft.rows.length}</span>
        </button>
        {rowsOpen && k === "machine" && !symbols && <TransitionHead fields={fields} />}
        {rowsOpen && k === "grammar" && !symbols && <RuleHead />}
        {rowsOpen && draft.rows.map((row, i) => {
          if (k === "machine") {
            const from = row[0] ?? "";
            const to = row.length > 1 ? row[row.length - 1] : "";
            return (
              <TransitionRow
                key={i}
                fields={fields}
                notation={symbols}
                from={from}
                to={to}
                values={row.slice(1, -1)}
                onChange={(values) => setRowParts(i, [from, ...values, to])}
                onFrom={(v) => setRowParts(i, [v, ...row.slice(1)])}
                onTo={(v) => setRowParts(i, [...row.slice(0, -1), v])}
                onRemove={() => removeRow(i)}
              />
            );
          }
          return (
            <RuleRow
              key={i}
              notation={symbols}
              left={row[0]}
              right={row.slice(1)}
              onLeft={(v) => setRowParts(i, [v, ...row.slice(1)])}
              onRight={(alternatives) => setRowParts(i, [row[0], ...alternatives])}
              onRemove={() => removeRow(i)}
              // digits go to subscripts in variables, unless the digit is a terminal (S → 0S1)
              digits={(ch) => !terminals.includes(ch)}
            />
          );
        })}
        {rowsOpen && (
          <button className="ef-add" onClick={addRow}>
            <Plus size={13} /> {k === "grammar" ? t("editor.form.newRule") : t("editor.form.newTransition")}
          </button>
        )}
      </div>

      {kindChange && <KindChangeDialog req={kindChange} onClose={() => setKindChange(null)} />}
    </div>
  );
};
