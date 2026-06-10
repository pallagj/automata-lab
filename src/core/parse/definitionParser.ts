import yaml from "js-yaml";
import { Diagnostic, EPS, err, failResult, info, okResult, OpResult, warn } from "../types";
import { FSM, makeFSM } from "../fsm/fsm";
import { PDA, PDATransition } from "../pda/pda";
import { TM, TMTransition, TM_BLANK } from "../tm/tm";
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

export type Definition = FSM | PDA | TM | Grammar;

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
/* FSM                                                                  */
/* ------------------------------------------------------------------ */

export function parseFSM(source: string): OpResult<FSM> {
  const base = parseYamlBody(source, ["StateMachine", "fsm", "FSM", "automata"]);
  if (!base.ok) return failResult(base.diagnostics);
  const { name, body } = base.value!;
  const diags: Diagnostic[] = [];

  for (const [f, what] of [
    ["states", "Az állapotok felsorolása, pl. states: S, A, B"],
    ["init", "A kezdőállapot, pl. init: S"],
    ["charset", "Az ábécé, pl. charset: a, b"]
  ] as const) {
    const d = requireField(body, f, what);
    if (d) return failResult([d]);
  }

  const alphabet = parseList(body["charset"], "charset", diags);
  const states = parseList(body["states"], "states", diags);
  const accept = parseList(body["accept"], "accept", diags);
  const start = String(body["init"]).trim();

  const stateSet = new Set(states);
  if (!stateSet.has(start)) {
    return failResult([
      err(`A kezdőállapot (${start}) nincs az állapotok között`, `Felsorolt állapotok: ${states.join(", ")}`)
    ]);
  }
  for (const a of accept) {
    if (!stateSet.has(a))
      return failResult([
        err(`Az elfogadó állapot (${a}) nincs az állapotok között`, `Felsorolt állapotok: ${states.join(", ")}`)
      ]);
  }
  if (accept.length === 0)
    diags.push(warn("Nincs elfogadó állapot", "Az automata így az üres nyelvet ismeri fel."));

  const transitions: { from: string; symbol: string; to: string }[] = [];
  const lines = parseList(body["transitions"], "transitions", diags, false);
  for (const line of lines) {
    const parts = line.split(/\s+/).filter((p) => p !== "");
    if (parts.length !== 3) {
      return failResult([
        err(`Hibás átmenet: „${line}”`, "Az átmenet alakja: HONNAN SZIMBÓLUM HOVA — pl. „S a A”, vagy ε-átmenethez „S $ A”.")
      ]);
    }
    const symInput = normEps(parts[1]);
    // validálás (helyettesítők kivételével)
    if (parts[0] !== "." && !stateSet.has(parts[0]))
      return failResult([err(`Ismeretlen állapot az átmenetben: „${parts[0]}”`, `Sor: „${line}”. Felsorolt állapotok: ${states.join(", ")}`)]);
    if (parts[2] !== "." && parts[2] !== "&" && !stateSet.has(parts[2]))
      return failResult([err(`Ismeretlen célállapot az átmenetben: „${parts[2]}”`, `Sor: „${line}”.`)]);
    if (parts[1] !== "." && symInput !== EPS && !alphabet.includes(symInput))
      return failResult([
        err(`Ismeretlen szimbólum az átmenetben: „${parts[1]}”`, `Sor: „${line}”. Az ábécé: ${alphabet.join(", ")} (ε-hoz használj $-t).`)
      ]);

    expandWildcard(
      [parts[0], symInput, parts[2]],
      [states, alphabet, states],
      ([from, sym, to]) => {
        const target = to === "&" ? from : to;
        if (!transitions.some((t) => t.from === from && t.symbol === sym && t.to === target))
          transitions.push({ from, symbol: sym, to: target });
      }
    );
  }

  return okResult(
    makeFSM({ name: name || "M", alphabet, states, start, accept, transitions }),
    diags
  );
}

