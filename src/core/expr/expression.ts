import { EPS, err, failResult, okResult, OpResult, AlgoStep, Diagnostic, I18nText, info, tx, warn } from "../types";
import { FSM, makeFSM } from "../fsm/fsm";
import {
  checkEquivalence,
  cleanFSM,
  complement,
  complete,
  concatFSM,
  determinize,
  EquivalenceVerdict,
  minimize,
  product,
  reachable,
  removeEpsilon,
  reverseFSM,
  starFSM,
  unionEpsilon
} from "../fsm/ops";
import { RegexDef, regexToNFA, regexValue } from "../fsm/regex";
import { fsmToRegex } from "../fsm/toRegex";
import { Grammar, grammarToFSM, grammarToPDA, fsmToGrammar, removeEpsilonRules } from "../grammar/grammar";
import { removeUnitRules, removeUselessSymbols, toCNF } from "../grammar/normalForm";
import { fsmToMachine, machineCaps, machineToFSM } from "../machine/machine";
import { pdaToGrammar, toEmptyStack, toFinalState } from "../machine/pda";
import { Definition } from "../parse/definitionParser";
import { canonicalLabel, canonicalName, formatIdent, readIdent, suggestName } from "../symbols";

/**
 * Expression language: name = expression
 *   - variables: names of previously defined machines / regexes
 *   - operators between names: concatenation (juxtaposition), + (union),
 *     * (closure), parentheses
 *   - there are NO letter literals — letter sequences only inside regex(...)
 *   - functions: det, min, epsfree, complete, reachable, complement, union,
 *     intersect, difference, concat, star, reverse, clean, toGrammar, toFsm,
 *     toPda, toRegex, regex, equal, unitfree, trim, cnf, toEmptyStack, toFinalState
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
export type ExprValue = Definition | FSM | RegexDef | EquivalenceVerdict;

export interface StepGroup {
  operation: string;
  steps: AlgoStep[];
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
  "toFinalState"
] as const;

type FuncName = (typeof FUNCTION_NAMES)[number];

/* --------------------------- AST --------------------------- */

