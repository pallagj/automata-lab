import React, { useEffect, useRef, useState } from "react";
import yaml from "js-yaml";
import { Plus, X } from "lucide-react";
import { StorageSpec, StorageType } from "../../core/machine/machine";

/**
 * Interaktív entitás-szerkesztő: a YAML-definíció helyett űrlapon adható meg
 * a gép/nyelvtan — a cella forrása továbbra is YAML, ide-oda alakítjuk.
 *
 * A „machine” fajta fedi a veremautomatát, a Turing-gépet és az egyedi
 * tárolókonfigurációjú általános gépet is; a tárolók tömör szövegként
 * szerkeszthetők ("verem: stack(Z), s: queue").
 */

export type EntityKind = "fsm" | "machine" | "grammar";

export interface EntityDraft {
  kind: EntityKind;
  /** az eredeti YAML-kulcs — a visszaíráskor ezt a formát részesítjük előnyben */
  yamlKey: string;
  name: string;
  charset: string;
  /** states (gépek) / variables (nyelvtan) */
  states: string;
  init: string;
  accept: string;
  acceptMode: string;
  /** machine: "head" (olvasófej) vagy egy tároló id-je */
  input: string;
  /** machine: tárolók tömören — "verem: stack(Z), s: queue" */
  storages: string;
  /** átmenetek / szabályok részekre (tokenekre) bontva */
  rows: string[][];
}

const KIND_BY_KEY: Record<string, EntityKind> = {
  StateMachine: "fsm",
  fsm: "fsm",
  FSM: "fsm",
  automata: "fsm",
  PushdownMachine: "machine",
  pda: "machine",
  PDA: "machine",
  TuringMachine: "machine",
  tm: "machine",
  TM: "machine",
  Machine: "machine",
  machine: "machine",
  gep: "machine",
  gép: "machine",
  Grammar: "grammar",
  grammar: "grammar",
  nyelvtan: "grammar"
};

const PDA_KEYS = new Set(["PushdownMachine", "pda", "PDA"]);
const TM_KEYS = new Set(["TuringMachine", "tm", "TM"]);

const STORAGE_TYPE_ALIASES: Record<string, StorageType> = {
  stack: "stack",
  verem: "stack",
  queue: "queue",
  sor: "queue",
  tape: "tape",
  szalag: "tape"
};

/** A cella forrásából megállapítja, entitás-e (és milyen). */
export function detectEntityKind(source: string): EntityKind | null {
  const m = /^\s*([A-Za-z]+)\s*:/.exec(source);
  return m ? (KIND_BY_KEY[m[1]] ?? null) : null;
}

/** "verem: stack(Z), s: queue" → tároló-lista; null, ha értelmezhetetlen. */
export function parseStoragesText(text: string): StorageSpec[] | null {
  const out: StorageSpec[] = [];
  const trimmed = text.trim();
  if (trimmed === "") return out;
  for (const part of trimmed.split(",")) {
    const m = /^\s*([^\s:]+)\s*:\s*([A-Za-zÀ-ž]+)\s*(?:\(\s*([^)]*)\s*\))?\s*$/.exec(part);
    const type = m ? STORAGE_TYPE_ALIASES[m[2]] : undefined;
    if (!m || !type) return null;
    out.push({ id: m[1], type, init: m[3] ?? "" });
  }
  return out;
}

export function formatStoragesText(storages: StorageSpec[]): string {
  return storages.map((s) => `${s.id}: ${s.type}${s.init !== "" ? `(${s.init})` : ""}`).join(", ");
}

/** A vázlat tárolói (preset kulcsoknál is). */
export function draftStorages(d: EntityDraft): StorageSpec[] {
  if (d.kind !== "machine") return [];
  return parseStoragesText(d.storages) ?? [];
}

/** hány tokent foglal egy tároló az átmenet-sorban */
const tokensOf = (t: StorageType) => (t === "tape" ? 2 : 1);

