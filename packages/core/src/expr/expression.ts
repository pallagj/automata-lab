import { EPS, err, failResult, okResult, OpResult, AlgoStep, Diagnostic, I18nText, info, tx, warn } from "../types";
import { FSM, makeFSM } from "../fsm/fsm";
import { FSMAnimation } from "../fsm/animation";
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
} from "../fsm/ops";
import { decideDisjointFSM, decideEmptyFSM, decideFiniteFSM } from "../fsm/decide";
import { RegexDef, regexToNFA, regexValue } from "../fsm/regex";
import { fsmToRegex } from "../fsm/toRegex";
import { classify, Grammar, grammarToFSM, grammarToPDA, fsmToGrammar, removeEpsilonRules } from "../grammar/grammar";
import { decideEmptyGrammar, decideFiniteGrammar } from "../grammar/decide";
import { removeUnitRules, removeUselessSymbols, toCNF } from "../grammar/normalForm";
import { fsmToMachine, machineCaps, machineToFSM } from "../machine/machine";
import { pdaToGrammar, toEmptyStack, toFinalState } from "../machine/pda";
import { Definition } from "../parse/definitionParser";
import { canonicalLabel, canonicalName, formatIdent, readIdent, suggestName } from "../symbols";
import { EmptinessVerdict, FinitenessVerdict, Verdict } from "../verdict";

/**
 * Expression language: name = expression
 *   - variables: names of previously defined machines / regexes
 *   - operators between names: concatenation (juxtaposition), + (union),
 *     * (closure), parentheses
 *   - there are NO letter literals — letter sequences only inside regex(...)
 *   - functions: det, min, epsfree, complete, reachable, complement, union,
 *     intersect, difference, concat, star, reverse, clean, toGrammar, toFsm,
 *     toPda, toRegex, regex, equal, unitfree, trim, cnf, toEmptyStack, toFinalState,
 *     empty, finite, disjoint
 */

/** Parse/evaluation errors of the expression language always carry an I18nText. */
class ExprError extends Error {
  constructor(public i18n: I18nText) {
    super(i18n.key);
  }
}

/**
 * FSM appears among the internal values of evaluation (the finite-automaton
 * algorithms work on it), but the final result is always converted to the
 * unified machine model — externally only machine/grammar/regex/verdict exist.
 */
export type ExprValue = Definition | FSM | RegexDef | Verdict;

/**
 * What an operation means, shown before its steps: the texts core:definition.<id>.* —
 * what it does, its input, its output and the guarantee about the language — with the
 * arguments as written ({{a}}, {{b}}) and the operation itself ({{op}}).
 */
export interface OpDefinition {
  id: DefinitionId;
  args: string[];
}

export interface StepGroup {
  operation: string;
  definition?: OpDefinition;
  steps: AlgoStep[];
  animation?: FSMAnimation;
}

export interface EvalOutput {
  value: ExprValue;
  diagnostics: Diagnostic[];
  stepGroups: StepGroup[];
}

export const FUNCTION_NAMES = [
  "det",
  "min",
  "epsfree",
  "complete",
  "reachable",
  "complement",
  "union",
  "intersect",
  "difference",
  "concat",
  "star",
  "reverse",
  "clean",
  "toGrammar",
  "toFsm",
  "toPda",
  "toRegex",
  "regex",
  "equal",
  "unitfree",
  "trim",
  "cnf",
  "toEmptyStack",
  "toFinalState",
  "empty",
  "finite",
  "disjoint"
] as const;

type FuncName = (typeof FUNCTION_NAMES)[number];

/** Every operation with a definition; an operation done in two ways has one for each. */
export const DEFINITION_IDS = [
  "det",
  "min",
  "epsfree.fsm",
  "epsfree.grammar",
  "complete",
  "reachable",
  "complement",
  "union.product",
  "union.epsilon",
  "intersect",
  "difference",
  "concat",
  "star",
  "reverse",
  "clean",
  "toGrammar.fsm",
  "toGrammar.pda",
  "toFsm.regex",
  "toFsm.grammar",
  "toRegex",
  "toPda",
  "unitfree",
  "trim",
  "cnf",
  "toEmptyStack",
  "toFinalState",
  "equal",
  "empty",
  "finite",
  "disjoint"
] as const;