/* ------------------------------------------------------------------ */
/* PDA                                                                  */
/* ------------------------------------------------------------------ */

export function parsePDA(source: string): OpResult<PDA> {
  const base = parseYamlBody(source, ["PushdownMachine", "pda", "PDA"]);
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
  const startStack = String(body["initStack"] ?? body["startStack"] ?? "Z").trim();
  const stackAlphabet = parseList(body["stackCharset"] ?? body["stackAlphabet"], "stackCharset", diags);
  const acceptModeRaw = String(body["acceptMode"] ?? (accept.length > 0 ? "finalState" : "emptyStack")).trim();
  const acceptMode = acceptModeRaw === "emptyStack" ? "emptyStack" : "finalState";

  const stateSet = new Set(states);
  if (!stateSet.has(start))
    return failResult([err(`A kezdőállapot (${start}) nincs az állapotok között`)]);
  for (const a of accept)
    if (!stateSet.has(a)) return failResult([err(`Az elfogadó állapot (${a}) nincs az állapotok között`)]);

  if (accept.length === 0 && acceptMode === "finalState")
    diags.push(
      info(
        "Nincs elfogadó állapot — üres veremmel való elfogadásra váltottam",
        "PDA-nál kétféle elfogadás létezik: elfogadó állapottal vagy üres veremmel. Add meg az acceptMode: finalState / emptyStack mezőt, ha mást szeretnél."
      )
    );

  const transitions: PDATransition[] = [];
  const stackSyms = new Set<string>([startStack, ...stackAlphabet]);
  const lines = parseList(body["transitions"], "transitions", diags, false);
  for (const line of lines) {
    const parts = line.split(/\s+/).filter((p) => p !== "");
    // alak: FROM INPUT POP/PUSH TO  — pl. "A a Z/XZ B"
    if (parts.length !== 4 || !parts[2].includes("/")) {
      return failResult([
        err(
          `Hibás PDA-átmenet: „${line}”`,
          "Alak: HONNAN BEMENET LEVESZ/FELÍR HOVA — pl. „A a Z/XZ B” (a beolvasásakor Z helyett XZ kerül a verembe). ε-hoz használj $-t, üres felíráshoz „$”-t."
        )
      ]);
    }
    const [popRaw, pushRaw] = parts[2].split("/");
    const input = normEps(parts[1]);
    const pop = normEps(popRaw);
    const push = EPS_ALIASES.has(pushRaw) ? "" : pushRaw;

    if (parts[0] !== "." && !stateSet.has(parts[0]))
      return failResult([err(`Ismeretlen állapot: „${parts[0]}”`, `Sor: „${line}”.`)]);
    if (parts[3] !== "." && parts[3] !== "&" && !stateSet.has(parts[3]))
      return failResult([err(`Ismeretlen célállapot: „${parts[3]}”`, `Sor: „${line}”.`)]);
    if (input !== EPS && parts[1] !== "." && !alphabet.includes(input))
      return failResult([err(`Ismeretlen bemeneti szimbólum: „${parts[1]}”`, `Sor: „${line}”. Ábécé: ${alphabet.join(", ")}`)]);

    for (const c of pop === EPS ? [] : [pop]) stackSyms.add(c);
    for (const c of push) stackSyms.add(c);

    expandWildcard(
      [parts[0], input, parts[3]],
      [states, alphabet, states],
      ([from, inp, to]) => {
        const target = to === "&" ? from : to;
        transitions.push({ from, input: inp, pop, push, to: target });
      }
    );
  }

  const pda: PDA = {
    kind: "pda",
    name: name || "P",
    alphabet,
    stackAlphabet: [...stackSyms],
    states,
    start,
    startStack,
    accept,
    acceptMode: accept.length === 0 ? "emptyStack" : acceptMode,
    transitions
  };
  return okResult(pda, diags);
}

/* ------------------------------------------------------------------ */
/* TM                                                                   */
/* ------------------------------------------------------------------ */

