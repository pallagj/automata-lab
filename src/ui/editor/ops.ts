/**
 * Expression-language operations for the cell operation menu: description, group,
 * arity and an exact applicability check (a dry run of the core algorithms, so it
 * always agrees with the actual evaluation).
 */
import { Definition } from "../../core/parse/definitionParser";
import { FSM } from "../../core/fsm/fsm";
import {
  checkEquivalence,
  cleanFSM,
  complement,
  complete,
  concatFSM,
  determinize,
  minimize,
  product,
  reachable,
  removeEpsilon,
  reverseFSM,
  starFSM,
  unionEpsilon
} from "../../core/fsm/ops";
import { regexToNFA } from "../../core/fsm/regex";
import { fsmToRegex } from "../../core/fsm/toRegex";
import { fsmToGrammar, grammarToFSM, grammarToPDA, removeEpsilonRules } from "../../core/grammar/grammar";
import { machineCaps, machineToFSM } from "../../core/machine/machine";
import { I18nText, OpResult } from "../../core/types";
import { ExprValue } from "../../core/expr/expression";

/** I18nText constructor for this file's own (ui-namespace) strings. */
function ux(key: string, params?: Record<string, string | number>): I18nText {
  return { key, params, ns: "ui" };
}

export interface OpInfo {
  name: string;
  descKey: string;
  args: 1 | 2;
  /** which kind of value it applies to */
  input: "fsm" | "grammar";
  groupKey: string;
}

export const OPS: OpInfo[] = [
  { groupKey: "editor.ops.groups.normalize", name: "epsfree", descKey: "editor.ops.epsfree", args: 1, input: "fsm" },
  { groupKey: "editor.ops.groups.normalize", name: "det", descKey: "editor.ops.det", args: 1, input: "fsm" },
  { groupKey: "editor.ops.groups.normalize", name: "complete", descKey: "editor.ops.complete", args: 1, input: "fsm" },
  { groupKey: "editor.ops.groups.normalize", name: "reachable", descKey: "editor.ops.reachable", args: 1, input: "fsm" },
  { groupKey: "editor.ops.groups.normalize", name: "min", descKey: "editor.ops.min", args: 1, input: "fsm" },
  { groupKey: "editor.ops.groups.normalize", name: "clean", descKey: "editor.ops.clean", args: 1, input: "fsm" },

  { groupKey: "editor.ops.groups.language", name: "complement", descKey: "editor.ops.complement", args: 1, input: "fsm" },
  { groupKey: "editor.ops.groups.language", name: "union", descKey: "editor.ops.union", args: 2, input: "fsm" },
  { groupKey: "editor.ops.groups.language", name: "intersect", descKey: "editor.ops.intersect", args: 2, input: "fsm" },
  { groupKey: "editor.ops.groups.language", name: "difference", descKey: "editor.ops.difference", args: 2, input: "fsm" },
  { groupKey: "editor.ops.groups.language", name: "concat", descKey: "editor.ops.concat", args: 2, input: "fsm" },
  { groupKey: "editor.ops.groups.language", name: "star", descKey: "editor.ops.star", args: 1, input: "fsm" },
  { groupKey: "editor.ops.groups.language", name: "reverse", descKey: "editor.ops.reverse", args: 1, input: "fsm" },

  { groupKey: "editor.ops.groups.conversion", name: "toRegex", descKey: "editor.ops.toRegex", args: 1, input: "fsm" },
  { groupKey: "editor.ops.groups.conversion", name: "toGrammar", descKey: "editor.ops.toGrammar", args: 1, input: "fsm" },
  { groupKey: "editor.ops.groups.conversion", name: "toFsm", descKey: "editor.ops.toFsm", args: 1, input: "grammar" },
  { groupKey: "editor.ops.groups.conversion", name: "toPda", descKey: "editor.ops.toPda", args: 1, input: "grammar" },

  { groupKey: "editor.ops.groups.inspection", name: "equal", descKey: "editor.ops.equal", args: 2, input: "fsm" }
];

const KIND_KEY: Record<string, string> = {
  fsm: "editor.ops.kind.fsm",
  grammar: "editor.ops.kind.grammar",
  regex: "editor.ops.kind.regex",
  verdict: "editor.ops.kind.verdict"
};