export type DefinitionId = (typeof DEFINITION_IDS)[number];

/* --------------------------- AST --------------------------- */

type Expr =
  | { t: "var"; name: string }
  | { t: "lit"; c: string }
  | { t: "concat"; items: Expr[] }
  | { t: "union"; items: Expr[] }
  | { t: "star"; inner: Expr }
  | { t: "call"; fn: FuncName; args: Expr[]; rawArgs: string[] };

/** An expression written back as text, with the parentheses its operators need. */
function exprText(e: Expr): string {
  switch (e.t) {
    case "var":
      return e.name;
    case "lit":
      return e.c;
    case "call":
      return `${e.fn}(${e.rawArgs.join(", ")})`;
    case "union":
      return e.items.map(exprText).join(" + ");
    case "concat":
      return e.items.map((x) => (x.t === "union" ? `(${exprText(x)})` : exprText(x))).join(" ");
    case "star":
      return e.inner.t === "union" || e.inner.t === "concat" ? `(${exprText(e.inner)})*` : `${exprText(e.inner)}*`;
  }
}

/** The first `n` operands of a concatenation or union, as text. */
function operandsText(e: Extract<Expr, { t: "union" | "concat" }>, n: number): string {
  return n === 1 ? exprText(e.items[0]) : exprText({ ...e, items: e.items.slice(0, n) });
}

/* --------------------------- Parser --------------------------- */

class ExprParser {
  pos = 0;
  constructor(
    public src: string,
    public knownNames: Set<string>
  ) {}

  error(x: I18nText): never {
    throw new ExprError(x);
  }

  peek(): string | undefined {
    return this.src[this.pos];
  }

  skipWs() {
    while (this.pos < this.src.length && /\s/.test(this.src[this.pos])) this.pos++;
  }

  parse(): Expr {
    const e = this.parseUnion();
    this.skipWs();
    if (this.pos < this.src.length)
      this.error(tx("expression.error.unexpectedChar", { char: this.peek() ?? "", pos: this.pos + 1 }));
    return e;
  }

  parseUnion(): Expr {
    const items = [this.parseConcat()];
    while (true) {
      this.skipWs();
      if (this.peek() === "+" || this.peek() === "|") {
        this.pos++;
        items.push(this.parseConcat());
      } else break;
    }
    return items.length === 1 ? items[0] : { t: "union", items };
  }

  parseConcat(): Expr {
    const items: Expr[] = [];
    while (true) {
      this.skipWs();
      const c = this.peek();
      if (c === undefined || c === ")" || c === "+" || c === "|" || c === ",") break;
      items.push(this.parsePostfix());
    }
    if (items.length === 0) this.error(tx("expression.error.missingExpression", { pos: this.pos + 1 }));
    return items.length === 1 ? items[0] : { t: "concat", items };
  }

  parsePostfix(): Expr {
    let e = this.parseAtom();
    while (true) {
      this.skipWs();
      if (this.peek() === "*") {
        this.pos++;
        e = { t: "star", inner: e };
      } else break;
    }
    return e;
  }

