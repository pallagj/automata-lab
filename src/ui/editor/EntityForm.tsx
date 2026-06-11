import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import yaml from "js-yaml";
import { Plus, TriangleAlert, X } from "lucide-react";
import { Machine, machineCaps, StorageSpec, StorageType } from "../../core/machine/machine";
import { parseStorageEntry } from "../../core/parse/definitionParser";
import { useAppStore } from "../../state/store";

/**
 * Interaktív entitás-szerkesztő: a YAML-definíció helyett űrlapon adható meg
 * a gép/nyelvtan — a cella forrása továbbra is YAML, ide-oda alakítjuk.
 *
 * Egyetlen gép-fajta létezik (Machine); hogy automata, veremautomata vagy
 * Turing-gép-e, azt a tárolók konfigurációja dönti el. A tárolók strukturált
 * sorokban szerkeszthetők, az átmenet-oszlopok belőlük generálódnak.
 */

export type EntityKind = "machine" | "grammar";

export interface EntityDraft {
  kind: EntityKind;
  name: string;
  charset: string;
  /** states (gép) / variables (nyelvtan) */
  states: string;
  init: string;
  accept: string;
  acceptMode: string;
  /** "head" (olvasófej) vagy egy tároló id-je */
  input: string;
  storages: StorageSpec[];
  /** átmenetek / szabályok részekre (tokenekre) bontva */
  rows: string[][];
}

const KIND_BY_KEY: Record<string, EntityKind> = {
  Machine: "machine",
  machine: "machine",
  gep: "machine",
  gép: "machine",
  Grammar: "grammar",
  grammar: "grammar",
  nyelvtan: "grammar"
};

/** A cella forrásából megállapítja, entitás-e (és milyen). */
export function detectEntityKind(source: string): EntityKind | null {
  const m = /^\s*([A-Za-zÀ-ž]+)\s*:/.exec(source);
  return m ? (KIND_BY_KEY[m[1]] ?? null) : null;
}

export function draftStorages(d: EntityDraft): StorageSpec[] {
  return d.kind === "machine" ? d.storages : [];
}

/** hány tokent foglal egy tároló az átmenet-sorban */
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

/** YAML → űrlap-vázlat; null, ha (épp) nem értelmezhető. */
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

/** YAML-veszélyes skalárok idézőjelezése (mint a serialize.ts-ben). */
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

/* --------------------- oszlopok az átmenet-sorokhoz --------------------- */

export interface RowColumn {
  header: string;
  placeholder: string;
  widget: "text" | "move";
}

export function rowColumns(d: EntityDraft): RowColumn[] {
  if (d.kind === "grammar")
    return [
      { header: "bal oldal", placeholder: "S", widget: "text" },
      { header: "jobb oldal (| választ el)", placeholder: "aS | b", widget: "text" }
    ];
  const cols: RowColumn[] = [{ header: "honnan", placeholder: "S", widget: "text" }];
  if (d.input === "head") cols.push({ header: "jel", placeholder: "a", widget: "text" });
  for (const s of d.storages) {
    if (s.type === "tape") {
      cols.push({ header: `${s.id} olvas/ír`, placeholder: "a/b", widget: "text" });
      cols.push({ header: "mozgás", placeholder: ">", widget: "move" });
    } else {
      cols.push({
        header: s.type === "stack" ? `${s.id} le/fel` : `${s.id} ki/be`,
        placeholder: s.type === "stack" ? "Z/AZ" : "A/BA",
        widget: "text"
      });
    }
  }
  cols.push({ header: "hová", placeholder: "A", widget: "text" });
  return cols;
}

function emptyRow(cols: RowColumn[], isGrammar: boolean): string[] {
  if (isGrammar) return ["", ""];
  return cols.map((c) => (c.widget === "move" ? ">" : ""));
}

/** Mozgás-választó: csak nyilak, a szöveg úgysem fér ki. */
export const MoveSelect: React.FC<{
  value: string;
  onChange: (v: string) => void;
}> = ({ value, onChange }) => (
  <select className="move-select" value={value} onChange={(e) => onChange(e.target.value)} title="mozgás: → jobbra · ← balra · • helyben">
    {![">", "<", "="].includes(value) && <option value={value} hidden />}
    <option value=">">→</option>
    <option value="<">←</option>
    <option value="=">•</option>
  </select>
);

