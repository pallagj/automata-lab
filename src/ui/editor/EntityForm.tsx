import React, { useEffect, useRef, useState } from "react";
import yaml from "js-yaml";
import { Plus, X } from "lucide-react";

/**
 * Interaktív entitás-szerkesztő: a YAML-definíció helyett űrlapon adható meg
 * a gép/nyelvtan — a cella forrása továbbra is YAML, ide-oda alakítjuk.
 */

export type EntityKind = "fsm" | "pda" | "tm" | "grammar";

export interface EntityDraft {
  kind: EntityKind;
  name: string;
  charset: string;
  /** states (gépek) / variables (nyelvtan) */
  states: string;
  init: string;
  accept: string;
  initStack: string;
  acceptMode: string;
  /** átmenetek / szabályok részekre bontva */
  rows: string[][];
}

const KIND_BY_KEY: Record<string, EntityKind> = {
  StateMachine: "fsm",
  fsm: "fsm",
  FSM: "fsm",
  automata: "fsm",
  PushdownMachine: "pda",
  pda: "pda",
  PDA: "pda",
  TuringMachine: "tm",
  tm: "tm",
  TM: "tm",
  Grammar: "grammar",
  grammar: "grammar",
  nyelvtan: "grammar"
};

const YAML_KEY: Record<EntityKind, string> = {
  fsm: "StateMachine",
  pda: "PushdownMachine",
  tm: "TuringMachine",
  grammar: "Grammar"
};

/** hány részből áll egy átmenet-sor */
const ROW_ARITY: Record<EntityKind, number> = { fsm: 3, pda: 4, tm: 4, grammar: 2 };

/** A cella forrásából megállapítja, entitás-e (és milyen). */
export function detectEntityKind(source: string): EntityKind | null {
  const m = /^\s*([A-Za-z]+)\s*:/.exec(source);
  return m ? (KIND_BY_KEY[m[1]] ?? null) : null;
}

function fieldText(v: unknown): string {
  if (v === undefined || v === null) return "";
  if (Array.isArray(v)) return v.map((x) => String(x)).join(", ");
  return String(v);
}

function splitRow(kind: EntityKind, raw: string): string[] {
  if (kind === "grammar") {
    const i = raw.indexOf("->");
    return i >= 0 ? [raw.slice(0, i).trim(), raw.slice(i + 2).trim()] : [raw.trim(), ""];
  }
  const parts = raw.trim() === "" ? [] : raw.trim().split(/\s+/);
  while (parts.length < ROW_ARITY[kind]) parts.push("");
  return parts.slice(0, ROW_ARITY[kind]);
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
  const rowsRaw = b[kind === "grammar" ? "rules" : "transitions"];
  const rows = (Array.isArray(rowsRaw) ? rowsRaw : []).map((r) =>
    splitRow(kind, r === null ? "" : String(r))
  );
  return {
    kind,
    name: fieldText(b["name"]),
    charset: fieldText(b["charset"]),
    states: fieldText(kind === "grammar" ? b["variables"] : b["states"]),
    init: fieldText(b["init"]),
    accept: fieldText(b["accept"]),
    initStack: fieldText(b["initStack"]),
    acceptMode: fieldText(b["acceptMode"]) || "finalState",
    rows
  };
}

/** YAML-veszélyes skalárok idézőjelezése (mint a serialize.ts-ben). */
const NEEDS_QUOTE = /[{}[\]:#'"&*?|>%@`]|^[\s-]|^$/;
const scalar = (s: string) => (NEEDS_QUOTE.test(s) ? `"${s.replaceAll('"', '\\"')}"` : s);

export function serializeEntityDraft(d: EntityDraft): string {
  const lines = [`${YAML_KEY[d.kind]}:`, `  name: ${scalar(d.name)}`, `  charset: ${scalar(d.charset)}`];
  if (d.kind === "grammar") {
    lines.push(`  variables: ${scalar(d.states)}`);
    lines.push(`  init: ${scalar(d.init)}`);
    lines.push("  rules:");
    for (const r of d.rows) lines.push(`    - ${r[0].trim()} -> ${r[1].trim()}`);
  } else {
    lines.push(`  states: ${scalar(d.states)}`);
    lines.push(`  init: ${scalar(d.init)}`);
    if (d.kind === "pda") {
      lines.push(`  initStack: ${scalar(d.initStack)}`);
      lines.push(`  acceptMode: ${d.acceptMode === "emptyStack" ? "emptyStack" : "finalState"}`);
    }
    lines.push(`  accept: ${scalar(d.accept)}`);
    lines.push("  transitions:");
    for (const r of d.rows) lines.push(`    - ${scalar(r.join(" ").trim())}`);
  }
  return lines.join("\n");
}

function emptyRow(kind: EntityKind): string[] {
  const row = Array.from({ length: ROW_ARITY[kind] }, () => "");
  if (kind === "tm") row[2] = ">";
  return row;
}

const ROW_HEADERS: Record<EntityKind, string[]> = {
  fsm: ["honnan", "jel", "hová"],
  pda: ["honnan", "jel", "verem le/fel", "hová"],
  tm: ["honnan", "olvas/ír", "mozgás", "hová"],
  grammar: ["bal oldal", "jobb oldal (| választ el)"]
};

const ROW_PLACEHOLDERS: Record<EntityKind, string[]> = {
  fsm: ["S", "a", "A"],
  pda: ["q0", "a", "Z/AZ", "q0"],
  tm: ["start", "a/b", ">", "ok"],
  grammar: ["S", "aS | b"]
};

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

  const setField = (field: keyof EntityDraft, value: string) => update({ ...draft, [field]: value });
  const setRow = (i: number, j: number, value: string) => {
    const rows = draft.rows.map((r, k) => (k === i ? r.map((p, l) => (l === j ? value : p)) : r));
    update({ ...draft, rows });
  };
  const addRow = () => update({ ...draft, rows: [...draft.rows, emptyRow(draft.kind)] });
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
        {k !== "grammar" && (
          <label>
            <span>Elfogadó</span>
            <input value={draft.accept} onChange={(e) => setField("accept", e.target.value)} placeholder="A" />
          </label>
        )}
        {k === "pda" && (
          <>
            <label>
              <span>Kezdő verem</span>
              <input value={draft.initStack} onChange={(e) => setField("initStack", e.target.value)} placeholder="Z" />
            </label>
            <label>
              <span>Elfogadás</span>
              <select value={draft.acceptMode} onChange={(e) => setField("acceptMode", e.target.value)}>
                <option value="finalState">elfogadó állapottal</option>
                <option value="emptyStack">üres veremmel</option>
              </select>
            </label>
          </>
        )}
      </div>

      <div className="ef-rows">
        <div className="ef-row ef-row-head">
          {ROW_HEADERS[k].map((h) => (
            <span key={h}>{h}</span>
          ))}
          <span />
        </div>
        {draft.rows.map((row, i) => (
          <div className="ef-row" key={i}>
            {row.map((part, j) =>
              k === "tm" && j === 2 ? (
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
                  placeholder={ROW_PLACEHOLDERS[k][j]}
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
