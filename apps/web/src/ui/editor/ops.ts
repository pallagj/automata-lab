/**
 * Expression-language operations for the cell operation menu: description, group,
 * arity and an exact applicability check (a dry run of the core algorithms, so it
 * always agrees with the actual evaluation).
 */
import { Definition } from "@automatalab/core/parse/definitionParser";
import { FSM } from "@automatalab/core/fsm/fsm";
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
} from "@automatalab/core/fsm/ops";
import { regexToNFA } from "@automatalab/core/fsm/regex";
import { fsmToRegex } from "@automatalab/core/fsm/toRegex";
import { classify, fsmToGrammar, Grammar, grammarToFSM, grammarToPDA, removeEpsilonRules } from "@automatalab/core/grammar/grammar";
import { removeUnitRules, removeUselessSymbols, toCNF } from "@automatalab/core/grammar/normalForm";
import { machineCaps, machineToFSM } from "@automatalab/core/machine/machine";
import { pdaToGrammar, toEmptyStack, toFinalState } from "@automatalab/core/machine/pda";
import { I18nText, OpResult } from "@automatalab/core/types";
import { ExprValue } from "@automatalab/core/expr/expression";

/** I18nText constructor for this file's own (ui-namespace) strings. */
function ux(key: string, params?: Record<string, string | number>): I18nText {
  return { key, params, ns: "ui" };
}

export interface OpInfo {
  name: string;
  descKey: string;
  args: 1 | 2;
  /** which kind of value it applies to — "language": anything with a regular or context-free language */
  input: "fsm" | "grammar" | "pda" | "language";
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

  { groupKey: "editor.ops.groups.grammar", name: "unitfree", descKey: "editor.ops.unitfree", args: 1, input: "grammar" },
  { groupKey: "editor.ops.groups.grammar", name: "trim", descKey: "editor.ops.trim", args: 1, input: "grammar" },
  { groupKey: "editor.ops.groups.grammar", name: "cnf", descKey: "editor.ops.cnf", args: 1, input: "grammar" },

  { groupKey: "editor.ops.groups.conversion", name: "toRegex", descKey: "editor.ops.toRegex", args: 1, input: "fsm" },
  { groupKey: "editor.ops.groups.conversion", name: "toGrammar", descKey: "editor.ops.toGrammar", args: 1, input: "fsm" },
  { groupKey: "editor.ops.groups.conversion", name: "toFsm", descKey: "editor.ops.toFsm", args: 1, input: "grammar" },
  { groupKey: "editor.ops.groups.conversion", name: "toPda", descKey: "editor.ops.toPda", args: 1, input: "grammar" },
  { groupKey: "editor.ops.groups.conversion", name: "toEmptyStack", descKey: "editor.ops.toEmptyStack", args: 1, input: "pda" },
  { groupKey: "editor.ops.groups.conversion", name: "toFinalState", descKey: "editor.ops.toFinalState", args: 1, input: "pda" },

  { groupKey: "editor.ops.groups.inspection", name: "equal", descKey: "editor.ops.equal", args: 2, input: "fsm" },
  { groupKey: "editor.ops.groups.inspection", name: "empty", descKey: "editor.ops.empty", args: 1, input: "language" },
  { groupKey: "editor.ops.groups.inspection", name: "finite", descKey: "editor.ops.finite", args: 1, input: "language" },
  { groupKey: "editor.ops.groups.inspection", name: "disjoint", descKey: "editor.ops.disjoint", args: 2, input: "fsm" }
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

function dryRunGrammarOp(op: string, g: Grammar): OpResult<unknown> {
  switch (op) {
    case "toPda":
      return grammarToPDA(g);
    case "unitfree":
      return removeUnitRules(g);
    case "trim":
      return removeUselessSymbols(g);
    case "cnf":
      return toCNF(g);
    default:
      return grammarToFSM(g);
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

  // emptiness and finiteness: decided for the regular and the context-free languages
  if (op.input === "language") {
    if (kind === "regex")
      return regexToNFA(value.pattern, value.name).ok ? { ok: true } : { ok: false, reason: ux("editor.ops.reason.invalidRegex") };
    if (kind === "grammar")
      return classify(value).contextFreeForm ? { ok: true } : { ok: false, reason: ux("editor.ops.reason.undecidableGrammar") };
    if (kind === "machine" && machineCaps(value).isPDALike) return fromDryRun(pdaToGrammar(value));
    if (kind === "machine" && !machineCaps(value).isFSMLike)
      return { ok: false, reason: ux("editor.ops.reason.undecidableMachine", { kindKey: describeValue(value).key }) };
    return { ok: true };
  }

  if (kind === "regex") {
    if (op.name === "toFsm") return { ok: true };
    if (op.input === "grammar")
      return { ok: false, reason: ux("editor.ops.reason.expectsGrammarIsRegex") };
    // automaton operations: tested on the expression's ε-NFA (lecture notes 3.20)
    const conv = regexToNFA(value.pattern, value.name);
    if (!conv.ok) return { ok: false, reason: ux("editor.ops.reason.invalidRegex") };
    return dryRunFsmOp(op.name, conv.value!);
  }

  // epsfree on a grammar: ε-rule elimination, the grammar stays a grammar
  if (kind === "grammar" && op.name === "epsfree") return fromDryRun(removeEpsilonRules(value));

  // a pushdown automaton: its grammar (7.16), the other way of accepting (7.9)
  if (kind === "machine" && machineCaps(value).isPDALike) {
    if (op.name === "toGrammar") return fromDryRun(pdaToGrammar(value));
    if (op.name === "toEmptyStack") return fromDryRun(toEmptyStack(value));
    if (op.name === "toFinalState") return fromDryRun(toFinalState(value));
  }
  if (op.input === "pda")
    return { ok: false, reason: ux("editor.ops.reason.expectsPda", { kindKey: describeValue(value).key }) };

  if (op.input === "grammar") {
    if (kind !== "grammar")
      return { ok: false, reason: ux("editor.ops.reason.expectsGrammar", { kindKey: describeValue(value).key }) };
    return fromDryRun(dryRunGrammarOp(op.name, value));
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