/** A felismert gépfajta — csak a bemenettől és a tárolóktól függ. */
function draftKindLabel(d: EntityDraft): string {
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
  return machineCaps(probe).label;
}

/* ------------------- fajtaváltás-figyelmeztető dialógus ------------------- */

interface KindChangeRequest {
  fromLabel: string;
  toLabel: string;
  apply: () => void;
}

const KindChangeDialog: React.FC<{ req: KindChangeRequest; onClose: () => void }> = ({ req, onClose }) => {
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
            A gép fajtája megváltozik
          </h2>
          <button className="icon-btn" onClick={onClose}>
            <X size={15} />
          </button>
        </div>
        <div className="gd-body">
          <p style={{ margin: 0 }}>
            Ez a módosítás a gépet <b>{req.fromLabel.toLowerCase()}</b> helyett{" "}
            <b>{req.toLabel.toLowerCase()}</b> géppé alakítja — a tárolók határozzák meg, milyen
            nyelveket képes felismerni. A meglévő átmenetek igazodnak: új tároló érintetlenül
            hagyó művelettel egészül ki, törölt tároló műveletei elvesznek.
          </p>
          <label className="gd-check">
            <input
              type="checkbox"
              checked={dontAskAgain}
              onChange={(e) => setDontAskAgain(e.target.checked)}
            />
            <span>Ne figyelmeztess többé</span>
          </label>
        </div>
        <div className="gd-actions">
          <span className="spacer" />
          <button className="gd-btn" onClick={onClose}>
            Mégse
          </button>
          <button
            className="gd-btn primary"
            onClick={() => {
              if (dontAskAgain) setHide(true);
              req.apply();
              onClose();
            }}
          >
            Módosítom
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
};

/* ----------------------------- tárolók ----------------------------- */

