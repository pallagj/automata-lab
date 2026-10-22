import React, { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Pause, Play, SkipBack, SkipForward, StepBack, StepForward, X } from "lucide-react";
import { AnimFrame, AnimTable, transKey } from "../../core/fsm/animation";
import { StepGroup } from "../../core/expr/expression";
import { tr } from "../../i18n/translate";
import { rich } from "../Rich";
import { GraphFrame, GraphSpec } from "../graph/GraphView";

/** A frame of the played animation, with the operation it belongs to (a chain plays every one). */
export interface PlayedFrame {
  frame: AnimFrame;
  operation: string;
}

/** how long a frame stays at 1× (ms): long enough to read its caption */
const FRAME_MS = 1800;
const SPEEDS = [1, 2, 0.5];

/** Every animation of a result's operations, in the order they ran. */
export function playedFrames(stepGroups: StepGroup[] | undefined): PlayedFrame[] {
  return (stepGroups ?? []).flatMap((g) => (g.animation?.frames ?? []).map((frame) => ({ frame, operation: g.operation })));
}

/** The frame as the graph view draws it: the frame's transitions become the edges (and letters) shown. */
export function toGraphFrame(f: AnimFrame, spec: GraphSpec): GraphFrame {
  const edgeOf = new Map(spec.edges.map((e) => [`${e.from}\u0001${e.to}`, e.id]));
  const idOf = (from: string, to: string) => edgeOf.get(`${from}\u0001${to}`);
  const drawn = f.edges ? new Set(f.edges) : null;
  let edgeLabels: Map<string, string> | undefined;
  if (drawn) {
    const letters = new Map<string, string[]>();
    for (const t of f.graph.transitions) {
      const id = idOf(t.from, t.to);
      if (!id || !drawn.has(transKey(t.from, t.symbol, t.to))) continue;
      letters.set(id, [...(letters.get(id) ?? []), t.symbol]);
    }
    edgeLabels = new Map([...letters].map(([id, ls]) => [id, ls.join(", ")]));
  }
  const focusEdges = new Set(
    (f.focusEdges ?? []).flatMap((k) => {
      const [from, , to] = k.split("\u0001");
      const id = idOf(from, to);
      return id ? [id] : [];
    })
  );
  return {
    shown: f.shown && new Set(f.shown),
    pending: f.pending && new Set(f.pending),
    focus: f.focus && new Set(f.focus),
    classes: f.classes && new Map(Object.entries(f.classes)),
    tags: f.tags && new Map(Object.entries(f.tags)),
    edgeLabels,
    focusEdges
  };
}

export interface Player<F> {
  frames: F[];
  index: number;
  playing: boolean;
  speed: number;
  go: (i: number) => void;
  toggle: () => void;
  cycleSpeed: () => void;
}

/** Plays the frames one after the other; ← → step and space plays or pauses, outside text fields. */
export function usePlayer<F>(frames: F[], open: boolean): Player<F> {
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const last = frames.length - 1;

  // a new result starts from its first frame
  useEffect(() => {
    setIndex(0);
    setPlaying(open);
  }, [frames, open]);

  useEffect(() => {
    if (!playing) return;
    if (index >= last) {
      setPlaying(false);
      return;
    }
    const id = setTimeout(() => setIndex((i) => Math.min(i + 1, last)), FRAME_MS / speed);
    return () => clearTimeout(id);
  }, [playing, index, last, speed]);

  const go = (i: number) => {
    setPlaying(false);
    setIndex(Math.max(0, Math.min(last, i)));
  };
  // play from the start again once the end is reached
  const toggle = () => {
    if (!playing && index >= last) setIndex(0);
    setPlaying((p) => !p);
  };

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el?.closest("input, textarea, select, [contenteditable=true], .cm-editor")) return;
      if (e.key === "ArrowRight") go(index + 1);
      else if (e.key === "ArrowLeft") go(index - 1);
      else if (e.key === " ") toggle();
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  return {
    frames,
    index,
    playing,
    speed,
    go,
    toggle,
    cycleSpeed: () => setSpeed((s) => SPEEDS[(SPEEDS.indexOf(s) + 1) % SPEEDS.length])
  };
}

/** The controls and, below them, the caption: over the canvas's bottom edge, or `inline` in a card. */
export const PlayerBar: React.FC<{
  player: Player<unknown>;
  caption: React.ReactNode;
  inline?: boolean;
  onClose: () => void;
}> = ({ player, caption, inline, onClose }) => {
  const { t } = useTranslation();
  const { frames, index, playing, speed, go, toggle, cycleSpeed } = player;
  if (frames.length === 0) return null;
  return (
    <div className={`anim-player ${inline ? "inline" : ""}`} role="group" aria-label={t("detail.anim.title")}>
      <div className="anim-controls">
        <button onClick={() => go(0)} disabled={index === 0} title={t("detail.anim.first")}>
          <SkipBack size={15} />
        </button>
        <button onClick={() => go(index - 1)} disabled={index === 0} title={t("detail.anim.previous")}>
          <StepBack size={15} />
        </button>
        <button className="anim-play" onClick={toggle} title={playing ? t("detail.anim.pause") : t("detail.anim.play")}>
          {playing ? <Pause size={16} /> : <Play size={16} />}
        </button>
        <button onClick={() => go(index + 1)} disabled={index === frames.length - 1} title={t("detail.anim.next")}>
          <StepForward size={15} />
        </button>
        <button onClick={() => go(frames.length - 1)} disabled={index === frames.length - 1} title={t("detail.anim.last")}>
          <SkipForward size={15} />
        </button>
        <input
          className="anim-scrub"
          type="range"
          min={0}
          max={frames.length - 1}
          value={index}
          onChange={(e) => go(Number(e.target.value))}
          aria-label={t("detail.anim.frame")}
        />
        <span className="anim-count">
          {index + 1} / {frames.length}
        </span>
        <button className="anim-speed" onClick={cycleSpeed} title={t("detail.anim.speed")}>
          {speed}×
        </button>
        <button onClick={onClose} title={t("detail.anim.close")}>
          <X size={15} />
        </button>
      </div>
      <div className="anim-caption">{caption}</div>
    </div>
  );
};

/** What an operation's frame says: its caption — naming the operation when a chain plays several — and its table. */
export const FrameCaption: React.FC<{ frames: PlayedFrame[]; index: number }> = ({ frames, index }) => {
  const { t } = useTranslation();
  const several = useMemo(() => new Set(frames.map((f) => f.operation)).size > 1, [frames]);
  const current = frames[index];
  if (!current) return null;
  return (
    <>
      {several && <code className="anim-op">{rich(current.operation)}</code>}
      {rich(tr(t, current.frame.caption))}
      {current.frame.table && <FrameTable table={current.frame.table} />}
    </>
  );
};

const FrameTable: React.FC<{ table: AnimTable }> = ({ table }) => {
  const among = (cells: [number, number][] | undefined, r: number, c: number) =>
    !!cells?.some(([a, b]) => a === r && b === c);
  return (
    <div className="t-wrap anim-table">
      <table className="t">
        <thead>
          <tr>
            {table.headers.map((h, i) => (
              <th key={i}>{rich(h)}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {table.rows.map((row, r) => (
            <tr key={r}>
              {row.map((v, c) =>
                c === 0 ? (
                  <th key={c}>{rich(v)}</th>
                ) : (
                  <td
                    key={c}
                    className={among(table.focus, r, c) ? "focus" : among(table.marked, r, c) ? "marked" : undefined}
                  >
                    {rich(v)}
                  </td>
                )
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};