export function parseTM(source: string): OpResult<TM> {
  const base = parseYamlBody(source, ["TuringMachine", "tm", "TM"]);
  if (!base.ok) return failResult(base.diagnostics);
  const { name, body } = base.value!;
  const diags: Diagnostic[] = [];

  for (const [f, what] of [
    ["states", "Az állapotok felsorolása"],
    ["init", "A kezdőállapot"],
    ["charset", "A szalagábécé (az _ üres jel automatikus)"]
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

  const tapeSyms = [...alphabet, TM_BLANK];
  const transitions: TMTransition[] = [];
  const lines = parseList(body["transitions"], "transitions", diags, false);
  for (const line of lines) {
    const parts = line.split(/\s+/).filter((p) => p !== "");
    // alak: FROM READ/WRITE MOVE TO — pl. "A a/b > B"
    if (parts.length !== 4 || !parts[1].includes("/")) {
      return failResult([
        err(
          `Hibás TM-átmenet: „${line}”`,
          "Alak: HONNAN OLVAS/ÍR MOZGÁS HOVA — pl. „A a/b > B”. Mozgás: > (jobbra), < (balra), = (marad). Üres jel: _ , „ugyanazt írja”: &."
        )
      ]);
    }
    const [readRaw, writeRaw] = parts[1].split("/");
    const moveMap: Record<string, "L" | "R" | "S"> = { ">": "R", "<": "L", "=": "S", R: "R", L: "L", S: "S" };
    const move = moveMap[parts[2]];
    if (!move)
      return failResult([err(`Ismeretlen mozgás: „${parts[2]}”`, `Sor: „${line}”. Használható: > < = (vagy R L S).`)]);

    if (parts[0] !== "." && !stateSet.has(parts[0]))
      return failResult([err(`Ismeretlen állapot: „${parts[0]}”`, `Sor: „${line}”.`)]);
    if (parts[3] !== "." && parts[3] !== "&" && !stateSet.has(parts[3]))
      return failResult([err(`Ismeretlen célállapot: „${parts[3]}”`, `Sor: „${line}”.`)]);
    if (readRaw !== "." && readRaw !== TM_BLANK && !alphabet.includes(readRaw))
      return failResult([
        err(`Ismeretlen szalagjel: „${readRaw}”`, `Sor: „${line}”. Szalagábécé: ${tapeSyms.join(", ")}`)
      ]);

    // a "." helyettesítő szándékosan csak az ábécére terjed ki (az üres jelre nem,
    // különben ütközne a kifejezetten _-ra írt átmenetekkel)
    expandWildcard(
      [parts[0], readRaw, parts[3]],
      [states, alphabet, states],
      ([from, read, to]) => {
        const write = writeRaw === "&" ? read : writeRaw;
        const target = to === "&" ? from : to;
        transitions.push({ from, read, write, move, to: target });
      }
    );
  }

  const tm: TM = { kind: "tm", name: name || "T", alphabet, states, start, accept, transitions };

  const dupes = new Set<string>();
  for (const tr of transitions) {
    const key = `${tr.from}|${tr.read}`;
    if (dupes.has(key)) {
      diags.push(
        warn(
          `Nemdeterminisztikus Turing-gép: δ(${tr.from}, ${tr.read === TM_BLANK ? "␣" : tr.read}) többértékű`,
          "A szimuláció az első illeszkedő átmenetet választja; a gráfon kattintással másik ág is választható."
        )
      );
      break;
    }
    dupes.add(key);
  }

  return okResult(tm, diags);
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
  { keys: ["StateMachine", "fsm", "FSM", "automata"], parse: parseFSM as (s: string) => OpResult<Definition> },
  { keys: ["PushdownMachine", "pda", "PDA"], parse: parsePDA as (s: string) => OpResult<Definition> },
  { keys: ["TuringMachine", "tm", "TM"], parse: parseTM as (s: string) => OpResult<Definition> },
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