export function rowArity(d: EntityDraft): number {
  if (d.kind === "grammar") return 2;
  if (d.kind === "fsm") return 3;
  return 2 + (d.input === "head" ? 1 : 0) + draftStorages(d).reduce((n, s) => n + tokensOf(s.type), 0);
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

  let storages = "";
  let input = "head";
  let acceptMode = fieldText(b["acceptMode"]) || "finalState";
  if (kind === "machine") {
    if (PDA_KEYS.has(key)) {
      const initStack = fieldText(b["initStack"] ?? b["startStack"]) || "Z";
      storages = `verem: stack(${initStack})`;
      if (acceptMode === "emptyStack") acceptMode = "emptyStorages";
    } else if (TM_KEYS.has(key)) {
      storages = "szalag: tape";
      input = "szalag";
      acceptMode = "finalState";
    } else {
      const raw = b["storages"];
      if (raw && typeof raw === "object" && !Array.isArray(raw)) {
        storages = Object.entries(raw as Record<string, unknown>)
          .map(([id, v]) => `${id}: ${String(v ?? "")}`)
          .join(", ");
      }
      input = fieldText(b["input"]) || "head";
      if (acceptMode === "emptyStack") acceptMode = "emptyStorages";
    }
  }

  const draft: EntityDraft = {
    kind,
    yamlKey: key,
    name: fieldText(b["name"]),
    charset: fieldText(b["charset"]),
    states: fieldText(kind === "grammar" ? b["variables"] : b["states"]),
    init: fieldText(b["init"]),
    accept: fieldText(b["accept"]),
    acceptMode,
    input,
    storages,
    rows: []
  };
  // a machine-vázlatnál előbb kell a tárolólista az aritáshoz
  if (kind === "machine" && parseStoragesText(storages) === null) return null;
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

  if (d.kind === "fsm") {
    const lines = [
      "StateMachine:",
      `  name: ${scalar(d.name)}`,
      `  charset: ${scalar(d.charset)}`,
      `  states: ${scalar(d.states)}`,
      `  init: ${scalar(d.init)}`,
      `  accept: ${scalar(d.accept)}`,
      "  transitions:"
    ];
    for (const r of d.rows) lines.push(`    - ${scalar(r.join(" ").trim())}`);
    return lines.join("\n");
  }

  // machine: ha az alak még illik a preset kulcshoz, abban a formában írjuk vissza
  const storages = draftStorages(d);
  const isPdaShape =
    PDA_KEYS.has(d.yamlKey) && d.input === "head" && storages.length === 1 && storages[0].type === "stack";
  const isTmShape =
    TM_KEYS.has(d.yamlKey) && storages.length === 1 && storages[0].type === "tape" && d.input === storages[0].id;

  const lines: string[] = [];
  if (isPdaShape) {
    lines.push("PushdownMachine:");
    lines.push(`  name: ${scalar(d.name)}`);
    lines.push(`  charset: ${scalar(d.charset)}`);
    lines.push(`  states: ${scalar(d.states)}`);
    lines.push(`  init: ${scalar(d.init)}`);
    lines.push(`  initStack: ${scalar(storages[0].init || "Z")}`);
    lines.push(`  acceptMode: ${d.acceptMode === "emptyStorages" ? "emptyStack" : "finalState"}`);
    lines.push(`  accept: ${scalar(d.accept)}`);
  } else if (isTmShape) {
    lines.push("TuringMachine:");
    lines.push(`  name: ${scalar(d.name)}`);
    lines.push(`  charset: ${scalar(d.charset)}`);
    lines.push(`  states: ${scalar(d.states)}`);
    lines.push(`  init: ${scalar(d.init)}`);
    lines.push(`  accept: ${scalar(d.accept)}`);
  } else {
    lines.push("Machine:");
    lines.push(`  name: ${scalar(d.name)}`);
    lines.push(`  charset: ${scalar(d.charset)}`);
    lines.push(`  states: ${scalar(d.states)}`);
    lines.push(`  init: ${scalar(d.init)}`);
    lines.push(`  accept: ${scalar(d.accept)}`);
    if (d.acceptMode === "emptyStorages") lines.push("  acceptMode: emptyStorages");
    if (d.input !== "head") lines.push(`  input: ${scalar(d.input)}`);
    if (storages.length > 0) {
      lines.push("  storages:");
      for (const s of storages) lines.push(`    ${s.id}: ${s.type}${s.init !== "" ? `(${s.init})` : ""}`);
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
  if (d.kind === "fsm") {
    cols.push({ header: "jel", placeholder: "a", widget: "text" });
  } else {
    if (d.input === "head") cols.push({ header: "jel", placeholder: "a", widget: "text" });
    for (const s of draftStorages(d)) {
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
  }
  cols.push({ header: "hová", placeholder: "A", widget: "text" });
  return cols;
}

function emptyRow(cols: RowColumn[], isGrammar: boolean): string[] {
  if (isGrammar) return ["", ""];
  return cols.map((c) => (c.widget === "move" ? ">" : ""));
}

interface Props {
  source: string;
  onChange: (source: string) => void;
}

export const EntityForm: React.FC<Props> = ({ source, onChange }) => {
  const [draft, setDraft] = useState<EntityDraft | null>(() => parseEntityDraft(source));
  const lastSerialized = useRef(source);

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

  const setField = (field: keyof EntityDraft, value: string) => {
    const next: EntityDraft = { ...draft, [field]: value };
    // tároló- vagy bemenet-változáskor a sorok tokenszáma is változik
    if (next.kind === "machine" && (field === "storages" || field === "input")) {
      if (parseStoragesText(next.storages) === null) {
        setDraft(next); // érvénytelen tárolószöveg: csak a vázlatban tartjuk, nem írjuk vissza
        return;
      }
      const arity = rowArity(next);
      next.rows = next.rows.map((r) => {
        // a honnan/hová megmarad, a középső tokenek igazodnak az új tárolókhoz
        const from = r[0] ?? "";
        const to = r[r.length - 1] ?? "";
        const middle = r.slice(1, -1);
        while (middle.length < arity - 2) middle.push("");
        return [from, ...middle.slice(0, arity - 2), to];
      });
    }
    update(next);
  };
  const setRow = (i: number, j: number, value: string) => {
    const rows = draft.rows.map((r, k) => (k === i ? r.map((p, l) => (l === j ? value : p)) : r));
    update({ ...draft, rows });
  };
  const cols = rowColumns(draft);
  const addRow = () => update({ ...draft, rows: [...draft.rows, emptyRow(cols, draft.kind === "grammar")] });
  const removeRow = (i: number) => update({ ...draft, rows: draft.rows.filter((_, k) => k !== i) });

  const k = draft.kind;
  const storages = draftStorages(draft);
  const storagesValid = k !== "machine" || parseStoragesText(draft.storages) !== null;

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
        {k !== "grammar" && (
          <label>
            <span>Elfogadó</span>
            <input value={draft.accept} onChange={(e) => setField("accept", e.target.value)} placeholder="A" />
          </label>
        )}
        {k === "machine" && (
          <>
            <label className={storagesValid ? "" : "invalid"}>
              <span>Tárolók</span>
              <input
                value={draft.storages}
                onChange={(e) => setField("storages", e.target.value)}
                placeholder="verem: stack(Z), s: queue"
                title="Vesszővel elválasztva: id: stack(kezdet) / queue / tape"
              />
            </label>
            <label>
              <span>Bemenet</span>
              <select value={draft.input} onChange={(e) => setField("input", e.target.value)}>
                <option value="head">olvasófej</option>
                {storages.map((s) => (
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
                <select key={j} value={part} onChange={(e) => setRow(i, j, e.target.value)}>
                  {![">", "<", "="].includes(part) && <option value={part} hidden />}
                  <option value=">">→ jobbra</option>
                  <option value="<">← balra</option>
                  <option value="=">• helyben</option>
                </select>
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
    </div>
  );
};