  parseAtom(): Expr {
    this.skipWs();
    const c = this.peek();
    if (c === undefined) this.error(tx("expression.error.unexpectedEnd", { pos: this.pos + 1 }));
    if (c === "(") {
      this.pos++;
      const e = this.parseUnion();
      this.skipWs();
      if (this.peek() !== ")") this.error(tx("expression.error.missingCloseParen", { pos: this.pos + 1 }));
      this.pos++;
      return e;
    }
    if (/\p{L}/u.test(c)) {
      const fn = functionAt(this.src, this.pos);
      if (fn) {
        this.pos += fn.length;
        this.skipWs();
        if (this.peek() === "(") return this.parseCall(fn);
        this.error(tx("expression.error.functionNeedsParen", { word: fn, pos: this.pos + 1 }));
      }
      // a name: one letter with its primes and subscript — so AB is A concatenated with B
      const start = this.pos;
      const r = readIdent(this.src, this.pos, true);
      if (r) {
        const name = formatIdent(r.ident);
        if (this.knownNames.has(name)) {
          this.pos = r.end;
          return { t: "var", name };
        }
        // an unknown word of several letters is most likely a name written the old way
        const word = /^[\p{L}\p{N}]+/u.exec(this.src.slice(start))![0];
        if ([...word].length > 1 && r.ident.sub === "")
          this.error(tx("expression.error.multiLetterName", { word, suggestion: suggestName(word), pos: start + 1 }));
        this.error(tx("expression.error.unknownName", { word: name, pos: start + 1 }));
      }
    }
    this.error(tx("expression.error.unparseableChar", { char: c, pos: this.pos + 1 }));
  }

  /** A call of `fn`, with the position at its "(". */
  parseCall(fn: FuncName): Expr {
    this.pos++; // (
    const args: Expr[] = [];
    const rawArgs: string[] = [];
    if (fn === "regex") {
      // the regex body is read raw up to the closing parenthesis
      let depth = 1;
      const start = this.pos;
      while (this.pos < this.src.length && depth > 0) {
        if (this.src[this.pos] === "(") depth++;
        if (this.src[this.pos] === ")") depth--;
        if (depth > 0) this.pos++;
      }
      if (depth !== 0) this.error(tx("expression.error.missingCloseParenRegex", { pos: this.pos + 1 }));
      rawArgs.push(this.src.slice(start, this.pos).trim());
      args.push({ t: "lit", c: EPS }); // placeholder, evaluation uses rawArgs
      this.pos++; // ')'
      return { t: "call", fn, args, rawArgs };
    }
    this.skipWs();
    if (this.peek() === ")") {
      this.pos++;
      return { t: "call", fn, args, rawArgs };
    }
    while (true) {
      const argStart = this.pos;
      // the second argument of complete() is a state name: also kept as raw text
      const arg = fn === "complete" && args.length === 1 ? this.rawArgument() : this.parseUnion();
      rawArgs.push(this.src.slice(argStart, this.pos).trim());
      args.push(arg);
      this.skipWs();
      if (this.peek() === ",") {
        this.pos++;
        continue;
      }
      if (this.peek() === ")") {
        this.pos++;
        break;
      }
      this.error(tx("expression.error.missingCommaOrParen", { pos: this.pos + 1 }));
    }
    return { t: "call", fn, args, rawArgs };
  }

  /** Raw text up to the next top-level "," or ")" (a state name is a free label). */
  rawArgument(): Expr {
    while (this.pos < this.src.length && this.src[this.pos] !== "," && this.src[this.pos] !== ")") this.pos++;
    return { t: "lit", c: EPS };
  }
}

/** The texts in a regex pattern that read as worksheet names (M, R1 = R_1), each once. */
function namesInPattern(pattern: string, names: Set<string>): string[] {
  const found: string[] = [];
  for (let i = 0; i < pattern.length; ) {
    const r = /\p{L}/u.test(pattern[i]) ? readIdent(pattern, i, true) : null;
    if (!r) {
      i++;
      continue;
    }
    const text = pattern.slice(i, r.end);
    if (names.has(formatIdent(r.ident)) && !found.includes(text)) found.push(text);
    i = r.end;
  }
  return found;
}

/** The function name at `pos`, when one starts there (as a whole word). */
function functionAt(src: string, pos: number): FuncName | null {
  for (const fn of FUNCTIONS_LONGEST_FIRST) {
    if (src.startsWith(fn, pos) && !/[\p{L}\p{N}_]/u.test(src[pos + fn.length] ?? "")) return fn;
  }
  return null;
}
const FUNCTIONS_LONGEST_FIRST = [...FUNCTION_NAMES].sort((a, b) => b.length - a.length);

