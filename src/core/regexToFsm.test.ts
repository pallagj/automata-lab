import { describe, expect, it } from "vitest";
import { acceptsFSM, FSM } from "./fsm/fsm";
import { regexToNFA } from "./fsm/regex";
import { allWords, rng } from "./testing";
import { EPS } from "./types";

const edges = (f: FSM) => f.transitions.map((t) => `${t.from} ${t.symbol} ${t.to}`);

describe("regular expression → automaton (lecture notes 3.20)", () => {
  it("a letter: one transition (3.3)", () => {
    const f = regexToNFA("a").value!;
    expect(f.states).toEqual(["q_0", "q_1"]);
    expect(edges(f)).toEqual(["q_0 a q_1"]);
    expect(f.accept).toEqual(["q_1"]);
  });

  it("ε is one accepting state, ∅ one state that never accepts (3.3)", () => {
    const e = regexToNFA("ε").value!;
    expect([e.states, e.accept, e.transitions]).toEqual([["q_0"], ["q_0"], []]);
    const empty = regexToNFA("∅").value!;
    expect([empty.states, empty.accept, empty.transitions]).toEqual([["q_0"], [], []]);
  });

  it("a + b: a new start state with ε into both, accepting where either does (3.4)", () => {
    const r = regexToNFA("a+b");
    const f = r.value!;
    expect(f.start).toBe("q_0");
    expect(edges(f)).toEqual(["q_1 a q_2", "q_3 b q_4", `q_0 ${EPS} q_1`, `q_0 ${EPS} q_3`]);
    expect(f.accept).toEqual(["q_2", "q_4"]);
    // one row per subexpression, inside out
    expect(r.steps[0].table!.rows).toEqual([
      ["a", "3.3", "q_1 →a q_2", "q_1", "q_2"],
      ["b", "3.3", "q_3 →b q_4", "q_3", "q_4"],
      ["a+b", "3.4", "q_0 →ε q_1, q_0 →ε q_3", "q_0", "q_2, q_4"]
    ]);
  });

  it("ab: ε from the first one's accepting states into the second's start (3.9)", () => {
    const f = regexToNFA("ab").value!;
    expect(edges(f)).toEqual(["q_0 a q_1", "q_2 b q_3", `q_1 ${EPS} q_2`]);
    expect(f.accept).toEqual(["q_3"]);
  });

  it("(a+b)*: a new accepting start state, ε in and ε back from the accepting states (3.10)", () => {
    const r = regexToNFA("(a+b)*");
    const f = r.value!;
    expect(f.start).toBe("q_0");
    expect(f.accept).toEqual(["q_0"]);
    expect(r.steps[0].table!.rows.at(-1)).toEqual(["(a+b)*", "3.10", "q_0 →ε q_1, q_3 →ε q_0, q_5 →ε q_0", "q_0", "q_0"]);
    for (const w of allWords(["a", "b"], 5)) expect(acceptsFSM(f, w)).toBe(true);
  });

  it("∅* is {ε}, ∅a is ∅, a? is a + ε", () => {
    const star = regexToNFA("∅*").value!;
    expect(allWords(["a"], 3).filter((w) => acceptsFSM(star, w))).toEqual([""]);
    const cat = regexToNFA("∅a").value!;
    expect(allWords(["a"], 3).filter((w) => acceptsFSM(cat, w))).toEqual([]);
    const opt = regexToNFA("a?").value!;
    expect(allWords(["a"], 3).filter((w) => acceptsFSM(opt, w))).toEqual(["", "a"]);
  });

  it("accepts exactly the matching words of 600 random expressions", () => {
    const next = rng(320);
    const pick = <T,>(xs: T[]) => xs[Math.floor(next() * xs.length)];
    // the expression in our syntax and as a JavaScript regex
    const gen = (depth: number): [string, string] => {
      if (depth === 0 || next() < 0.3) {
        const leaf = pick(["a", "b", "a", "b", "ε", "∅"]);
        return [leaf, leaf === "ε" ? "(?:)" : leaf === "∅" ? "(?!)" : leaf];
      }
      const [x, jx] = gen(depth - 1);
      switch (pick(["alt", "cat", "star", "opt"])) {
        case "alt": {
          const [y, jy] = gen(depth - 1);
          return [`(${x}+${y})`, `(?:${jx}|${jy})`];
        }
        case "cat": {
          const [y, jy] = gen(depth - 1);
          return [`(${x})(${y})`, `(?:${jx})(?:${jy})`];
        }
        case "star":
          return [`(${x})*`, `(?:${jx})*`];
        default:
          return [`(${x})?`, `(?:${jx})?`];
      }
    };
    for (let k = 0; k < 600; k++) {
      const [pattern, js] = gen(4);
      const f = regexToNFA(pattern).value!;
      const re = new RegExp(`^(?:${js})$`);
      for (const w of allWords(["a", "b"], 6)) expect(acceptsFSM(f, w), `${pattern} ${w}`).toBe(re.test(w));
    }
  });
});
