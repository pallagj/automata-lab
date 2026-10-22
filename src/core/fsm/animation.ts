import { I18nText } from "../types";
import type { FSM } from "./fsm";

/**
 * An algorithm at work, frame by frame on an automaton's graph: the subset construction
 * filling in its states, the minimization's classes splitting round by round.
 */
export interface FSMAnimation {
  frames: AnimFrame[];
}

export interface AnimFrame {
  /** the automaton drawn: the one being built, or the one being examined */
  graph: FSM;
  caption: I18nText;
  /** the states drawn; absent: all of them */
  shown?: string[];
  /** the transitions drawn, as transKey(…); absent: every transition between drawn states */
  edges?: string[];
  /** states found but not processed yet: drawn faded */
  pending?: string[];
  /** what the frame is about: highlighted */
  focus?: string[];
  focusEdges?: string[];
  /** state → its class: the states of one class share a colour */
  classes?: Record<string, number>;
  /** state → a short tag drawn under it (the name of its class) */
  tags?: Record<string, string>;
}

export function transKey(from: string, symbol: string, to: string): string {
  return `${from}\u0001${symbol}\u0001${to}`;
}

/** Beyond this many states an animation is too long to watch: none is recorded. */
export const ANIMATION_STATE_LIMIT = 40;