/** Names referenced in an expression (for evaluation order). */
export function collectDependencies(src: string, knownNames: Set<string>): Set<string> {
  const deps = new Set<string>();
  for (let pos = 0; pos < src.length; ) {
    const fn = /\p{L}/u.test(src[pos]) ? functionAt(src, pos) : null;
    if (fn === "regex") {
      // a regex is a pattern of letters, not names: skip its body
      let depth = 0;
      pos += fn.length;
      while (pos < src.length) {
        if (src[pos] === "(") depth++;
        if (src[pos] === ")" && --depth === 0) break;
        pos++;
      }
      pos++;
      continue;
    }
    if (fn) {
      pos += fn.length;
      continue;
    }
    const r = /\p{L}/u.test(src[pos]) ? readIdent(src, pos, true) : null;
    if (r) {
      const name = formatIdent(r.ident);
      if (knownNames.has(name)) deps.add(name);
      pos = r.end;
      continue;
    }
    pos++;
  }
  return deps;
}

/* --------------------------- Evaluation ---------------------------- */

class Evaluator {
  diagnostics: Diagnostic[] = [];
  stepGroups: StepGroup[] = [];

  /** `names`: every name in the worksheet, also the ones not evaluated yet */
  constructor(
    public env: Map<string, ExprValue>,
    private names: Set<string> = new Set(env.keys())
  ) {}

  take<T>(operation: string, r: OpResult<T>, definition?: OpDefinition): T {
    this.diagnostics.push(...r.diagnostics);
    // an operation that had nothing to do still says what it means
    if (r.steps.length > 0 || (r.ok && definition))
      this.stepGroups.push({ operation, definition, steps: r.steps, animation: r.animation });
    if (!r.ok) throw new EvalDiagError(r.diagnostics);
    return r.value!;
  }

  asFSM(v: ExprValue, ctxOpId: string): FSM {
    if (v.kind === "fsm") return v;
    if (v.kind === "regex") {
      // convenience auto-conversion: regex → ε-NFA (lecture notes 3.20)
      this.diagnostics.push(
        info(
          tx("expression.autoConvert.regex.title", { name: v.name }),
          tx("expression.autoConvert.regex.detail", { name: v.name })
        )
      );
      return this.take(`toFsm(${v.name})`, regexToNFA(v.pattern, v.name), { id: "toFsm.regex", args: [v.name] });
    }
    if (v.kind === "grammar") {
      // convenience auto-conversion for type-3 grammars
      const r = grammarToFSM(v);
      if (r.ok) {
        this.diagnostics.push(
          info(tx("expression.autoConvert.grammar.title", { name: v.name }), tx("expression.autoConvert.grammar.detail"))
        );
        return this.take(`toFsm(${v.name})`, r, { id: "toFsm.grammar", args: [v.name] });
      }
    }
    if (v.kind === "machine") {
      // capability gate: a storage-free machine is itself the finite automaton
      const f = machineToFSM(v);
      if (f) return f;
      throw new ExprError(
        tx("expression.error.machineNeedsFsm", {
          ctxKey: `opNames.${ctxOpId}`,
          name: v.name,
          machineKindKey: `machineKind.${machineCaps(v).kind}`,
          storages: v.storages.map((s) => `${s.id}: ${s.type}`).join(", ")
        })
      );
    }
    throw new ExprError(tx("expression.error.needsFsm", { ctxKey: `opNames.${ctxOpId}`, kindKey: describeKind(v) }));
  }

