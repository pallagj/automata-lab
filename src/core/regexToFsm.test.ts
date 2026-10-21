import { describe, expect, it } from "vitest";
import { acceptsFSM, FSM } from "./fsm/fsm";
import { regexToNFA } from "./fsm/regex";
import { allWords, rng } from "./testing";
import { EPS } from "./types";

const edges = (f: FSM) => f.transitions.map((t) => `${t.from} ${t.symbol} ${t.to}`);

describe("regular expression → automaton (lecture notes 3.20)", () => {
  it("a letter: one transition (3.3)", () => {
    const f = regexToNFA("a").value!;
    expect(f.states).toEqual(["q0", "q1"]);
    expect(edges(f)).toEqual(["q0 a q1"]);
    expect(f.accept).toEqual(["q1"]);
  });

  it("ε is one accepting state, ∅ one state that never accepts (3.3)", () => {
    const e = regexToNFA("ε").value!;
    expect([e.states, e.accept, e.transitions]).toEqual([["q0"], ["q0"], []]);
    const empty = regexToNFA("∅").value!;
    expect([empty.states, empty.accept, empty.transitions]).toEqual([["q0"], [], []]);
  });

  it("a + b: a new start state with ε into both, accepting where either does (3.4)", () => {
    const r = regexToNFA("a+b");
    const f = r.value!;
    expect(f.start).toBe("q0");
    expect(edges(f)).toEqual(["q1 a q2", "q3 b q4", `q0 ${EPS} q1`, `q0 ${EPS} q3`]);
    expect(f.accept).toEqual(["q2", "q4"]);
    // one row per subexpression, inside out
    expect(r.steps[0].table!.rows).toEqual([
      ["a", "3.3", "q1 →a q2", "q1", "q2"],
      ["b", "3.3", "q3 →b q4", "q3", "q4"],
      ["a+b", "3.4", "q0 →ε q1, q0 →ε q3", "q0", "q2, q4"]
    ]);
  });

  it("ab: ε from the first one's accepting states into the second's start (3.9)", () => {
    const f = regexToNFA("ab").value!;
    expect(edges(f)).toEqual(["q0 a q1", "q2 b q3", `q1 ${EPS} q2`]);
    expect(f.accept).toEqual(["q3"]);
  });

  it("(a+b)*: a new accepting start state, ε in and ε back from the accepting states (3.10)", () => {
    const r = regexToNFA("(a+b)*");
    const f = r.value!;
    expect(f.start).toBe("q0");
    expect(f.accept).toEqual(["q0"]);
    expect(r.steps[0].table!.rows.at(-1)).toEqual(["(a+b)*", "3.10", "q0 →ε q1, q3 →ε q0, q5 →ε q0", "q0", "q0"]);
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
