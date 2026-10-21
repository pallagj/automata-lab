import yaml from "js-yaml";
import { Diagnostic, EPS, err, failResult, info, okResult, OpResult, tx, warn } from "../types";
import {
  analyzeMachine,
  defaultStorageAlphabet,
  Machine,
  MachineTransition,
  StorageOp,
  StorageSpec,
  StorageType,
  TAPE_BLANK
} from "../machine/machine";
import { Grammar, GrammarRule } from "../grammar/grammar";
import { symbolString } from "../epsilon";
import { deltaShape, fieldCount, readDelta } from "./delta";
import { canonicalLabel, canonicalName, formatIdent, parseIdent, suggestName, symbolTokens } from "../symbols";

/**
 * Parses YAML-based definitions with friendly, precise error messages.
 *
 * A machine's transitions are written as the lecture notes write δ (see parse/delta.ts),
 * a grammar's rules as S -> aS | b. In an alphabet (charset) "a-d" is a range of symbols;
 * states and variables are names, so a dash is part of the name. Everywhere "ε" (or "eps",
 * "epsilon") is the empty word — see core/epsilon.ts.
 */

export type Definition = Machine | Grammar;

/** a single symbol position: ε (or eps, epsilon) means "no symbol" */
function normEps(s: string): string {
  const v = symbolString(s);
  return v === "" ? EPS : v;
}

/** comma split that does not split inside {A,B} set names */
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