  evaluate(e: Expr): ExprValue {
    switch (e.t) {
      case "var": {
        const v = this.env.get(e.name);
        if (v === undefined) throw new ExprError(tx("expression.eval.unknownName", { name: e.name }));
        return v;
      }
      case "lit":
        // can only be regex()'s internal placeholder — never evaluated directly
        throw new ExprError(tx("expression.eval.literalsOnlyInRegex"));
      case "concat": {
        let acc = this.asFSM(this.evaluate(e.items[0]), "concat");
        for (let i = 1; i < e.items.length; i++) {
          const next = this.asFSM(this.evaluate(e.items[i]), "concat");
          const args = [operandsText(e, i), exprText(e.items[i])];
          acc = this.take(operandsText(e, i + 1), concatFSM(acc, next), { id: "concat", args });
        }
        return acc;
      }
      case "union": {
        let acc = this.asFSM(this.evaluate(e.items[0]), "union");
        for (let i = 1; i < e.items.length; i++) {
          const next = this.asFSM(this.evaluate(e.items[i]), "union");
          const args = [operandsText(e, i), exprText(e.items[i])];
          acc = this.take(operandsText(e, i + 1), unionEpsilon(acc, next), { id: "union.epsilon", args });
        }
        return acc;
      }
      case "star":
        return this.take(exprText(e), starFSM(this.asFSM(this.evaluate(e.inner), "star")), {
          id: "star",
          args: [exprText(e.inner)]
        });
      case "call":
        return this.call(e);
    }
  }