/** Human-readable (translation-key based) description of a cell's value kind. */
function describeValue(value: ExprValue): I18nText {
  if (value.kind === "machine") {
    const caps = machineCaps(value);
    if (caps.kind === "fsm") return ux("editor.ops.kind.fsm");
    if (caps.kind === "pda") return ux("editor.ops.kind.pda");
    if (caps.kind === "tm") return ux("editor.ops.kind.tm");
    return ux("editor.ops.kind.generalMachine");
  }
  return ux(KIND_KEY[value.kind] ?? "editor.ops.kind.unknown");
}

export interface Applicability {
  ok: boolean;
  reason?: I18nText;
  /** a working fix chain, e.g. min(complete(det(M))) */
  fixChain?: string;
}

/** Reads from the op's dry-run result why it is not applicable. */
function fromDryRun(r: OpResult<unknown>): Applicability {
  if (r.ok) return { ok: true };
  const firstErr = r.diagnostics.find((d) => d.level === "error");
  return {
    ok: false,
    reason: firstErr?.title,
    fixChain: firstErr?.fix?.code
  };
}

function dryRunFsmOp(op: string, f: FSM): Applicability {
  switch (op) {
    case "det":
      return fromDryRun(determinize(f));
    case "min":
      return fromDryRun(minimize(f));
    case "epsfree":
      return fromDryRun(removeEpsilon(f));
    case "complete":
      return fromDryRun(complete(f));
    case "reachable":
      return fromDryRun(reachable(f));
    case "complement":
      return fromDryRun(complement(f));
    case "intersect":
    case "difference":
      // the product construction's preconditions are tested on the cell's own machine
      return fromDryRun(product(f, f, op));
    case "union": {
      // product for complete DFAs, ε-construction otherwise — always works
      const p = product(f, f, "union");
      return fromDryRun(p.ok ? p : unionEpsilon(f, f));
    }
    case "concat":
      return fromDryRun(concatFSM(f, f));
    case "star":
      return fromDryRun(starFSM(f));
    case "reverse":
      return fromDryRun(reverseFSM(f));
    case "clean":
      return fromDryRun(cleanFSM(f));
    case "toGrammar":
      return fromDryRun(fsmToGrammar(f));
    case "toRegex":
      return fromDryRun(fsmToRegex(f));
    case "equal":
      return fromDryRun(checkEquivalence(f, f));
    default:
      return { ok: true };
  }
}

/**
 * Is the operation applicable to the given cell's value? On an empty cell everything
 * is allowed (a template is inserted); otherwise the actual core algorithm's
 * precondition check decides, so "min with ε-transitions" turns red too.
 */
export function opApplicability(op: OpInfo, value: ExprValue | Definition | null): Applicability {
  if (value === null) return { ok: true };
  const kind = value.kind;
  if (kind === "verdict")
    return { ok: false, reason: ux("editor.ops.reason.notApplicableToVerdict") };

  if (kind === "regex") {
    if (op.name === "toFsm") return { ok: true };
    if (op.input === "grammar")
      return { ok: false, reason: ux("editor.ops.reason.expectsGrammarIsRegex") };
    // automaton operations: tested on the Thompson ε-NFA
    const conv = regexToNFA(value.pattern, value.name);
    if (!conv.ok) return { ok: false, reason: ux("editor.ops.reason.invalidRegex") };
    return dryRunFsmOp(op.name, conv.value!);
  }

  // epsfree on a grammar: ε-rule elimination, the grammar stays a grammar
  if (kind === "grammar" && op.name === "epsfree") return fromDryRun(removeEpsilonRules(value));

  if (op.input === "grammar") {
    if (kind !== "grammar")
      return { ok: false, reason: ux("editor.ops.reason.expectsGrammar", { kindKey: describeValue(value).key }) };
    return fromDryRun(op.name === "toPda" ? grammarToPDA(value) : grammarToFSM(value));
  }

  // op.input === "fsm"
  let fsm: FSM;
  if (kind === "fsm") {
    fsm = value;
  } else if (kind === "grammar") {
    // a right-linear grammar is converted to an automaton automatically
    const conv = grammarToFSM(value);
    if (!conv.ok)
      return { ok: false, reason: ux("editor.ops.reason.expectsFsmNotRightLinear") };
    fsm = conv.value!;
  } else if (kind === "machine") {
    // capability gate: only a storage-free machine behaves as an automaton
    const conv = machineToFSM(value);
    if (!conv)
      return {
        ok: false,
        reason: ux("editor.ops.reason.hasStorage", { types: value.storages.map((s) => s.type).join(", ") })
      };
    fsm = conv;
  } else {
    return { ok: false, reason: ux("editor.ops.reason.expectsFsm", { kindKey: describeValue(value).key }) };
  }
  return dryRunFsmOp(op.name, fsm);
}