/** comma-separated list / YAML list → array; an alphabet's list expands ranges (a-d) */
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
          diags.push(
            warn(
              tx("definitionParser.reversedRange.title", { field, range: t }),
              tx("definitionParser.reversedRange.detail")
            )
          );
          return [];
        }
        if (to - from > 60) {
          diags.push(warn(tx("definitionParser.rangeTooLarge.title", { field, range: t })));
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

const MACHINE_KEYS = ["Machine", "machine"];
const GRAMMAR_KEYS = ["Grammar", "grammar"];

function parseYamlBody(source: string, expectedKeys: string[]): OpResult<ParsedBase & { key: string }> {
  let parsed: unknown;
  try {
    parsed = yaml.load(source);
  } catch (e) {
    const ye = e as { mark?: { line?: number; column?: number }; reason?: string };
    const line = ye.mark?.line !== undefined ? ye.mark.line + 1 : undefined;
    return failResult([
      err(
        line !== undefined
          ? tx("definitionParser.yamlSyntaxError.titleAtLine", { line })
          : tx("definitionParser.yamlSyntaxError.title"),
        tx("definitionParser.yamlSyntaxError.detail", { reason: ye.reason ?? (e as Error).message })
      )
    ]);
  }
  if (typeof parsed !== "object" || parsed === null) {
    return failResult([err(tx("definitionParser.emptyOrUnparseable"))]);
  }
  const keys = Object.keys(parsed as object);
  const key = keys.find((k) => expectedKeys.includes(k));
  if (!key)
    return failResult([
      err(tx("definitionParser.missingTypeKey.title"), tx("definitionParser.missingTypeKey.detail", { keys: expectedKeys.join(", ") }))
    ]);
  const body = (parsed as Record<string, unknown>)[key];
  if (typeof body !== "object" || body === null) {
    return failResult([
      err(tx("definitionParser.emptyBody.title", { key }), tx("definitionParser.emptyBody.detail"))
    ]);
  }
  const b = body as Record<string, unknown>;
  const raw = String(b["name"] ?? "").trim();
  const name = raw === "" ? "" : canonicalName(raw);
  if (name === null) return failResult([badName(raw)]);
  return okResult({ name, body: b, key });
}

/** A name that breaks the one-letter rule, with the name we would suggest instead. */
function badName(raw: string): Diagnostic {
  return err(tx("definitionParser.badName.title", { name: raw }), tx("definitionParser.badName.detail", { suggestion: suggestName(raw) }));
}

function requireField(
  body: Record<string, unknown>,
  field: string,
  schema: "machine" | "grammar"
): Diagnostic | null {
  if (body[field] === undefined || body[field] === null || String(body[field]).trim() === "") {
    return err(tx("definitionParser.missingField.title", { field }), tx(`definitionParser.${schema}.fieldHints.${field}`));
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* General machine (Machine)                                           */
/* ------------------------------------------------------------------ */

const STORAGE_TYPES: Record<string, StorageType> = {
  stack: "stack",
  queue: "queue",
  tape: "tape"
};

/** Default initial content of a stack when none is given. */
const STACK_DEFAULT_INIT = "Z";

/** A storage as its entry gives it: its alphabet is null when the entry leaves it out. */
export interface StorageEntry extends Omit<StorageSpec, "alphabet"> {
  alphabet: string[] | null;
}

/**
 * A storage entry in the storages mapping:
 *   v1: stack                                  — short form, with the defaults
 *   v2: { type: stack, charset: [Z, A], init: Z }  — long form (default works instead of init too)
 *   t:  { type: tape, infinite: both }         — a tape infinite both ways
 * The alphabet Γ (charset) and the initial content may be left out: see
 * defaultStorageAlphabet and STACK_DEFAULT_INIT. A tape is infinite to the right only
 * unless it says otherwise (see isOneWayTape).
 */
export function parseStorageEntry(id: string, raw: unknown): OpResult<StorageEntry> {
  const bad = () =>
    failResult<StorageEntry>([
      err(
        tx("definitionParser.unknownStorageType.title", { id }),
        tx("definitionParser.unknownStorageType.detail")
      )
    ]);
  const diags: Diagnostic[] = [];
  let typeRaw = "";
  let init: string | undefined;
  let alphabet: string[] | null = null;
  let infiniteRaw: string | undefined;
  if (raw === null || typeof raw === "string") {
    typeRaw = String(raw ?? "").trim();
  } else if (typeof raw === "object" && !Array.isArray(raw)) {
    const o = raw as Record<string, unknown>;
    typeRaw = String(o["type"] ?? "").trim();
    const i = o["init"] ?? o["default"];
    if (i !== undefined && i !== null) init = String(i);
    const inf = o["infinite"];
    if (inf !== undefined && inf !== null) infiniteRaw = String(inf).trim();
    const items = parseList(o["charset"], `${id}.charset`, diags);
    if (items.length > 0) {
      alphabet = [];
      for (const item of items) {
        // one symbol each: Z, Z_0, X_a, Z′, 0, _ — the same reading as the operations'
        const sym = symbolTokens(item);
        if (sym.length !== 1)
          return failResult([
            err(
              tx("definitionParser.machine.storageCharsetNotOneSymbol.title", { symbol: item, storageId: id }),
              tx("definitionParser.machine.storageCharsetNotOneSymbol.detail", {
                example: formatIdent({ base: "Z", primes: 0, sub: "0" })
              })
            )
          ]);
        if (!alphabet.includes(sym[0])) alphabet.push(sym[0]);
      }
    }
  } else {
    return bad();
  }
  const type = STORAGE_TYPES[typeRaw];
  if (!type) return bad();
  if (init === undefined) init = type === "stack" ? STACK_DEFAULT_INIT : "";
  const entry: StorageEntry = { id, type, alphabet, init: symbolTokens(init) };
  if (infiniteRaw !== undefined) {
    if (type !== "tape")
      return failResult([
        err(tx("definitionParser.infiniteOnlyForTape.title", { id }), tx("definitionParser.infiniteOnlyForTape.detail"))
      ]);
    if (infiniteRaw !== "right" && infiniteRaw !== "both")
      return failResult([
        err(
          tx("definitionParser.badInfinite.title", { id, value: infiniteRaw }),
          tx("definitionParser.badInfinite.detail")
        )
      ]);
    entry.infinite = infiniteRaw;
  } else if (type === "tape") {
    entry.infinite = "right";
  }
  return okResult(entry, diags);
}

/** Head moves in the YAML: always the English letters (the UI shows its language's, J B H). */
const MOVES = ["L", "R", "S"] as const;

/**
 * Parses a storage's operation from its parts of a transition: what it reads (a stack's
 * top, a tape's cell) and what it gets (the word pushed; the symbol written and the move).
 * Whether the symbols are in the storage's alphabet is checked once every alphabet is known.
 */
function parseStorageOp(spec: StorageEntry, arg: string, values: string[], line: string): OpResult<StorageOp> {
  if (spec.type === "tape") {
    // a tape cell always holds exactly one symbol: the blank is _
    for (const part of [arg, values[0]]) {
      if (symbolTokens(part).length !== 1)
        return failResult([
          err(
            tx("definitionParser.storageOp.tapeOneSymbol.title", { tokens: part, storageId: spec.id }),
            tx("definitionParser.storageOp.tapeOneSymbol.detail", { line })
          )
        ]);
    }
    const move = MOVES.find((m) => m === values[1]);
    if (!move)
      return failResult([
        err(
          tx("definitionParser.storageOp.unknownMove.title", { tokens: values[1], storageId: spec.id }),
          tx("definitionParser.storageOp.unknownMove.detail", { line })
        )
      ]);
    return okResult({ type: "tape", read: symbolTokens(arg)[0], write: symbolTokens(values[0])[0], move });
  }

  // the symbol taken off is a single symbol (or ε: nothing is taken)
  const taken = symbolTokens(arg);
  if (taken.length > 1)
    return failResult([
      err(
        tx("definitionParser.storageOp.oneSymbol.title", { tokens: arg, storageId: spec.id }),
        tx("definitionParser.storageOp.oneSymbol.detail", { line, example: formatIdent({ base: "Z", primes: 0, sub: "0" }) })
      )
    ]);
  const a = taken[0] ?? EPS;
  const b = symbolTokens(values[0]);
  return okResult<StorageOp>(
    spec.type === "stack" ? { type: "stack", pop: a, push: b } : { type: "queue", take: a, put: b }
  );
}

/**
 * General machine from YAML:
 *
 *   Machine:
 *     name: AnBnCn
 *     charset: a, b, c
 *     states: q0, q1, q2
 *     init: q0
 *     accept: q2
 *     input: head            # default; or the id of a storage
 *     storages:
 *       v1: stack            # short form (a stack starts with Z by default)
 *       v2:
 *         type: stack
 *         charset: $, B      # its alphabet Γ (by default the symbols it uses)
 *         init: $
 *     transitions:
 *       - (q0, a, Z, $) -> (q0, AZ, B$)   # δ's arguments -> its value, see parse/delta.ts
 *
 * The kind of machine (automaton / pushdown automaton / Turing machine / general
 * machine) is decided by its configuration — there is no separate type key.
 */
export function parseMachine(source: string): OpResult<Machine> {
  const base = parseYamlBody(source, MACHINE_KEYS);
  if (!base.ok) return failResult(base.diagnostics);
  const { name, body } = base.value!;
  const diags: Diagnostic[] = [];

  for (const f of ["states", "init", "charset"] as const) {
    const d = requireField(body, f, "machine");
    if (d) return failResult([d]);
  }

  const alphabet = parseList(body["charset"], "charset", diags);
  // a state label that is a name is canonical (q0 = q_0); see canonicalLabel
  const states = parseList(body["states"], "states", diags, false).map(canonicalLabel);
  const accept = parseList(body["accept"], "accept", diags, false).map(canonicalLabel);
  const start = canonicalLabel(String(body["init"]));

  const stateSet = new Set(states);
  if (!stateSet.has(start))
    return failResult([err(tx("definitionParser.machine.startNotInStates", { start }))]);
  for (const a of accept)
    if (!stateSet.has(a))
      return failResult([err(tx("definitionParser.machine.acceptNotInStates", { state: a }))]);

  // storages: a mapping (id → type or {type, charset, init}) or missing (= storage-free machine)
  const storages: StorageEntry[] = [];
  const storagesRaw = body["storages"];
  if (storagesRaw !== undefined && storagesRaw !== null) {
    if (typeof storagesRaw !== "object" || Array.isArray(storagesRaw)) {
      return failResult([
        err(tx("definitionParser.machine.badStoragesField.title"), tx("definitionParser.machine.badStoragesField.detail"))
      ]);
    }
    for (const [id, raw] of Object.entries(storagesRaw as Record<string, unknown>)) {
      const r = parseStorageEntry(id.trim(), raw);
      if (!r.ok) return failResult(r.diagnostics);
      diags.push(...r.diagnostics);
      if (storages.some((s) => s.id === r.value!.id))
        return failResult([err(tx("definitionParser.machine.duplicateStorageId", { id }))]);
      storages.push(r.value!);
    }
  }

  // input: a read head or a storage
  const inputRaw = String(body["input"] ?? "head").trim();
  const input = inputRaw === "" || inputRaw === "head" ? "head" : inputRaw;
  if (input !== "head" && !storages.some((s) => s.id === input)) {
    return failResult([
      err(
        tx("definitionParser.machine.badInputField.title", { input }),
        tx("definitionParser.machine.badInputField.detail", {
          storages: storages.map((s) => s.id).join(", ") || "—"
        })
      )
    ]);
  }

  const acceptModeRaw = String(body["acceptMode"] ?? "finalState").trim();
  const acceptMode: Machine["acceptMode"] =
    acceptModeRaw === "emptyStorages" || acceptModeRaw === "emptyStack" ? "emptyStorages" : "finalState";

  if (accept.length === 0 && acceptMode === "finalState" && input === "head" && storages.length > 0)
    diags.push(
      info(
        tx("definitionParser.machine.noAcceptSuggestEmptyStorages.title"),
        tx("definitionParser.machine.noAcceptSuggestEmptyStorages.detail")
      )
    );

  const hasHead = input === "head";
  const types = storages.map((s) => s.type);
  const shape = deltaShape(hasHead, types);
  const argCount = 1 + (hasHead ? 1 : 0) + storages.length;
  const valueCount = 1 + storages.reduce((n, s) => n + fieldCount(s.type) - 1, 0);
  const transitions: MachineTransition[] = [];
  /** the line each transition comes from */
  const lineOf: string[] = [];
  // one transition per line — commas belong to the line, so a list is not split at them
  const raw = body["transitions"];
  const lines = (Array.isArray(raw) ? raw.map((l) => String(l ?? "")) : String(raw ?? "").split("\n"))
    .map((l) => l.trim())
    .filter((l) => l !== "");
  for (const line of lines) {
    const d = readDelta(line);
    // every part written out: ε too, as in the notes
    const complete = [...d.args, ...d.values].every((p) => p !== "");
    if (!d.wellFormed || !complete || d.args.length !== argCount || d.values.length !== valueCount)
      return failResult([
        err(
          tx("definitionParser.machine.invalidTransition.title", { line }),
          tx("definitionParser.machine.invalidTransition.detail", { shape })
        )
      ]);
    const from = canonicalLabel(d.args[0]);
    const to = canonicalLabel(d.values[0]);
    if (!stateSet.has(from))
      return failResult([
        err(tx("definitionParser.machine.unknownFromState", { state: from }), tx("definitionParser.line", { line }))
      ]);
    if (!stateSet.has(to))
      return failResult([
        err(tx("definitionParser.machine.unknownToState", { state: to }), tx("definitionParser.line", { line }))
      ]);

    let a = 1;
    let v = 1;
    let inputSym = EPS;
    if (hasHead) {
      inputSym = normEps(d.args[a++]);
      if (inputSym !== EPS && !alphabet.includes(inputSym))
        return failResult([
          err(
            tx("definitionParser.machine.unknownInputSymbol", { symbol: inputSym }),
            tx("definitionParser.machine.alphabetHint", { line, alphabet: alphabet.join(", ") })
          )
        ]);
    }
    const ops: StorageOp[] = [];
    for (const s of storages) {
      const n = fieldCount(s.type) - 1;
      const r = parseStorageOp(s, d.args[a++], d.values.slice(v, v + n), line);
      v += n;
      if (!r.ok) return failResult(r.diagnostics);
      ops.push(r.value!);
    }
    transitions.push({ from, to, input: inputSym, ops });
    lineOf.push(line);
  }

  // every storage's alphabet Γ: as given, or what it holds by default
  const specs: StorageSpec[] = storages.map((s, i) => ({
    ...s,
    alphabet: s.alphabet ?? defaultStorageAlphabet(alphabet, s, transitions.map((t) => t.ops[i]))
  }));
  for (const s of specs) {
    const gamma = `{${s.alphabet.join(", ")}}`;
    if (s.type === "tape" && !s.alphabet.includes(TAPE_BLANK))
      return failResult([
        err(tx("definitionParser.machine.blankNotInTapeCharset.title", { storageId: s.id }), tx("definitionParser.machine.blankNotInTapeCharset.detail"))
      ]);
    if (s.id === input) {
      if (s.type === "tape" && alphabet.includes(TAPE_BLANK))
        return failResult([
          err(tx("definitionParser.machine.blankInInput.title"), tx("definitionParser.machine.blankInInput.detail", { storageId: s.id }))
        ]);
      const missing = alphabet.filter((a) => !s.alphabet.includes(a));
      if (missing.length > 0)
        return failResult([
          err(
            tx("definitionParser.machine.inputNotInStorageCharset.title", { storageId: s.id, symbols: missing.join(", ") }),
            tx("definitionParser.machine.inputNotInStorageCharset.detail")
          )
        ]);
    }
    const strange = s.init.find((x) => !s.alphabet.includes(x));
    if (strange !== undefined)
      return failResult([
        err(
          tx("definitionParser.machine.initNotInStorageCharset.title", { storageId: s.id, symbol: strange }),
          tx("definitionParser.machine.initNotInStorageCharset.detail", { storageId: s.id, gamma })
        )
      ]);
  }

  // the symbols of every operation, once & and . are resolved
  for (let k = 0; k < transitions.length; k++) {
    for (let i = 0; i < specs.length; i++) {
      const op = transitions[k].ops[i];
      const used =
        op.type === "stack" ? [op.pop, ...op.push] : op.type === "queue" ? [op.take, ...op.put] : [op.read, op.write];
      const unknown = used.find((x) => x !== EPS && !specs[i].alphabet.includes(x));
      if (unknown !== undefined)
        return failResult([
          err(
            tx("definitionParser.machine.unknownStorageSymbol.title", { symbol: unknown, storageId: specs[i].id }),
            tx("definitionParser.machine.unknownStorageSymbol.detail", {
              line: lineOf[k],
              storageId: specs[i].id,
              gamma: `{${specs[i].alphabet.join(", ")}}`
            })
          )
        ]);
    }
  }

  const machine: Machine = {
    kind: "machine",
    name,
    alphabet,
    states,
    start,
    accept,
    acceptMode,
    input,
    storages: specs,
    transitions
  };

  if (accept.length === 0 && acceptMode === "finalState" && storages.length === 0)
    diags.push(warn(tx("definitionParser.machine.noAcceptState.title"), tx("definitionParser.machine.noAcceptState.detail")));

  // with tape input (TM-like) nondeterminism is easily accidental — warn about it
  if (input !== "head") {
    const analysis = analyzeMachine(machine);
    if (!analysis.isDeterministic) {
      const n = analysis.nondeterministicAt[0];
      diags.push(
        warn(
          tx("definitionParser.machine.nondeterministicMachine.title", { state: n.state }),
          tx("definitionParser.machine.nondeterministicMachine.detail")
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
  const base = parseYamlBody(source, GRAMMAR_KEYS);
  if (!base.ok) return failResult(base.diagnostics);
  const { name, body } = base.value!;
  const diags: Diagnostic[] = [];

  for (const f of ["variables", "init", "charset", "rules"] as const) {
    const d = requireField(body, f, "grammar");
    if (d) return failResult([d]);
  }

  // terminals are the characters of the words; variables are names (S, A, X_a, C_1, S′)
  const terminals = parseList(body["charset"], "charset", diags);
  const long = terminals.find((t) => [...t].length !== 1);
  if (long !== undefined)
    return failResult([
      err(tx("definitionParser.grammar.terminalNotOneChar.title", { symbol: long }), tx("definitionParser.grammar.terminalNotOneChar.detail"))
    ]);
  const nonterminals: string[] = [];
  for (const raw of parseList(body["variables"], "variables", diags, false)) {
    const v = canonicalName(raw);
    if (v === null) return failResult([badName(raw)]);
    nonterminals.push(v);
  }
  const startRaw = String(body["init"]).trim();
  const start = canonicalName(startRaw) ?? startRaw;

  if (!nonterminals.includes(start))
    return failResult([err(tx("definitionParser.grammar.startNotInNonterminals", { start }))]);

  const overlap = terminals.filter((t) => nonterminals.includes(t));
  if (overlap.length)
    return failResult([
      err(
        tx("definitionParser.grammar.overlappingSymbols.title", { symbols: overlap.join(", ") }),
        tx("definitionParser.grammar.overlappingSymbols.detail")
      )
    ]);

  const known = new Set([...terminals, ...nonterminals]);
  const nt = new Set(nonterminals);
  const term = new Set(terminals);

  /**
   * The symbols of one rule side. As a convenience for typed text, a letter followed by
   * digits is the variable with that subscript when such a variable exists (S1 → S_1) —
   * unless the digits are terminals too, then the text is ambiguous.
   */
  const readSide = (text: string, line: string): OpResult<string[]> => {
    const out: string[] = [];
    // a space separates: S 1 is never S_1
    for (const chunk of text.trim().split(/\s+/)) {
      const r = readChunk(symbolTokens(chunk), line);
      if (!r.ok) return r;
      out.push(...r.value!);
    }
    return okResult(out);
  };
  const readChunk = (tokens: string[], line: string): OpResult<string[]> => {
    const out: string[] = [];
    for (let i = 0; i < tokens.length; i++) {
      const id = parseIdent(tokens[i], false);
      let j = i + 1;
      while (j < tokens.length && /^[0-9]$/.test(tokens[j])) j++;
      if (id && id.sub === "" && j > i + 1) {
        const digits = tokens.slice(i + 1, j);
        const merged = formatIdent({ ...id, sub: digits.join("") });
        if (nt.has(merged)) {
          if (known.has(tokens[i]) && digits.every((d) => term.has(d)))
            return failResult([
              err(
                tx("definitionParser.grammar.ambiguousSubscript.title", { text: tokens.slice(i, j).join("") }),
                tx("definitionParser.grammar.ambiguousSubscript.detail", { name: merged, separate: tokens.slice(i, j).join(" "), line })
              )
            ]);
          out.push(merged);
          i = j - 1;
          continue;
        }
      }
      out.push(tokens[i]);
    }
    return okResult(out);
  };

  const rules: GrammarRule[] = [];
  const lines = parseList(body["rules"], "rules", diags, false);
  for (const line of lines) {
    const m = /^(.+?)(?:->|→)(.*)$/.exec(line);
    if (!m) {
      return failResult([
        err(tx("definitionParser.grammar.invalidRule.title", { line }), tx("definitionParser.grammar.invalidRule.detail"))
      ]);
    }
    const leftR = readSide(m[1], line);
    if (!leftR.ok) return failResult(leftR.diagnostics);
    const left = leftR.value!;
    for (const c of left)
      if (!known.has(c))
        return failResult([
          err(
            tx("definitionParser.grammar.unknownSymbolLeft", { symbol: c }),
            tx("definitionParser.grammar.ruleDetail", { line })
          )
        ]);
    if (!left.some((c) => nt.has(c)))
      return failResult([
        err(
          tx("definitionParser.grammar.leftMissingNonterminal.title", { line }),
          tx("definitionParser.grammar.leftMissingNonterminal.detail")
        )
      ]);

    for (const alt of m[2].split("|")) {
      // the empty word is written as ε, as in the notes: an empty alternative is a slip
      if (alt.trim() === "")
        return failResult([
          err(tx("definitionParser.grammar.emptyAlternative.title", { line }), tx("definitionParser.grammar.emptyAlternative.detail"))
        ]);
      const rightR = readSide(alt, line);
      if (!rightR.ok) return failResult(rightR.diagnostics);
      const right = rightR.value!;
      for (const c of right)
        if (!known.has(c))
          return failResult([
            err(
              tx("definitionParser.grammar.unknownSymbolRight", { symbol: c }),
              tx("definitionParser.grammar.ruleDetail", { line })
            )
          ]);
      rules.push({ left, right });
    }
  }

  const g: Grammar = { kind: "grammar", name, terminals, nonterminals, start, rules };
  return okResult(g, diags);
}

/* ------------------------------------------------------------------ */
/* Common entry point                                                  */
/* ------------------------------------------------------------------ */

const TYPE_KEYS: { keys: string[]; parse: (s: string) => OpResult<Definition> }[] = [
  { keys: MACHINE_KEYS, parse: parseMachine as (s: string) => OpResult<Definition> },
  { keys: GRAMMAR_KEYS, parse: parseGrammar as (s: string) => OpResult<Definition> }
];

/** Determines whether the source is a YAML definition and, if so, parses it. */
export function parseDefinition(source: string): OpResult<Definition> | null {
  const firstWord = /^\s*([A-Za-z]+)\s*:/.exec(source);
  if (!firstWord) return null;
  const entry = TYPE_KEYS.find((t) => t.keys.includes(firstWord[1]));
  if (!entry) return null;
  return entry.parse(source);
}