  call(e: Extract<Expr, { t: "call" }>): ExprValue {
    const expectArgs = (n: number, alsoOk?: number) => {
      if (e.args.length !== n && e.args.length !== alsoOk)
        throw new ExprError(
          alsoOk !== undefined
            ? tx("expression.error.wrongArgCount.range", { fn: e.fn, n, alsoOk, count: e.args.length })
            : tx("expression.error.wrongArgCount.exact", { fn: e.fn, n, count: e.args.length })
        );
    };
    const fsmArg = (i: number) => this.asFSM(this.evaluate(e.args[i]), e.fn);
    const grammarArg = (i: number): Grammar => {
      const v = this.evaluate(e.args[i]);
      if (v.kind !== "grammar")
        throw new ExprError(tx("expression.error.needsGrammar", { opKey: `opNames.${e.fn}`, kindKey: describeKind(v) }));
      return v;
    };
    const label = (base: string) => `${base}(${e.rawArgs.join(", ")})`;
    // the definition shown before the steps, with the arguments as written
    const def = (id: DefinitionId): OpDefinition => ({ id, args: e.rawArgs });
    // what a verdict calls an argument: its name, or the argument as written
    const argName = (i: number) => {
      const a = e.args[i];
      return a.t === "var" ? a.name : e.rawArgs[i];
    };

    switch (e.fn) {
      case "det":
        expectArgs(1);
        return this.take(label("det"), determinize(fsmArg(0)), def("det"));
      case "min":
        expectArgs(1);
        return this.take(label("min"), minimize(fsmArg(0)), def("min"));
      case "epsfree": {
        expectArgs(1);
        // a grammar keeps being a grammar: ε-rule elimination instead of ε-transition removal
        const v = this.evaluate(e.args[0]);
        if (v.kind === "grammar") return this.take(label("epsfree"), removeEpsilonRules(v), def("epsfree.grammar"));
        return this.take(label("epsfree"), removeEpsilon(this.asFSM(v, "epsfree")), def("epsfree.fsm"));
      }
      case "complete":
        expectArgs(1, 2);
        return this.take(
          label("complete"),
          complete(fsmArg(0), e.args.length > 1 ? canonicalLabel(e.rawArgs[1]) : undefined),
          def("complete")
        );
      case "reachable":
        expectArgs(1);
        return this.take(label("reachable"), reachable(fsmArg(0)), def("reachable"));
      case "complement":
        expectArgs(1);
        return this.take(label("complement"), complement(fsmArg(0)), def("complement"));
      case "union":
      case "intersect":
      case "difference": {
        expectArgs(2);
        const a = fsmArg(0);
        const b = fsmArg(1);
        if (e.fn === "union") {
          // product for complete DFAs, ε-construction otherwise
          const r = product(a, b, "union");
          if (r.ok) return this.take(label("union"), r, def("union.product"));
          return this.take(label("union"), unionEpsilon(a, b), def("union.epsilon"));
        }
        return this.take(label(e.fn), product(a, b, e.fn), def(e.fn));
      }
      case "concat":
        expectArgs(2);
        return this.take(label("concat"), concatFSM(fsmArg(0), fsmArg(1)), def("concat"));
      case "star":
        expectArgs(1);
        return this.take(label("star"), starFSM(fsmArg(0)), def("star"));
      case "reverse":
        expectArgs(1);
        return this.take(label("reverse"), reverseFSM(fsmArg(0)), def("reverse"));
      case "clean":
        expectArgs(1);
        return this.take(label("clean"), cleanFSM(fsmArg(0)), def("clean"));
      case "toGrammar": {
        expectArgs(1);
        // a machine with a stack: the grammar of the pushdown automaton (7.16)
        const v = this.evaluate(e.args[0]);
        if (v.kind === "machine" && !machineCaps(v).isFSMLike) return this.take(label("toGrammar"), pdaToGrammar(v), def("toGrammar.pda"));
        return this.take(label("toGrammar"), fsmToGrammar(this.asFSM(v, "toGrammar")), def("toGrammar.fsm"));
      }
      case "toEmptyStack":
      case "toFinalState": {
        expectArgs(1);
        const v = this.evaluate(e.args[0]);
        if (v.kind !== "machine")
          throw new ExprError(tx("expression.error.needsPda", { opKey: `opNames.${e.fn}`, kindKey: describeKind(v) }));
        return this.take(label(e.fn), e.fn === "toEmptyStack" ? toEmptyStack(v) : toFinalState(v), def(e.fn));
      }
      case "toFsm": {
        expectArgs(1);
        const v = this.evaluate(e.args[0]);
        if (v.kind === "regex") return this.take(label("toFsm"), regexToNFA(v.pattern, v.name), def("toFsm.regex"));
        if (v.kind === "machine") {
          const f = machineToFSM(v);
          if (f) return f;
          throw new ExprError(
            tx("expression.error.machineHasStorage", { name: v.name, storages: v.storages.map((s) => s.type).join(", ") })
          );
        }
        if (v.kind !== "grammar") throw new ExprError(tx("expression.error.toFsmExpects"));
        return this.take(label("toFsm"), grammarToFSM(v), def("toFsm.grammar"));
      }
      case "toRegex":
        expectArgs(1);
        return this.take(label("toRegex"), fsmToRegex(fsmArg(0)), def("toRegex"));
      case "toPda": {
        expectArgs(1);
        const v = this.evaluate(e.args[0]);
        if (v.kind !== "grammar") throw new ExprError(tx("expression.error.toPdaExpects"));
        return this.take(label("toPda"), grammarToPDA(v), def("toPda"));
      }
      case "regex": {
        expectArgs(1);
        // a regex is a self-contained pattern: a name inside it is just letters — say so, since it looks like a reference
        const pattern = e.rawArgs[0];
        const named = namesInPattern(pattern, this.names);
        if (named.length > 0)
          this.diagnostics.push(
            warn(
              tx("expression.regexNameInside.title", { names: named.join(", ") }),
              tx("expression.regexNameInside.detail", { name: named[0], letters: [...named[0]].join(", ") })
            )
          );
        return this.take(label("regex"), regexValue(pattern));
      }
      case "unitfree":
        expectArgs(1);
        return this.take(label("unitfree"), removeUnitRules(grammarArg(0)), def("unitfree"));
      case "trim":
        expectArgs(1);
        return this.take(label("trim"), removeUselessSymbols(grammarArg(0)), def("trim"));
      case "cnf":
        expectArgs(1);
        return this.take(label("cnf"), toCNF(grammarArg(0)), def("cnf"));
      case "equal": {
        expectArgs(2);
        return this.take(label("equal"), checkEquivalence(fsmArg(0), fsmArg(1)), def("equal"));
      }
      case "empty":
      case "finite": {
        expectArgs(1);
        return this.decideLanguage(e.fn, this.evaluate(e.args[0]), argName(0), label(e.fn), def(e.fn));
      }
      case "disjoint": {
        expectArgs(2);
        const r = this.take(label("disjoint"), decideDisjointFSM(fsmArg(0), fsmArg(1)), def("disjoint"));
        return { ...r, machineA: argName(0), machineB: argName(1) };
      }
    }
  }