const STORAGE_TYPE_LABEL: Record<StorageType, string> = {
  stack: "verem (LIFO)",
  queue: "sor (FIFO)",
  tape: "szalag"
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
  const [draft, setDraft] = useState<EntityDraft | null>(() => parseEntityDraft(source));
  const lastSerialized = useRef(source);
  const hideKindWarning = useAppStore((s) => s.hideKindChangeWarning);
  const [kindChange, setKindChange] = useState<KindChangeRequest | null>(null);

  // külső forrásváltozás (pl. kód-nézetben szerkesztés) követése
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

  /** az adott tárolót „békén hagyó” token(ek) az átmenet-sorban */
  const noOpTokens = (s: StorageSpec): string[] => (s.type === "tape" ? ["./&", "="] : ["$/$"]);

  /**
   * Tároló- vagy bemenet-változáskor a meglévő sorok átrendeződnek: a megmaradt
   * tárolók megtartják a műveleteiket (azonosító szerint párosítva), az újak
   * no-op műveletet kapnak — így a gép viselkedése nem változik, csak bővül.
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
          // típusváltáskor a régi művelet értelmét veszti → no-op
          if (old && prevSpec && prevSpec.type === s.type) middle.push(...old);
          else middle.push(...noOpTokens(s));
        }
        return [from, ...middle, to];
      })
    };
  };

  /**
   * Szerkezeti módosítás (tárolók/bemenet): ha megváltoztatná a gép felismert
   * fajtáját, előbb megerősítést kérünk — hacsak a felhasználó le nem tiltotta.
   */
  const commitStructural = (next: EntityDraft, renames?: Map<string, string>) => {
    const apply = () => update(reshapeRows(draft, next, renames));
    const fromLabel = draftKindLabel(draft);
    const toLabel = draftKindLabel(next);
    if (fromLabel !== toLabel && !hideKindWarning) {
      setKindChange({ fromLabel, toLabel, apply });
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
    // ha a bemenet egy törölt tárolóra mutatott, vissza az olvasófejre
    if (next.input !== "head" && !storages.some((s) => s.id === next.input)) next.input = "head";
    commitStructural(next);
  };

  const setStorage = (i: number, patch: Partial<StorageSpec>) => {
    const prev = draft.storages[i];
    const updated = { ...prev, ...patch };
    // típusváltáskor az alapértelmezett kezdőtartalom is követ, ha eddig az volt
    if (patch.type && prev.init === defaultInit(prev.type)) updated.init = defaultInit(patch.type);
    // a bemenet-hivatkozás követi az átnevezést
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
  const cols = rowColumns(draft);
  const addRow = () => update({ ...draft, rows: [...draft.rows, emptyRow(cols, draft.kind === "grammar")] });
  const removeRow = (i: number) => update({ ...draft, rows: draft.rows.filter((_, k) => k !== i) });

  const k = draft.kind;

  return (
    <div className="entity-form" onClick={(e) => e.stopPropagation()}>
      <div className="ef-grid">
        <label>
          <span>Név</span>
          <input value={draft.name} onChange={(e) => setField("name", e.target.value)} placeholder="M" />
        </label>
        <label>
          <span>Ábécé</span>
          <input value={draft.charset} onChange={(e) => setField("charset", e.target.value)} placeholder="a, b" />
        </label>
        <label>
          <span>{k === "grammar" ? "Változók" : "Állapotok"}</span>
          <input value={draft.states} onChange={(e) => setField("states", e.target.value)} placeholder="S, A" />
        </label>
        <label>
          <span>{k === "grammar" ? "Kezdő változó" : "Kezdőállapot"}</span>
          <input value={draft.init} onChange={(e) => setField("init", e.target.value)} placeholder="S" />
        </label>
        {k === "machine" && (
          <label>
            <span>Elfogadó</span>
            <input value={draft.accept} onChange={(e) => setField("accept", e.target.value)} placeholder="A" />
          </label>
        )}
        {k === "machine" && draft.storages.length > 0 && (
          <>
            <label>
              <span>Bemenet</span>
              <select value={draft.input} onChange={(e) => setField("input", e.target.value)}>
                <option value="head">olvasófej</option>
                {draft.storages.map((s) => (
                  <option key={s.id} value={s.id}>
                    a(z) {s.id} tárolóra írva
                  </option>
                ))}
              </select>
            </label>
            {draft.input === "head" && (
              <label>
                <span>Elfogadás</span>
                <select value={draft.acceptMode} onChange={(e) => setField("acceptMode", e.target.value)}>
                  <option value="finalState">elfogadó állapottal</option>
                  <option value="emptyStorages">üres tárolókkal</option>
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
              <span>tároló</span>
              <span>típus</span>
              <span>kezdőtartalom</span>
              <span />
            </div>
          )}
          {draft.storages.map((s, i) => (
            <div className="ef-storage-row" key={i}>
              <input
                value={s.id}
                onChange={(e) => setStorage(i, { id: e.target.value.trim() })}
                placeholder="név"
                spellCheck={false}
              />
              <select value={s.type} onChange={(e) => setStorage(i, { type: e.target.value as StorageType })}>
                {(Object.keys(STORAGE_TYPE_LABEL) as StorageType[]).map((t) => (
                  <option key={t} value={t}>
                    {STORAGE_TYPE_LABEL[t]}
                  </option>
                ))}
              </select>
              <input
                value={s.init}
                onChange={(e) => setStorage(i, { init: e.target.value })}
                placeholder={s.type === "tape" ? "(a bemenet kerülhet rá)" : "kezdőtartalom"}
                spellCheck={false}
              />
              <button
                className="ef-remove"
                title="Tároló törlése"
                onClick={() => setStorages(draft.storages.filter((_, j) => j !== i))}
              >
                <X size={13} />
              </button>
            </div>
          ))}
          <button className="ef-add" onClick={addStorage} title="Veremmel veremautomata, szalaggal Turing-gép, többel egyedi gép">
            <Plus size={13} /> {draft.storages.length === 0 ? "tároló hozzáadása (verem / sor / szalag)" : "új tároló"}
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
            <button className="ef-remove" title="Sor törlése" onClick={() => removeRow(i)}>
              <X size={13} />
            </button>
          </div>
        ))}
        <button className="ef-add" onClick={addRow}>
          <Plus size={13} /> {k === "grammar" ? "új szabály" : "új átmenet"}
        </button>
      </div>

      {kindChange && <KindChangeDialog req={kindChange} onClose={() => setKindChange(null)} />}
    </div>
  );
};
