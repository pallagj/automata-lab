import yaml from "js-yaml";
import { Diagnostic, EPS, err, failResult, info, okResult, OpResult, warn } from "../types";
import {
  analyzeMachine,
  Machine,
  MachineTransition,
  StorageOp,
  StorageSpec,
  StorageType,
  TAPE_BLANK
} from "../machine/machine";
import { Grammar, GrammarRule } from "../grammar/grammar";

/**
 * YAML-alapú definíciók beolvasása barátságos, pontos hibaüzenetekkel.
 *
 * Rövidítések az átmenetekben:
 *   - "A a B"      egyszerű átmenet
 *   - "."          helyettesítő: az adott pozíció összes lehetséges értéke
 *   - "&"          „ugyanaz”: állapotnál a kiinduló állapot, írásnál az olvasott jel
 *   - "a-d"        intervallum a felsorolásokban (charset, states)
 *   - "$" vagy "ε" üres szó
 */

export type Definition = Machine | Grammar;

const EPS_ALIASES = new Set(["$", "ε", "eps", "epsilon"]);

function normEps(s: string): string {
  return EPS_ALIASES.has(s) ? EPS : s;
}

/** vesszővágás, amely a {A,B} halmazneveken belül nem vág */
function splitTopLevel(s: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = "";
  for (const ch of s) {
    if (ch === "{") depth++;
    if (ch === "}") depth = Math.max(0, depth - 1);
    if (ch === "," && depth === 0) {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

/** vesszős felsorolás / lista → tömb, intervallum-kibontással */
function parseList(value: unknown, field: string, diags: Diagnostic[], expandRanges = true): string[] {
  if (value === undefined || value === null) return [];
  let items: string[] = [];
  if (Array.isArray(value)) {
    items = value.flatMap((v) => splitTopLevel(String(v)));
  } else {
    items = splitTopLevel(String(value));
  }
  items = items.map((s) => s.trim()).filter((s) => s !== "");

  if (expandRanges) {
    items = items.flatMap((t) => {
      const m = /^(\S)-(\S)$/.exec(t);
      if (m) {
        const from = m[1].charCodeAt(0);
        const to = m[2].charCodeAt(0);
        if (to < from) {
          diags.push(warn(`Fordított intervallum a(z) ${field} mezőben: „${t}”`, "Az intervallumot üresként kezelem."));
          return [];
        }
        if (to - from > 60) {
          diags.push(warn(`Túl nagy intervallum a(z) ${field} mezőben: „${t}”`));
          return [t];
        }
        return Array.from({ length: to - from + 1 }, (_, i) => String.fromCharCode(from + i));
      }
      return [t];
    });
  }
  return items;
}

interface ParsedBase {
  name: string;
  body: Record<string, unknown>;
}

function parseYamlBody(source: string, expectedKeys: string[]): OpResult<ParsedBase & { key: string }> {
  let parsed: unknown;
  try {
    parsed = yaml.load(source);
  } catch (e) {
    const ye = e as { mark?: { line?: number; column?: number }; reason?: string };
    const loc = ye.mark?.line !== undefined ? ` (${ye.mark.line + 1}. sor)` : "";
    return failResult([
      err(`YAML-szintaxishiba${loc}`, `${ye.reason ?? (e as Error).message}. Ellenőrizd a behúzásokat és a kettőspontokat.`)
    ]);
  }
  if (typeof parsed !== "object" || parsed === null) {
    return failResult([err("Üres vagy értelmezhetetlen definíció")]);
  }
  const keys = Object.keys(parsed as object);
  const key = keys.find((k) => expectedKeys.includes(k));
  if (!key) return failResult([err("Hiányzó típuskulcs", `Várt kulcsok: ${expectedKeys.join(", ")}`)]);
  const body = (parsed as Record<string, unknown>)[key];
  if (typeof body !== "object" || body === null) {
    return failResult([err(`A(z) ${key} alatt mezők kellenek`, "Például: name, states, transitions…")]);
  }
  const b = body as Record<string, unknown>;
  const name = String(b["name"] ?? "").trim();
  return okResult({ name, body: b, key });
}

function requireField(body: Record<string, unknown>, field: string, what: string): Diagnostic | null {
  if (body[field] === undefined || body[field] === null || String(body[field]).trim() === "") {
    return err(`Hiányzó mező: ${field}`, what);
  }
  return null;
}

/** Helyettesítős átmenetsor kibontása: minden "." pozícióra az összes opció. */
function expandWildcard(
  parts: string[],
  options: string[][],
  cb: (resolved: string[]) => void,
  i = 0,
  acc: string[] = []
) {
  if (i === parts.length) {
    cb(acc);
    return;
  }
  if (parts[i] === ".") {
    for (const o of options[i]) expandWildcard(parts, options, cb, i + 1, [...acc, o]);
  } else {
    expandWildcard(parts, options, cb, i + 1, [...acc, parts[i]]);
  }
}

/* ------------------------------------------------------------------ */
/* Általános gép (Machine)                                              */
/* ------------------------------------------------------------------ */

const STORAGE_TYPES: Record<string, StorageType> = {
  stack: "stack",
  verem: "stack",
  queue: "queue",
  sor: "queue",
  tape: "tape",
  szalag: "tape"
};

/** A verem alapértelmezett kezdőtartalma, ha nincs megadva. */
const STACK_DEFAULT_INIT = "Z";

/**
 * Egy tároló bejegyzése a storages mappingben:
 *   v1: stack                      — tömör alak, alapértelmezett kezdőtartalommal
 *   v2: { type: stack, init: Z }   — részletes alak (init helyett default is jó)
 */
export function parseStorageEntry(id: string, raw: unknown): OpResult<StorageSpec> {
  const bad = () =>
    failResult<StorageSpec>([
      err(
        `Ismeretlen tárolótípus a(z) „${id}” tárolónál`,
        "Használható: stack/verem, queue/sor, tape/szalag — kezdőtartalommal:\n  v1:\n    type: stack\n    init: Z"
      )
    ]);
  let typeRaw = "";
  let init: string | undefined;
  if (raw === null || typeof raw === "string") {
    typeRaw = String(raw ?? "").trim();
  } else if (typeof raw === "object" && !Array.isArray(raw)) {
    const o = raw as Record<string, unknown>;
    typeRaw = String(o["type"] ?? "").trim();
    const i = o["init"] ?? o["default"];
    if (i !== undefined && i !== null) init = String(i);
  } else {
    return bad();
  }
  const type = STORAGE_TYPES[typeRaw];
  if (!type) return bad();
  if (init === undefined) init = type === "stack" ? STACK_DEFAULT_INIT : "";
  return okResult({ id, type, init: EPS_ALIASES.has(init) ? "" : init });
}

/** hány tokent foglal el egy tároló az átmenet-sorban */
const STORAGE_TOKENS: Record<StorageType, number> = { stack: 1, queue: 1, tape: 2 };

const MOVE_MAP: Record<string, "L" | "R" | "S"> = { ">": "R", "<": "L", "=": "S", R: "R", L: "L", S: "S" };

/**
 * Egy tároló műveletének beolvasása az átmenet-sor tokenjeiből.
 * stack: "Z/AZ" · queue: "A/BA" · tape: "a/b >" (két token).
 */
function parseStorageOp(
  spec: StorageSpec,
  tokens: string[],
  line: string,
  alphabet: string[]
): OpResult<StorageOp> {
  const bad = (what: string, hint: string) =>
    failResult<StorageOp>([err(`${what}: „${tokens.join(" ")}” (${spec.id})`, `Sor: „${line}”. ${hint}`)]);

  if (spec.type === "tape") {
    const [rw, moveRaw] = tokens;
    if (!rw.includes("/")) return bad("Hibás szalagművelet", "Alak: OLVAS/ÍR MOZGÁS — pl. „a/b >”. Üres jel: _ , „ugyanazt írja”: &.");
    const [read, writeRaw] = rw.split("/");
    const move = MOVE_MAP[moveRaw];
    if (!move) return bad("Ismeretlen mozgás", "Használható: > < = (vagy R L S).");
    if (read !== "." && read !== TAPE_BLANK && !alphabet.includes(read))
      return bad("Ismeretlen szalagjel", `Szalagábécé: ${[...alphabet, TAPE_BLANK].join(", ")}`);
    return okResult({ type: "tape", read, write: writeRaw, move });
  }

  const tok = tokens[0];
  if (!tok.includes("/"))
    return bad(
      "Hibás tárolóművelet",
      spec.type === "stack"
        ? "Verem-alak: LEVESZ/FELÍR — pl. „Z/AZ”; ε-hoz $."
        : "Sor-alak: KIVESZ/BETESZ — pl. „A/BA”; ε-hoz $."
    );
  const [aRaw, bRaw] = tok.split("/");
  const a = normEps(aRaw);
  const b = EPS_ALIASES.has(bRaw) ? "" : bRaw;
  return okResult(
    spec.type === "stack" ? { type: "stack", pop: a, push: b } : { type: "queue", take: a, put: b }
  );
}

/**
 * Általános gép YAML-ből:
 *
 *   Machine:
 *     name: AnBnCn
 *     charset: a, b, c
 *     states: q0, q1, q2
 *     init: q0
 *     accept: q2
 *     input: head            # alapértelmezés; vagy egy tároló id-je
 *     storages:
 *       v1: stack            # tömör alak (verem alapból Z-vel indul)
 *       v2:
 *         type: stack
 *         init: Z
 *     transitions:
 *       - q0 a Z/AZ $/B q0   # FROM INPUT tárolónként-op… TO
 *
 * A gép fajtáját (automata / veremautomata / Turing-gép / általános gép)
 * a konfiguráció határozza meg — külön típuskulcs nincs.
 */
export function parseMachine(source: string): OpResult<Machine> {
  const base = parseYamlBody(source, ["Machine", "machine", "gep", "gép"]);
  if (!base.ok) return failResult(base.diagnostics);
  const { name, body } = base.value!;
  const diags: Diagnostic[] = [];

  for (const [f, what] of [
    ["states", "Az állapotok felsorolása"],
    ["init", "A kezdőállapot"],
    ["charset", "A bemeneti ábécé"]
  ] as const) {
    const d = requireField(body, f, what);
    if (d) return failResult([d]);
  }

  const alphabet = parseList(body["charset"], "charset", diags);
  const states = parseList(body["states"], "states", diags);
  const accept = parseList(body["accept"], "accept", diags);
  const start = String(body["init"]).trim();

  const stateSet = new Set(states);
  if (!stateSet.has(start)) return failResult([err(`A kezdőállapot (${start}) nincs az állapotok között`)]);
  for (const a of accept)
    if (!stateSet.has(a)) return failResult([err(`Az elfogadó állapot (${a}) nincs az állapotok között`)]);

  // tárolók: mapping (id → típus vagy {type, init}) vagy hiányzó (= tárolómentes gép)
  const storages: StorageSpec[] = [];
  const storagesRaw = body["storages"];
  if (storagesRaw !== undefined && storagesRaw !== null) {
    if (typeof storagesRaw !== "object" || Array.isArray(storagesRaw)) {
      return failResult([
        err("A storages mező kulcs-érték párokat vár", "Például:\n  storages:\n    v1: stack\n    v2:\n      type: queue\n      init: A")
      ]);
    }
    for (const [id, raw] of Object.entries(storagesRaw as Record<string, unknown>)) {
      const r = parseStorageEntry(id.trim(), raw);
      if (!r.ok) return failResult(r.diagnostics);
      if (storages.some((s) => s.id === r.value!.id))
        return failResult([err(`Kétszer szereplő tároló-azonosító: „${id}”`)]);
      storages.push(r.value!);
    }
  }

  // bemenet: olvasófej vagy egy tároló
  const inputRaw = String(body["input"] ?? "head").trim();
  const input = inputRaw === "" || inputRaw === "head" || inputRaw === "fej" ? "head" : inputRaw;
  if (input !== "head" && !storages.some((s) => s.id === input)) {
    return failResult([
      err(
        `Az input mező (${input}) nem egy tároló azonosítója`,
        `Használj „head”-et (olvasófej), vagy az egyik tároló nevét: ${storages.map((s) => s.id).join(", ") || "—"}.`
      )
    ]);
  }

  const acceptModeRaw = String(body["acceptMode"] ?? "finalState").trim();
  const acceptMode: Machine["acceptMode"] =
    acceptModeRaw === "emptyStorages" || acceptModeRaw === "emptyStack" ? "emptyStorages" : "finalState";

  if (accept.length === 0 && acceptMode === "finalState" && input === "head" && storages.length > 0)
    diags.push(
      info(
        "Nincs elfogadó állapot — üres tárolókkal való elfogadásra az acceptMode: emptyStorages való",
        "Elfogadó állapot nélkül és finalState módban a gép az üres nyelvet ismeri fel."
      )
    );

  const tokensPerLine = 2 + (input === "head" ? 1 : 0) + storages.reduce((n, s) => n + STORAGE_TOKENS[s.type], 0);
  const transitions: MachineTransition[] = [];
  const lines = parseList(body["transitions"], "transitions", diags, false);
  for (const line of lines) {
    const parts = line.split(/\s+/).filter((p) => p !== "");
    if (parts.length !== tokensPerLine) {
      const shape = [
        "HONNAN",
        ...(input === "head" ? ["BEMENET"] : []),
        ...storages.map((s) => (s.type === "tape" ? `${s.id}:OLVAS/ÍR MOZGÁS` : `${s.id}:LE/FEL`)),
        "HOVA"
      ].join(" ");
      return failResult([err(`Hibás átmenet: „${line}”`, `Ehhez a géphez ${tokensPerLine} elem kell: ${shape}`)]);
    }
    const from = parts[0];
    const to = parts[parts.length - 1];
    if (from !== "." && !stateSet.has(from))
      return failResult([err(`Ismeretlen állapot az átmenetben: „${from}”`, `Sor: „${line}”.`)]);
    if (to !== "." && to !== "&" && !stateSet.has(to))
      return failResult([err(`Ismeretlen célállapot az átmenetben: „${to}”`, `Sor: „${line}”.`)]);

    let idx = 1;
    let inputSym = EPS;
    if (input === "head") {
      inputSym = normEps(parts[idx++]);
      if (inputSym !== EPS && parts[1] !== "." && !alphabet.includes(inputSym))
        return failResult([
          err(`Ismeretlen bemeneti szimbólum: „${parts[1]}”`, `Sor: „${line}”. Ábécé: ${alphabet.join(", ")} (ε-hoz $).`)
        ]);
    }
    const ops: StorageOp[] = [];
    for (const s of storages) {
      const toks = parts.slice(idx, idx + STORAGE_TOKENS[s.type]);
      idx += STORAGE_TOKENS[s.type];
      const r = parseStorageOp(s, toks, line, alphabet);
      if (!r.ok) return failResult(r.diagnostics);
      ops.push(r.value!);
    }

    // helyettesítők: "." az állapot-, bemenet- és szalagolvasás-pozíciókban,
    // "&" a célállapotban ("ugyanoda") és a szalag-írásban ("ugyanazt írja")
    const rawInput = input === "head" ? (parts[1] === "." ? "." : inputSym) : EPS;
    expandWildcard(
      [from, ...(input === "head" ? [rawInput] : []), to],
      [states, ...(input === "head" ? [alphabet] : []), states],
      (resolved) => {
        const f = resolved[0];
        const inp = input === "head" ? resolved[1] : EPS;
        const t = resolved[resolved.length - 1];
        const target = t === "&" ? f : t;
        // szalag-olvasás "." kibontása minden ábécébeli jelre + a write "&" feloldása
        const expandTapeOps = (i: number, acc: StorageOp[]) => {
          if (i === ops.length) {
            transitions.push({ from: f, to: target, input: inp, ops: acc });
            return;
          }
          const op = ops[i];
          if (op.type !== "tape") {
            expandTapeOps(i + 1, [...acc, op]);
            return;
          }
          const reads = op.read === "." ? alphabet : [op.read];
          for (const sym of reads) {
            expandTapeOps(i + 1, [...acc, { ...op, read: sym, write: op.write === "&" ? sym : op.write }]);
          }
        };
        expandTapeOps(0, []);
      }
    );
  }

  // szalag-írások utólagos validálása (a & és . feloldása után)
  for (const t of transitions) {
    for (let i = 0; i < t.ops.length; i++) {
      const op = t.ops[i];
      if (op.type === "tape" && op.write !== TAPE_BLANK && !alphabet.includes(op.write))
        return failResult([
          err(
            `Ismeretlen szalagjel az írásban: „${op.write}” (${storages[i].id})`,
            `Szalagábécé: ${[...alphabet, TAPE_BLANK].join(", ")}`
          )
        ]);
    }
  }

  const machine: Machine = {
    kind: "machine",
    name: name || "M",
    alphabet,
    states,
    start,
    accept,
    acceptMode,
    input,
    storages,
    transitions
  };

  if (accept.length === 0 && acceptMode === "finalState" && storages.length === 0)
    diags.push(warn("Nincs elfogadó állapot", "A gép így az üres nyelvet ismeri fel."));

  // szalagos bemenetű (TM-szerű) gépnél a többértékűség könnyen véletlen — jelezzük
  if (input !== "head") {
    const analysis = analyzeMachine(machine);
    if (!analysis.isDeterministic) {
      const n = analysis.nondeterministicAt[0];
      diags.push(
        warn(
          `Nemdeterminisztikus gép: a(z) ${n.state} állapotban több átmenet is illeszkedhet`,
          "A szimuláció minden ágat követ; a gráfon kattintással konkrét ág is választható."
        )
      );
    }
  }

  return okResult(machine, diags);
}

/* ------------------------------------------------------------------ */
/* Grammar                                                              */
/* ------------------------------------------------------------------ */

export function parseGrammar(source: string): OpResult<Grammar> {
  const base = parseYamlBody(source, ["Grammar", "grammar", "nyelvtan"]);
  if (!base.ok) return failResult(base.diagnostics);
  const { name, body } = base.value!;
  const diags: Diagnostic[] = [];

  for (const [f, what] of [
    ["variables", "A nemterminálisok, pl. variables: S, A, B"],
    ["init", "A kezdőszimbólum, pl. init: S"],
    ["charset", "A terminálisok, pl. charset: a, b"],
    ["rules", "A szabályok, pl. rules: [S -> aA | b]"]
  ] as const) {
    const d = requireField(body, f, what);
    if (d) return failResult([d]);
  }

  const terminals = parseList(body["charset"], "charset", diags);
  const nonterminals = parseList(body["variables"], "variables", diags);
  const start = String(body["init"]).trim();

  if (!nonterminals.includes(start))
    return failResult([err(`A kezdőszimbólum (${start}) nincs a nemterminálisok között`)]);

  const overlap = terminals.filter((t) => nonterminals.includes(t));
  if (overlap.length)
    return failResult([
      err(`Ütköző jelek: ${overlap.join(", ")}`, "Egy jel nem lehet egyszerre terminális és nemterminális.")
    ]);

  const known = new Set([...terminals, ...nonterminals]);
  const rules: GrammarRule[] = [];
  const lines = parseList(body["rules"], "rules", diags, false);
  for (const line of lines) {
    const m = /^(.+?)(?:->|→)(.*)$/.exec(line.replaceAll(" ", ""));
    if (!m) {
      return failResult([
        err(`Hibás szabály: „${line}”`, "Alak: BAL -> JOBB1 | JOBB2 — pl. „S -> aA | b”. ε-hoz írj $-t vagy ε-t.")
      ]);
    }
    const left = m[1];
    for (const c of left)
      if (!known.has(c))
        return failResult([
          err(`Ismeretlen jel a szabály bal oldalán: „${c}”`, `Szabály: „${line}”. Minden jelet fel kell venni a charset vagy variables mezőbe.`)
        ]);
    if (![...left].some((c) => nonterminals.includes(c)))
      return failResult([
        err(`A szabály bal oldala nem tartalmaz nemterminálist: „${line}”`, "Generatív nyelvtanban a bal oldalon legalább egy nemterminálisnak kell lennie.")
      ]);

    for (const alt of m[2].split("|")) {
      const right = EPS_ALIASES.has(alt) || alt === "" ? "" : alt;
      for (const c of right)
        if (!known.has(c))
          return failResult([
            err(`Ismeretlen jel a szabály jobb oldalán: „${c}”`, `Szabály: „${line}”. Minden jelet fel kell venni a charset vagy variables mezőbe.`)
          ]);
      rules.push({ left, right });
    }
  }

  const g: Grammar = { kind: "grammar", name: name || "G", terminals, nonterminals, start, rules };
  return okResult(g, diags);
}

/* ------------------------------------------------------------------ */
/* Közös belépési pont                                                  */
/* ------------------------------------------------------------------ */

const TYPE_KEYS: { keys: string[]; parse: (s: string) => OpResult<Definition> }[] = [
  { keys: ["Machine", "machine", "gep", "gép"], parse: parseMachine as (s: string) => OpResult<Definition> },
  { keys: ["Grammar", "grammar", "nyelvtan"], parse: parseGrammar as (s: string) => OpResult<Definition> }
];

/** Megállapítja, hogy a forrás YAML-definíció-e, és ha igen, beolvassa. */
export function parseDefinition(source: string): OpResult<Definition> | null {
  const firstWord = /^\s*([A-Za-z]+)\s*:/.exec(source);
  if (!firstWord) return null;
  const entry = TYPE_KEYS.find((t) => t.keys.includes(firstWord[1]));
  if (!entry) return null;
  return entry.parse(source);
}