  /**
   * Emptiness or finiteness of a language: an automaton (a regular expression or a regular
   * grammar as its automaton) by chapter 5, a context-free grammar — or a pushdown automaton
   * as its grammar (7.16) — by chapter 8. For a Turing machine or a grammar of type 0 or 1
   * no algorithm decides either question in general.
   */
  decideLanguage(
    fn: "empty" | "finite",
    value: ExprValue,
    name: string,
    stepLabel: string,
    definition: OpDefinition
  ): EmptinessVerdict | FinitenessVerdict {
    let v = value;
    if (v.kind === "machine" && machineCaps(v).isPDALike)
      v = this.take(`toGrammar(${name})`, pdaToGrammar(v), { id: "toGrammar.pda", args: [name] });
    if (v.kind === "machine" && !machineCaps(v).isFSMLike)
      throw new ExprError(
        tx("expression.error.undecidableMachine", { opKey: `opNames.${fn}`, name, machineKindKey: `machineKind.${machineCaps(v).kind}` })
      );
    if (v.kind === "grammar" && !classify(v).rightLinear) {
      if (!classify(v).contextFreeForm)
        throw new ExprError(tx("expression.error.undecidableGrammar", { opKey: `opNames.${fn}`, name }));
      const r: OpResult<EmptinessVerdict | FinitenessVerdict> = fn === "empty" ? decideEmptyGrammar(v) : decideFiniteGrammar(v);
      return { ...this.take(stepLabel, r, definition), subject: name };
    }
    const f = this.asFSM(v, fn);
    const r: OpResult<EmptinessVerdict | FinitenessVerdict> = fn === "empty" ? decideEmptyFSM(f) : decideFiniteFSM(f);
    return { ...this.take(stepLabel, r, definition), subject: name };
  }
}

class EvalDiagError extends Error {
  constructor(public diags: Diagnostic[]) {
    super(diags[0]?.title.key ?? "error");
  }
}

function describeKind(v: ExprValue): string {
  switch (v.kind) {
    case "fsm":
      return "expression.kind.fsm";
    case "machine":
      return `machineKind.${machineCaps(v).kind}`;
    case "grammar":
      return "expression.kind.grammar";
    case "regex":
      return "expression.kind.regex";
    case "verdict":
      return "expression.kind.verdict";
  }
}

/** Evaluates an expression against the names defined so far. */
export function evaluateExpression(
  src: string,
  env: Map<string, ExprValue>,
  names: Set<string> = new Set(env.keys())
): OpResult<EvalOutput> {
  const known = new Set(env.keys());
  let ast: Expr;
  try {
    ast = new ExprParser(src, known).parse();
  } catch (e) {
    const i18n = e instanceof ExprError ? e.i18n : tx("expression.error.parseGeneric", { message: String((e as Error).message ?? e) });
    return failResult([err(tx("expression.error.invalidExpression"), i18n)]);
  }
  const ev = new Evaluator(env, names);
  try {
    let value = ev.evaluate(ast);
    // the final result appears in the unified machine model
    if (value.kind === "fsm") value = fsmToMachine(value);
    return okResult({ value, diagnostics: ev.diagnostics, stepGroups: ev.stepGroups }, ev.diagnostics);
  } catch (e) {
    if (e instanceof EvalDiagError) {
      return { ok: false, diagnostics: ev.diagnostics, steps: [] };
    }
    const i18n = e instanceof ExprError ? e.i18n : tx("expression.error.evalGeneric", { message: String((e as Error).message ?? e) });
    return failResult([err(tx("expression.error.evaluationError"), i18n)], []);
  }
}

/** Splits "name = expression". */
export function splitAssignment(source: string): { name: string | null; rawName: string; expr: string } | null {
  const m = /^\s*([^\s=(),]+)\s*=\s*([\s\S]+)$/.exec(source.trim());
  if (!m) return null;
  // name: the canonical form (M1 → M_1), null when the left side is not a name
  return { name: canonicalName(m[1]), rawName: m[1], expr: m[2].trim() };
}
