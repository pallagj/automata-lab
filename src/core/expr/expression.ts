import { EPS, err, failResult, okResult, OpResult, AlgoStep, Diagnostic, info } from "../types";
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

export type ExprValue = Definition | RegexDef | EquivalenceVerdict;

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

  error(msg: string): never {
    throw new Error(`${msg} (pozíció: ${this.pos + 1})`);
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
    if (this.pos < this.src.length) this.error(`Váratlan karakter: „${this.peek()}”`);
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
    if (items.length === 0) this.error("Hiányzó kifejezés");
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
    if (c === undefined) this.error("A kifejezés váratlanul véget ért");
    if (c === "(") {
      this.pos++;
      const e = this.parseUnion();
      this.skipWs();
      if (this.peek() !== ")") this.error("Hiányzó záró zárójel");
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
          if (depth !== 0) this.error("Hiányzó záró zárójel a regex() hívásban");
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
            this.error("Hiányzó „,” vagy „)” a függvényhívásban");
          }
        }
        return { t: "call", fn: word as FuncName, args, rawArgs };
      }
      // csak ismert név vagy függvény lehet — betű-literál nincs
      if (this.knownNames.has(word)) return { t: "var", name: word };
      if ((FUNCTION_NAMES as readonly string[]).includes(word))
        this.error(`A(z) „${word}” függvénynév után zárójel kell`);
      this.error(
        `Ismeretlen név: „${word}” — gépekre a nevükkel hivatkozz; betűsorozatot csak a regex(…) belsejében használhatsz`
      );
    }
    this.error(`Értelmezhetetlen karakter: „${c}”`);
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

  asFSM(v: ExprValue, ctx: string): FSM {
    if (v.kind === "fsm") return v;
    if (v.kind === "regex") {
      // kényelmi automatikus konverzió: regex → ε-NFA (Thompson)
      this.diagnostics.push(
        info(
          `A(z) ${v.name} regexet automatikusan ε-NFA-vá alakítottam`,
          "A művelet véges automatát vár; a reguláris kifejezés a Thompson-konstrukcióval automatává alakítható — explicit módon: toFsm(" + v.name + ")."
        )
      );
      return this.take(`toFsm(${v.name})`, regexToNFA(v.pattern, v.name));
    }
    if (v.kind === "grammar") {
      // kényelmi automatikus konverzió 3. típusú nyelvtanra
      const r = grammarToFSM(v);
      if (r.ok) {
        this.diagnostics.push(
          info(`A(z) ${v.name} nyelvtant automatikusan véges automatává alakítottam`, "A művelet véges automatát vár; a jobblineáris nyelvtan átalakítható.")
        );
        return this.take(`toFsm(${v.name})`, r);
      }
    }
    throw new Error(`${ctx}: véges automatát vár, de ${describeKind(v)} érkezett`);
  }

  evaluate(e: Expr): ExprValue {
    switch (e.t) {
      case "var": {
        const v = this.env.get(e.name);
        if (v === undefined) throw new Error(`Ismeretlen név: „${e.name}”`);
        return v;
      }
      case "lit":
        // csak a regex() belső helykitöltője lehet — közvetlenül nem értékelődik ki
        throw new Error("Betű-literálok csak a regex(…) belsejében használhatók");
      case "concat": {
        let acc = this.asFSM(this.evaluate(e.items[0]), "összefűzés");
        for (let i = 1; i < e.items.length; i++) {
          const next = this.asFSM(this.evaluate(e.items[i]), "összefűzés");
          acc = this.take(`concat`, concatFSM(acc, next));
        }
        return acc;
      }
      case "union": {
        let acc = this.asFSM(this.evaluate(e.items[0]), "unió");
        for (let i = 1; i < e.items.length; i++) {
          const next = this.asFSM(this.evaluate(e.items[i]), "unió");
          acc = this.take(`union`, unionEpsilon(acc, next));
        }
        return acc;
      }
      case "star":
        return this.take("star", starFSM(this.asFSM(this.evaluate(e.inner), "lezárás")));
      case "call":
        return this.call(e);
    }
  }

  call(e: Extract<Expr, { t: "call" }>): ExprValue {
    const expectArgs = (n: number, alsoOk?: number) => {
      if (e.args.length !== n && e.args.length !== alsoOk)
        throw new Error(`A(z) ${e.fn} függvény ${n}${alsoOk !== undefined ? ` vagy ${alsoOk}` : ""} paramétert vár, de ${e.args.length} érkezett`);
    };
    const fsmArg = (i: number) => this.asFSM(this.evaluate(e.args[i]), `${e.fn}() ${i + 1}. paramétere`);
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
        if (v.kind !== "grammar")
          throw new Error("A toFsm() nyelvtant vagy reguláris kifejezést vár");
        return this.take(label("toFsm"), grammarToFSM(v));
      }
      case "toPda": {
        expectArgs(1);
        const v = this.evaluate(e.args[0]);
        if (v.kind !== "grammar") throw new Error("A toPda() nyelvtant vár");
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
    super(diags[0]?.title ?? "Hiba");
  }
}

function describeKind(v: ExprValue): string {
  switch (v.kind) {
    case "fsm":
      return "véges automata";
    case "pda":
      return "veremautomata";
    case "tm":
      return "Turing-gép";
    case "grammar":
      return "nyelvtan";
    case "regex":
      return "reguláris kifejezés";
    case "verdict":
      return "összehasonlítás eredménye";
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
    return failResult([
      err(
        "Hibás kifejezés",
        `${(e as Error).message}. Példák: detM = det(M) · u = union(M1, M2) · r = regex((ab)*+ba) · e = equal(M1, M2)`
      )
    ]);
  }
  const ev = new Evaluator(env);
  try {
    const value = ev.evaluate(ast);
    return okResult({ value, diagnostics: ev.diagnostics, stepGroups: ev.stepGroups }, ev.diagnostics);
  } catch (e) {
    if (e instanceof EvalDiagError) {
      return { ok: false, diagnostics: ev.diagnostics, steps: [] };
    }
    return failResult([err("Kiértékelési hiba", (e as Error).message)], []);
  }
}

/** „name = kifejezés” felbontása. */
export function splitAssignment(source: string): { name: string; expr: string } | null {
  const m = /^\s*([A-Za-z][A-Za-z0-9_'′]*)\s*=\s*([\s\S]+)$/.exec(source.trim());
  if (!m) return null;
  return { name: m[1], expr: m[2].trim() };
}