type Expr =
  | { t: "var"; name: string }
  | { t: "lit"; c: string }
  | { t: "concat"; items: Expr[] }
  | { t: "union"; items: Expr[] }
  | { t: "star"; inner: Expr }
  | { t: "call"; fn: FuncName; args: Expr[]; rawArgs: string[] };

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

  take<T>(operation: string, r: OpResult<T>): T {
    this.diagnostics.push(...r.diagnostics);
    if (r.steps.length > 0) this.stepGroups.push({ operation, steps: r.steps });
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
      return this.take(`toFsm(${v.name})`, regexToNFA(v.pattern, v.name));
    }
    if (v.kind === "grammar") {
      // convenience auto-conversion for type-3 grammars
      const r = grammarToFSM(v);
      if (r.ok) {
        this.diagnostics.push(
          info(tx("expression.autoConvert.grammar.title", { name: v.name }), tx("expression.autoConvert.grammar.detail"))
        );
        return this.take(`toFsm(${v.name})`, r);
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
          acc = this.take(`concat`, concatFSM(acc, next));
        }
        return acc;
      }
      case "union": {
        let acc = this.asFSM(this.evaluate(e.items[0]), "union");
        for (let i = 1; i < e.items.length; i++) {
          const next = this.asFSM(this.evaluate(e.items[i]), "union");
          acc = this.take(`union`, unionEpsilon(acc, next));
        }
        return acc;
      }
      case "star":
        return this.take("star", starFSM(this.asFSM(this.evaluate(e.inner), "star")));
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

    switch (e.fn) {
      case "det":
        expectArgs(1);
        return this.take(label("det"), determinize(fsmArg(0)));
      case "min":
        expectArgs(1);
        return this.take(label("min"), minimize(fsmArg(0)));
      case "epsfree": {
        expectArgs(1);
        // a grammar keeps being a grammar: ε-rule elimination instead of ε-transition removal
        const v = this.evaluate(e.args[0]);
        if (v.kind === "grammar") return this.take(label("epsfree"), removeEpsilonRules(v));
        return this.take(label("epsfree"), removeEpsilon(this.asFSM(v, "epsfree")));
      }
      case "complete":
        expectArgs(1, 2);
        return this.take(label("complete"), complete(fsmArg(0), e.args.length > 1 ? canonicalLabel(e.rawArgs[1]) : undefined));
      case "reachable":
        expectArgs(1);
        return this.take(label("reachable"), reachable(fsmArg(0)));
      case "complement":
        expectArgs(1);
        return this.take(label("complement"), complement(fsmArg(0)));
      case "union":
      case "intersect":
      case "difference": {
        expectArgs(2);
        const a = fsmArg(0);
        const b = fsmArg(1);
        if (e.fn === "union") {
          // product for complete DFAs, ε-construction otherwise
          const r = product(a, b, "union");
          if (r.ok) return this.take(label("union"), r);
          return this.take(label("union"), unionEpsilon(a, b));
        }
        return this.take(label(e.fn), product(a, b, e.fn));
      }
      case "concat":
        expectArgs(2);
        return this.take(label("concat"), concatFSM(fsmArg(0), fsmArg(1)));
      case "star":
        expectArgs(1);
        return this.take(label("star"), starFSM(fsmArg(0)));
      case "reverse":
        expectArgs(1);
        return this.take(label("reverse"), reverseFSM(fsmArg(0)));
      case "clean":
        expectArgs(1);
        return this.take(label("clean"), cleanFSM(fsmArg(0)));
      case "toGrammar": {
        expectArgs(1);
        // a machine with a stack: the grammar of the pushdown automaton (7.16)
        const v = this.evaluate(e.args[0]);
        if (v.kind === "machine" && !machineCaps(v).isFSMLike) return this.take(label("toGrammar"), pdaToGrammar(v));
        return this.take(label("toGrammar"), fsmToGrammar(this.asFSM(v, "toGrammar")));
      }
      case "toEmptyStack":
      case "toFinalState": {
        expectArgs(1);
        const v = this.evaluate(e.args[0]);
        if (v.kind !== "machine")
          throw new ExprError(tx("expression.error.needsPda", { opKey: `opNames.${e.fn}`, kindKey: describeKind(v) }));
        return this.take(label(e.fn), e.fn === "toEmptyStack" ? toEmptyStack(v) : toFinalState(v));
      }
      case "toFsm": {
        expectArgs(1);
        const v = this.evaluate(e.args[0]);
        if (v.kind === "regex") return this.take(label("toFsm"), regexToNFA(v.pattern, v.name));
        if (v.kind === "machine") {
          const f = machineToFSM(v);
          if (f) return f;
          throw new ExprError(
            tx("expression.error.machineHasStorage", { name: v.name, storages: v.storages.map((s) => s.type).join(", ") })
          );
        }
        if (v.kind !== "grammar") throw new ExprError(tx("expression.error.toFsmExpects"));
        return this.take(label("toFsm"), grammarToFSM(v));
      }
      case "toRegex":
        expectArgs(1);
        return this.take(label("toRegex"), fsmToRegex(fsmArg(0)));
      case "toPda": {
        expectArgs(1);
        const v = this.evaluate(e.args[0]);
        if (v.kind !== "grammar") throw new ExprError(tx("expression.error.toPdaExpects"));
        return this.take(label("toPda"), grammarToPDA(v));
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
        return this.take(label("unitfree"), removeUnitRules(grammarArg(0)));
      case "trim":
        expectArgs(1);
        return this.take(label("trim"), removeUselessSymbols(grammarArg(0)));
      case "cnf":
        expectArgs(1);
        return this.take(label("cnf"), toCNF(grammarArg(0)));
      case "equal": {
        expectArgs(2);
        return this.take(label("equal"), checkEquivalence(fsmArg(0), fsmArg(1)));
      }
    }
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
