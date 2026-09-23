import { EPS, err, failResult, okResult, OpResult, AlgoStep, Diagnostic, I18nText, info, tx } from "../types";
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
import { Grammar, grammarToFSM, grammarToPDA, fsmToGrammar, removeEpsilonRules } from "../grammar/grammar";
import { fsmToMachine, machineCaps, machineToFSM } from "../machine/machine";
import { Definition } from "../parse/definitionParser";

/**
 * Kifejezésnyelv: name = kifejezés
 *   - változók: korábban definiált gépek / regexek nevei
 *   - műveletek nevek között: összefűzés (egymás után írás), + (unió),
 *     * (lezárás), zárójelek
 *   - betű-literálok NINCSENEK — betűsorozat csak a regex(...) belsejében
 *   - függvények: det, min, epsfree, complete, reachable, complement, union,
 *     intersect, difference, concat, star, reverse, clean, toGrammar, toFsm,
 *     toPda, regex, equal
 */

/** Az expression-nyelv parse-/kiértékelési hibái mindig I18nText-et hordoznak. */
class ExprError extends Error {
  constructor(public i18n: I18nText) {
    super(i18n.key);
  }
}

/**
 * A kiértékelés belső értékei között az FSM is megjelenik (a véges-automata
 * algoritmusok ezen dolgoznak), de a végeredmény mindig az egységes
 * gépmodellre konvertálódik — kifelé csak machine/grammar/regex/verdict létezik.
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
  "regex",
  "equal"
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
    if (/[A-Za-z0-9_ε$]/.test(c)) {
      // azonosító beolvasása
      const start = this.pos;
      while (this.pos < this.src.length && /[A-Za-z0-9_'′ε$]/.test(this.src[this.pos])) this.pos++;
      const word = this.src.slice(start, this.pos);
      this.skipWs();
      if (this.peek() === "(" && (FUNCTION_NAMES as readonly string[]).includes(word)) {
        // függvényhívás
        this.pos++;
        const args: Expr[] = [];
        const rawArgs: string[] = [];
        if (word === "regex") {
          // a regex tartalmát nyersen olvassuk a záró zárójelig
          let depth = 1;
          const start2 = this.pos;
          while (this.pos < this.src.length && depth > 0) {
            if (this.src[this.pos] === "(") depth++;
            if (this.src[this.pos] === ")") depth--;
            if (depth > 0) this.pos++;
          }
          if (depth !== 0) this.error(tx("expression.error.missingCloseParenRegex", { pos: this.pos + 1 }));
          rawArgs.push(this.src.slice(start2, this.pos).trim());
          args.push({ t: "lit", c: EPS }); // helykitöltő, a kiértékelés a rawArgs-ot használja
          this.pos++; // ')'
          return { t: "call", fn: "regex", args, rawArgs };
        }
        this.skipWs();
        if (this.peek() === ")") {
          this.pos++;
        } else {
          while (true) {
            const argStart = this.pos;
            // regex() és complete() második paramétere: nyers szövegként is eltesszük
            const arg = this.parseUnion();
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
        }
        return { t: "call", fn: word as FuncName, args, rawArgs };
      }
      // csak ismert név vagy függvény lehet — betű-literál nincs
      if (this.knownNames.has(word)) return { t: "var", name: word };
      if ((FUNCTION_NAMES as readonly string[]).includes(word))
        this.error(tx("expression.error.functionNeedsParen", { word, pos: this.pos + 1 }));
      this.error(tx("expression.error.unknownName", { word, pos: this.pos + 1 }));
    }
    this.error(tx("expression.error.unparseableChar", { char: c, pos: this.pos + 1 }));
  }
}

/** Egy kifejezésben hivatkozott változónevek (a kiértékelési sorrendhez). */
export function collectDependencies(src: string, knownNames: Set<string>): Set<string> {
  const deps = new Set<string>();
  const re = /[A-Za-z0-9_'′]+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    if (knownNames.has(m[0]) && !(FUNCTION_NAMES as readonly string[]).includes(m[0])) deps.add(m[0]);
  }
  return deps;
}

