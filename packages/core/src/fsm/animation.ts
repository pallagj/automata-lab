import { I18nText } from "../types";
import type { FSM } from "./fsm";

/**
 * An algorithm at work, frame by frame on an automaton's graph: the subset construction and
 * the product filling in their states, the minimization's classes splitting round by round, a
 * regular expression's automata joined inside out, ε-removal making transitions direct.
 */
export interface FSMAnimation {
  frames: AnimFrame[];
}

export interface AnimFrame {
  /** the automaton drawn: the one being built, or the one being examined */
  graph: FSM;
  /** the automaton whose layout places the states, when `graph` has transitions that would scatter
   * them (ε-removal draws the new ones over the ε-NFA's shape); absent: graph's own */
  layout?: FSM;
  caption: I18nText;
  /** the states drawn; absent: all of them */
  shown?: string[];
  /** the transitions drawn, as transKey(…); absent: every transition between drawn states */
  edges?: string[];
  /** states found but not processed yet: drawn faded */
  pending?: string[];
  /** the states drawn as start states — several while separate automata are built; absent: the graph's start */
  start?: string[];
  /** the states drawn accepting; absent: the graph's accepting states */
  accept?: string[];
  /** what the frame is about: highlighted */
  focus?: string[];
  focusEdges?: string[];
  /** state → its class: the states of one class share a colour */
  classes?: Record<string, number>;
  /** state → a short tag drawn under it (the name of its class, the expression of an automaton) */
  tags?: Record<string, string>;
  /** a table beside the graph (the r(p, q, t) values) */
  table?: AnimTable;
}

/** A table of an animation frame; cells are [row, column] of `rows`. */
export interface AnimTable {
  headers: string[];
  rows: string[][];
  /** the cells the frame is about: highlighted */
  focus?: [number, number][];
  /** the cells they are computed from: shaded */
  marked?: [number, number][];
}

export function transKey(from: string, symbol: string, to: string): string {
  return `${from}\u0001${symbol}\u0001${to}`;
}

/** Beyond this many states an animation is too long to watch: none is recorded. */
export const ANIMATION_STATE_LIMIT = 40;