/* --------------------------- Kiértékelés --------------------------- */

class Evaluator {
  diagnostics: Diagnostic[] = [];
  stepGroups: StepGroup[] = [];

  constructor(public env: Map<string, ExprValue>) {}

  take<T>(operation: string, r: OpResult<T>): T {
    this.diagnostics.push(...r.diagnostics);
    if (r.steps.length > 0) this.stepGroups.push({ operation, steps: r.steps });
    if (!r.ok) throw new EvalDiagError(r.diagnostics);
    return r.value!;
  }

  asFSM(v: ExprValue, ctxOpId: string): FSM {
    if (v.kind === "fsm") return v;
    if (v.kind === "regex") {
      // kényelmi automatikus konverzió: regex → ε-NFA (Thompson)
      this.diagnostics.push(
        info(
          tx("expression.autoConvert.regex.title", { name: v.name }),
          tx("expression.autoConvert.regex.detail", { name: v.name })
        )
      );
      return this.take(`toFsm(${v.name})`, regexToNFA(v.pattern, v.name));
    }
    if (v.kind === "grammar") {
      // kényelmi automatikus konverzió 3. típusú nyelvtanra
      const r = grammarToFSM(v);
      if (r.ok) {
        this.diagnostics.push(
          info(tx("expression.autoConvert.grammar.title", { name: v.name }), tx("expression.autoConvert.grammar.detail"))
        );
        return this.take(`toFsm(${v.name})`, r);
      }
    }
    if (v.kind === "machine") {
      // képesség-kapu: a tárolómentes gép maga a véges automata
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
        // csak a regex() belső helykitöltője lehet — közvetlenül nem értékelődik ki
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
    const label = (base: string) => `${base}(${e.rawArgs.join(", ")})`;

    switch (e.fn) {
      case "det":
        expectArgs(1);
        return this.take(label("det"), determinize(fsmArg(0)));
      case "min":
        expectArgs(1);
        return this.take(label("min"), minimize(fsmArg(0)));
      case "epsfree":
        expectArgs(1);
        return this.take(label("epsfree"), removeEpsilon(fsmArg(0)));
      case "complete":
        expectArgs(1, 2);
        return this.take(label("complete"), complete(fsmArg(0), e.args.length > 1 ? e.rawArgs[1] : undefined));
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
          // teljes DFA-kra szorzat, egyébként ε-konstrukció
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
        return this.take(label("toGrammar"), fsmToGrammar(fsmArg(0)));
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
      case "toPda": {
        expectArgs(1);
        const v = this.evaluate(e.args[0]);
        if (v.kind !== "grammar") throw new ExprError(tx("expression.error.toPdaExpects"));
        return this.take(label("toPda"), grammarToPDA(v));
      }
      case "regex":
        expectArgs(1);
        return this.take(label("regex"), regexValue(e.rawArgs[0]));
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

/** epsfree-mentesítés a régi $ jelölésre is figyelve. */
export function evaluateExpression(
  src: string,
  env: Map<string, ExprValue>
): OpResult<EvalOutput> {
  const known = new Set(env.keys());
  let ast: Expr;
  try {
    ast = new ExprParser(src, known).parse();
  } catch (e) {
    const i18n = e instanceof ExprError ? e.i18n : tx("expression.error.parseGeneric", { message: String((e as Error).message ?? e) });
    return failResult([err(tx("expression.error.invalidExpression"), i18n)]);
  }
  const ev = new Evaluator(env);
  try {
    let value = ev.evaluate(ast);
    // a végeredmény az egységes gépmodellben jelenik meg
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

/** „name = kifejezés” felbontása. */
export function splitAssignment(source: string): { name: string; expr: string } | null {
  const m = /^\s*([A-Za-z][A-Za-z0-9_'′]*)\s*=\s*([\s\S]+)$/.exec(source.trim());
  if (!m) return null;
  return { name: m[1], expr: m[2].trim() };
}
