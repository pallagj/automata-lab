import dagre from "@dagrejs/dagre";
import React, { useLayoutEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Check, Copy, Download, FileImage, FileType } from "lucide-react";
import { useAppStore } from "../../state/store";
import { GraphEditing, suggestStateName } from "./editing";
import { EdgeDialog, StateDialog } from "./GraphDialogs";
import { buildStandaloneSVG, downloadFile, svgToPng, toTikz } from "./exporters";
import "./graph.css";

export interface GraphNode {
  id: string;
  label: string;
  accept?: boolean;
  start?: boolean;
  active?: boolean;
}

export interface GraphEdge {
  id: string;
  from: string;
  to: string;
  label: string;
  active?: boolean;
  clickable?: boolean;
}

export interface GraphSpec {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

interface Props {
  spec: GraphSpec;
  onEdgeClick?: (edge: GraphEdge) => void;
  className?: string;
  /** key for pinned positions (cell) — when set, states are draggable */
  cellId?: string | null;
  editing?: GraphEditing | null;
  /** base of the export file name */
  exportName?: string;
}

type DialogState =
  | { t: "state"; name: string | null; x: number; y: number }
  | { t: "edge"; from: string; to: string };

export interface LaidOutNode extends GraphNode {
  x: number;
  y: number;
  r: number;
}

export interface LaidOutEdge extends GraphEdge {
  path: string;
  /** the label's lines (one transition per line) */
  lines: string[];
  /** centre and size of the label box */
  labelX: number;
  labelY: number;
  labelW: number;
  labelH: number;
}

function nodeRadius(label: string): number {
  return Math.max(22, 10 + label.length * 4.6);
}

/* edge-label metrics: 12.5px monospace (see .graph-edge-label) */
const LABEL_CHAR_W = 7.6;
const LABEL_LINE_H = 15;
const LABEL_PAD_X = 6;
const LABEL_PAD_Y = 2;
/** baseline of a line, measured from the line's top */
const LABEL_BASELINE = LABEL_LINE_H / 2 + 4.3;

/** The label box: a "\n" in the label starts a new line. */
function labelBox(label: string): { lines: string[]; w: number; h: number } {
  const lines = label === "" ? [] : label.split("\n");
  if (lines.length === 0) return { lines, w: 0, h: 0 };
  const chars = Math.max(...lines.map((l) => [...l].length));
  return { lines, w: chars * LABEL_CHAR_W + LABEL_PAD_X * 2, h: lines.length * LABEL_LINE_H + LABEL_PAD_Y * 2 };
}

/** Self-loop drawn above the node; its peak is LOOP_PEAK·r above the centre. */
const LOOP_PEAK = 2.16;
const LOOP_GAP = 3;

type Pt = { x: number; y: number };
type Box = { x: number; y: number; w: number; h: number };

/** the point of a circle's border in the direction of `toward` */
function onCircle(c: Pt, toward: Pt, r: number): Pt {
  const dx = toward.x - c.x;
  const dy = toward.y - c.y;
  const d = Math.hypot(dx, dy) || 1;
  return { x: c.x + (dx / d) * r, y: c.y + (dy / d) * r };
}

/** An edge is a straight line, or a single arc for a back-and-forth pair: start, control point, end. */
type Arc = { s: Pt; c: Pt; e: Pt };

/** the arc from a to b, bent sideways by `bend` (0 = straight; > 0 = to the left of a→b) */
function edgeArc(a: LaidOutNode, b: LaidOutNode, bend: number): Arc {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const d = Math.hypot(dx, dy) || 1;
  const c = { x: (a.x + b.x) / 2 + (dy / d) * bend, y: (a.y + b.y) / 2 - (dx / d) * bend };
  // the ends sit on the circles (+ room for the arrowhead at the target)
  return { s: onCircle(a, c, a.r), c, e: onCircle(b, c, b.r + 7) };
}

function arcAt({ s, c, e }: Arc, t: number): Pt {
  const u = 1 - t;
  return { x: u * u * s.x + 2 * u * t * c.x + t * t * e.x, y: u * u * s.y + 2 * u * t * c.y + t * t * e.y };
}

const ARC_SAMPLES = 16;
const arcPoints = (arc: Arc): Pt[] => Array.from({ length: ARC_SAMPLES + 1 }, (_, i) => arcAt(arc, i / ARC_SAMPLES));

/** does the segment p→q cross the box (Liang–Barsky clipping)? */
function segmentHitsBox(p: Pt, q: Pt, b: Box): boolean {
  let t0 = 0;
  let t1 = 1;
  const dx = q.x - p.x;
  const dy = q.y - p.y;
  const clip = (den: number, num: number) => {
    if (den === 0) return num >= 0;
    const t = num / den;
    if (den > 0) {
      if (t < t0) return false;
      if (t < t1) t1 = t;
    } else {
      if (t > t1) return false;
      if (t > t0) t0 = t;
    }
    return true;
  };
  return (
    clip(-dx, p.x - b.x) && clip(dx, b.x + b.w - p.x) && clip(-dy, p.y - b.y) && clip(dy, b.y + b.h - p.y)
  );
}

const boxesOverlap = (a: Box, b: Box) =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

function boxHitsCircle(b: Box, c: LaidOutNode, margin: number): boolean {
  const nx = Math.max(b.x, Math.min(c.x, b.x + b.w));
  const ny = Math.max(b.y, Math.min(c.y, b.y + b.h));
  return Math.hypot(nx - c.x, ny - c.y) < c.r + margin;
}

/** positions along its edge where a label is tried, best first */
const LABEL_TS = [0.5, 0.42, 0.58, 0.34, 0.66, 0.26, 0.74];

/** Where dagre puts the states, with the label and radius sizes it was given — independent of dragging. */
export interface StatePlacement {
  boxes: Map<string, { lines: string[]; w: number; h: number }>;
  radii: Map<string, number>;
  positions: Map<string, Pt>;
}

export function placeStates(spec: GraphSpec): StatePlacement {
  const g = new dagre.graphlib.Graph({ multigraph: true });
  g.setGraph({ rankdir: "LR", nodesep: 30, ranksep: 76, marginx: 24, marginy: 24 });
  g.setDefaultEdgeLabel(() => ({}));

  const boxes = new Map(spec.edges.map((e) => [e.id, labelBox(e.label)]));

  const radii = new Map<string, number>();
  for (const n of spec.nodes) {
    const r = nodeRadius(n.label);
    radii.set(n.id, r);
    // a self-loop and its label stand above the node: reserve the room (symmetrically, as dagre centres nodes)
    let width = r * 2;
    let height = r * 2;
    for (const e of spec.edges) {
      if (e.from !== n.id || e.to !== n.id) continue;
      const b = boxes.get(e.id)!;
      width = Math.max(width, b.w);
      height = Math.max(height, 2 * (r * LOOP_PEAK + LOOP_GAP + b.h));
    }
    g.setNode(n.id, { width, height });
  }
  // the label sizes make dagre leave room for the labels between the ranks
  for (const e of spec.edges) {
    if (e.from !== e.to) {
      const b = boxes.get(e.id)!;
      g.setEdge(e.from, e.to, { width: b.w, height: b.h, labelpos: "c" }, e.id);
    }
  }
  dagre.layout(g);

  const positions = new Map(spec.nodes.map((n) => [n.id, { x: g.node(n.id)?.x ?? 0, y: g.node(n.id)?.y ?? 0 }]));
  return { boxes, radii, positions };
}

/**
 * dagre places the states; the edges are drawn here, with the same rule whether a
 * state sits where dagre put it or where it was dragged, so the edges simply follow.
 *
 * Every edge is straight; only a back-and-forth pair is drawn as two arcs, one on each
 * side. Labels sit on their own edge (the label box interrupts the line), so it is never
 * a question which edge a label belongs to; each slides along its edge to a spot where it
 * covers no state, no other label and no other edge, if there is one.
 */
export function layoutGraph(
  spec: GraphSpec,
  overrides: Map<string, { x: number; y: number }>,
  placement: StatePlacement = placeStates(spec)
): { nodes: LaidOutNode[]; edges: LaidOutEdge[]; bounds: [number, number, number, number] } {
  const { boxes, radii, positions } = placement;
  const nodes: LaidOutNode[] = spec.nodes.map((n) => {
    const pos = overrides.get(n.id) ?? positions.get(n.id);
    return { ...n, x: pos?.x ?? 0, y: pos?.y ?? 0, r: radii.get(n.id)! };
  });
  const byId = new Map(nodes.map((n) => [n.id, n]));

  // back-and-forth edge pairs: how many, and their tallest label
  const pairs = new Map<string, { count: number; h: number }>();
  for (const e of spec.edges) {
    if (e.from === e.to) continue;
    const key = [e.from, e.to].sort().join("→");
    const p = pairs.get(key) ?? { count: 0, h: 0 };
    pairs.set(key, { count: p.count + 1, h: Math.max(p.h, boxes.get(e.id)!.h) });
  }

  // 1. geometry: straight edges; a back-and-forth pair bends apart, each to its own left,
  //    far enough for the two labels to pass each other
  const arcs = new Map<string, Arc>();
  for (const e of spec.edges) {
    if (e.from === e.to) continue;
    const pair = pairs.get([e.from, e.to].sort().join("→"))!;
    const bend = pair.count > 1 ? Math.max(30, pair.h + 8) : 0;
    arcs.set(e.id, edgeArc(byId.get(e.from)!, byId.get(e.to)!, bend));
  }
  const arcPts = new Map([...arcs].map(([id, arc]) => [id, arcPoints(arc)]));

  // a self-loop and its label: labels of other edges keep off them
  const loopBoxes: Box[] = [];
  for (const e of spec.edges) {
    if (e.from !== e.to) continue;
    const a = byId.get(e.from)!;
    const box = boxes.get(e.id)!;
    loopBoxes.push({ x: a.x - 0.8 * a.r, y: a.y - LOOP_PEAK * a.r, w: 1.6 * a.r, h: (LOOP_PEAK - 0.8) * a.r });
    if (box.w > 0)
      loopBoxes.push({ x: a.x - box.w / 2, y: a.y - a.r * LOOP_PEAK - LOOP_GAP - box.h, w: box.w, h: box.h });
  }

  // 2. labels: self-loop labels are fixed above their loop, the others find a free spot on their edge
  const placed: Box[] = [...loopBoxes];
  const labelAt = new Map<string, Pt>();
  for (const e of spec.edges) {
    if (e.from !== e.to) continue;
    const a = byId.get(e.from)!;
    const box = boxes.get(e.id)!;
    labelAt.set(e.id, { x: a.x, y: a.y - a.r * LOOP_PEAK - LOOP_GAP - box.h / 2 });
  }
  for (const e of spec.edges) {
    if (e.from === e.to) continue;
    const box = boxes.get(e.id)!;
    let best: { p: Pt; score: number } | null = null;
    for (const t of LABEL_TS) {
      const p = arcAt(arcs.get(e.id)!, t);
      const b = { x: p.x - box.w / 2, y: p.y - box.h / 2, w: box.w, h: box.h };
      let score = 0;
      for (const n of nodes) if (boxHitsCircle(b, n, 2)) score += 100;
      for (const o of placed) if (boxesOverlap(b, o)) score += 10;
      for (const [id, pts] of arcPts) {
        if (id === e.id) continue;
        for (let i = 0; i < pts.length - 1; i++)
          if (segmentHitsBox(pts[i], pts[i + 1], b)) {
            score += 1;
            break;
          }
      }
      if (!best || score < best.score) best = { p, score };
      if (score === 0) break;
    }
    labelAt.set(e.id, best!.p);
    if (box.w > 0) placed.push({ x: best!.p.x - box.w / 2, y: best!.p.y - box.h / 2, w: box.w, h: box.h });
  }

  const extra: Pt[] = [];
  const edges: LaidOutEdge[] = spec.edges.map((e) => {
    const box = boxes.get(e.id)!;
    const { x: labelX, y: labelY } = labelAt.get(e.id)!;
    const label = { lines: box.lines, labelX, labelY, labelW: box.w, labelH: box.h };
    if (e.from === e.to) {
      // self-loop: a circle above the node, the label above the loop
      const a = byId.get(e.from)!;
      const r = a.r;
      const path = `M ${a.x - r * 0.5} ${a.y - r * 0.85} C ${a.x - r * 1.1} ${a.y - r * 2.6}, ${a.x + r * 1.1} ${a.y - r * 2.6}, ${a.x + r * 0.5} ${a.y - r * 0.85}`;
      extra.push({ x: a.x, y: a.y - r * LOOP_PEAK });
      return { ...e, ...label, path };
    }
    const { s, c, e: end } = arcs.get(e.id)!;
    extra.push(...arcPts.get(e.id)!);
    return { ...e, ...label, path: `M ${s.x} ${s.y} Q ${c.x} ${c.y} ${end.x} ${end.y}` };
  });

  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  const grow = (x0: number, y0: number, x1: number, y1: number) => {
    minX = Math.min(minX, x0);
    minY = Math.min(minY, y0);
    maxX = Math.max(maxX, x1);
    maxY = Math.max(maxY, y1);
  };
  for (const n of nodes) grow(n.x - n.r - 30, n.y - n.r - 30, n.x + n.r + 30, n.y + n.r + 30);
  for (const e of edges) {
    if (e.lines.length > 0)
      grow(e.labelX - e.labelW / 2 - 8, e.labelY - e.labelH / 2 - 8, e.labelX + e.labelW / 2 + 8, e.labelY + e.labelH / 2 + 8);
  }
  for (const p of extra) grow(p.x - 8, p.y - 8, p.x + 8, p.y + 8);
  if (!isFinite(minX)) {
    minX = 0;
    minY = 0;
    maxX = 100;
    maxY = 100;
  }
  return { nodes, edges, bounds: [minX, minY, maxX - minX, maxY - minY] };
}

export const GraphView: React.FC<Props> = ({ spec, onEdgeClick, className, cellId, editing, exportName }) => {
  const { t } = useTranslation();
  const savedPos = useAppStore((s) => (cellId ? s.layouts[cellId] : undefined));
  const setNodePos = useAppStore((s) => s.setNodePos);

  // live (while dragging) position layered over the saved one
  const [livePos, setLivePos] = useState<{ id: string; x: number; y: number } | null>(null);
  const overrides = useMemo(() => {
    const m = new Map<string, { x: number; y: number }>();
    if (savedPos) for (const [k, v] of Object.entries(savedPos)) m.set(k, v);
    if (livePos) m.set(livePos.id, livePos);
    return m;
  }, [savedPos, livePos]);

  // dagre runs only when the graph changes; dragging a state just redraws the edges
  const placement = useMemo(() => placeStates(spec), [spec]);
  const { nodes, edges, bounds } = useMemo(
    () => layoutGraph(spec, overrides, placement),
    [spec, overrides, placement]
  );
  const [view, setView] = useState<[number, number, number, number] | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const dragRef = useRef<{ x: number; y: number; view: [number, number, number, number] } | null>(null);
  const nodeDragRef = useRef<{ id: string; dx: number; dy: number; moved: boolean } | null>(null);
  const connectRef = useRef<{ from: string } | null>(null);
  const [connectLine, setConnectLine] = useState<{ x1: number; y1: number; x2: number; y2: number } | null>(null);
  const [connectTarget, setConnectTarget] = useState<string | null>(null);
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const [exportOpen, setExportOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  // refit only when the graph's structure changes (not while moving nodes)
  const structKey = spec.nodes
    .map((n) => n.id)
    .sort()
    .join("|");
  // reset before paint, otherwise the old zoom shows on the new graph for one frame
  useLayoutEffect(() => {
    setView(null);
  }, [structKey]);

  // canvas size for the zoom limit of the automatic fit, and the strip the editing hint covers
  const hintRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<{ w: number; h: number; hint: number } | null>(null);
  // useLayoutEffect + immediate measurement: the size is known before the first paint,
  // so the unlimited (over-zoomed) fit never flashes for a frame
  useLayoutEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const hint = hintRef.current;
    const measure = () =>
      setSize({ w: el.clientWidth, h: el.clientHeight, hint: hint ? hint.offsetHeight + 14 : 0 });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    if (hint) ro.observe(hint);
    return () => ro.disconnect();
  }, [!!editing]);

  // automatic fit with an upper zoom limit: a small graph on a big canvas must not be huge;
  // the graph is centred in the area above the editing hint, so the hint never hides a label
  const MAX_FIT_SCALE = 1.3;
  const fitted = useMemo<[number, number, number, number]>(() => {
    const [x, y, w, h] = bounds;
    if (!size || size.w === 0 || size.h === 0) return [x, y, w, h];
    const availH = Math.max(size.h / 2, size.h - size.hint);
    const scale = Math.min(MAX_FIT_SCALE, size.w / w, availH / h);
    const vw = size.w / scale;
    return [x - (vw - w) / 2, y - (availH / scale - h) / 2, vw, size.h / scale];
  }, [bounds, size]);

  const vb = view ?? fitted;

  const clientToView = (cx: number, cy: number): [number, number] => {
    const rect = svgRef.current!.getBoundingClientRect();
    // preserveAspectRatio=meet: the effective scale is the smaller ratio
    const scale = Math.min(rect.width / vb[2], rect.height / vb[3]);
    const padX = (rect.width - vb[2] * scale) / 2;
    const padY = (rect.height - vb[3] * scale) / 2;
    return [vb[0] + (cx - rect.left - padX) / scale, vb[1] + (cy - rect.top - padY) / scale];
  };

  /** pin the view before a drag starts so the fit does not jump */
  const freezeView = () => {
    if (!view) setView([vb[0], vb[1], vb[2], vb[3]]);
  };

  /** the nearest node that is close enough (works for overlapping states too) */
  const findTarget = (mx: number, my: number): LaidOutNode | null => {
    let target: LaidOutNode | null = null;
    let best = Infinity;
    for (const n of nodes) {
      const d = Math.hypot(n.x - mx, n.y - my);
      if (d <= n.r + 10 && d < best) {
        best = d;
        target = n;
      }
    }
    return target;
  };

  const onWheel = (e: React.WheelEvent) => {
    if (!svgRef.current) return;
    const factor = e.deltaY > 0 ? 1.15 : 1 / 1.15;
    const [mx, my] = clientToView(e.clientX, e.clientY);
    const cur = vb;
    const nw = Math.min(Math.max(cur[2] * factor, 40), bounds[2] * 8 + 400);
    const nh = (nw / cur[2]) * cur[3];
    setView([mx - ((mx - cur[0]) / cur[2]) * nw, my - ((my - cur[1]) / cur[3]) * nh, nw, nh]);
  };

  const onPointerDown = (e: React.PointerEvent) => {
    // clicking an edge does not start a pan, so the click lands reliably
    if ((e.target as Element).closest(".graph-edge")) return;
    dragRef.current = { x: e.clientX, y: e.clientY, view: vb };
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
  };

  const onNodePointerDown = (e: React.PointerEvent, n: LaidOutNode) => {
    if (!cellId) return;
    e.stopPropagation();
    freezeView();
    const [mx, my] = clientToView(e.clientX, e.clientY);
    nodeDragRef.current = { id: n.id, dx: n.x - mx, dy: n.y - my, moved: false };
    svgRef.current?.setPointerCapture(e.pointerId);
  };

  const onPortPointerDown = (e: React.PointerEvent, n: LaidOutNode) => {
    if (!editing) return;
    e.stopPropagation();
    freezeView();
    connectRef.current = { from: n.id };
    setConnectLine({ x1: n.x, y1: n.y, x2: n.x, y2: n.y });
    svgRef.current?.setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!svgRef.current) return;
    if (nodeDragRef.current) {
      const d = nodeDragRef.current;
      const [mx, my] = clientToView(e.clientX, e.clientY);
      d.moved = true;
      setLivePos({ id: d.id, x: mx + d.dx, y: my + d.dy });
      return;
    }
    if (connectRef.current) {
      const [mx, my] = clientToView(e.clientX, e.clientY);
      setConnectLine((l) => (l ? { ...l, x2: mx, y2: my } : null));
      setConnectTarget(findTarget(mx, my)?.id ?? null);
      return;
    }
    const d = dragRef.current;
    if (!d) return;
    const rect = svgRef.current.getBoundingClientRect();
    const scale = Math.min(rect.width / d.view[2], rect.height / d.view[3]);
    setView([
      d.view[0] - (e.clientX - d.x) / scale,
      d.view[1] - (e.clientY - d.y) / scale,
      d.view[2],
      d.view[3]
    ]);
  };

  const onPointerUp = (e: React.PointerEvent) => {
    if (nodeDragRef.current) {
      const d = nodeDragRef.current;
      nodeDragRef.current = null;
      if (d.moved && cellId) {
        const [mx, my] = clientToView(e.clientX, e.clientY);
        setNodePos(cellId, d.id, mx + d.dx, my + d.dy);
      } else if (!d.moved && editing) {
        // click (without dragging) → state editor dialog
        setDialog({ t: "state", name: d.id, x: 0, y: 0 });
      }
      setLivePos(null);
      return;
    }
    if (connectRef.current) {
      const from = connectRef.current.from;
      connectRef.current = null;
      setConnectLine(null);
      setConnectTarget(null);
      const [mx, my] = clientToView(e.clientX, e.clientY);
      const target = findTarget(mx, my);
      if (target && editing) setDialog({ t: "edge", from, to: target.id });
      return;
    }
    dragRef.current = null;
  };

  const onDoubleClick = (e: React.MouseEvent) => {
    const el = e.target as Element;
    if (editing && !el.closest(".graph-node") && !el.closest(".graph-edge")) {
      const [x, y] = clientToView(e.clientX, e.clientY);
      freezeView();
      setDialog({ t: "state", name: null, x, y });
      return;
    }
    setView(null);
  };

  /* ---- export ---- */
  const exportBase = exportName?.trim() || "automata";
  const exportBg = () =>
    getComputedStyle(svgRef.current!.parentElement!).backgroundColor || "#ffffff";

  const exportSVGText = () => buildStandaloneSVG(svgRef.current!, bounds, exportBg());

  const onExportSVG = () => {
    downloadFile(`${exportBase}.svg`, "image/svg+xml", exportSVGText());
    setExportOpen(false);
  };
  const onExportPNG = async () => {
    const blob = await svgToPng(exportSVGText(), bounds[2] + 20, bounds[3] + 20);
    downloadFile(`${exportBase}.png`, "image/png", blob);
    setExportOpen(false);
  };
  const tikzText = () =>
    toTikz(
      nodes.map((n) => ({ id: n.id, label: n.label, start: n.start, accept: n.accept, x: n.x, y: n.y })),
      edges.map((e) => ({ from: e.from, to: e.to, label: e.label }))
    );
  const onExportTikz = () => {
    downloadFile(`${exportBase}.tex`, "text/x-tex", tikzText());
    setExportOpen(false);
  };
  const onCopyTikz = async () => {
    await navigator.clipboard.writeText(tikzText());
    setCopied(true);
    setTimeout(() => {
      setCopied(false);
      setExportOpen(false);
    }, 1200);
  };

  return (
    <div className={`graph-wrap ${className ?? ""}`}>
      <svg
        ref={svgRef}
        className="graph-svg"
        viewBox={vb.join(" ")}
        preserveAspectRatio="xMidYMid meet"
        onWheel={onWheel}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onDoubleClick={onDoubleClick}
      >
        <defs>
          <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" className="graph-arrow" />
          </marker>
          <marker id="arrow-active" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" className="graph-arrow active" />
          </marker>
        </defs>

        {edges.map((e) => (
          <g
            key={e.id}
            className={`graph-edge ${e.active ? "active" : ""} ${e.clickable ? "clickable" : ""} ${editing ? "editable" : ""}`}
            onClick={() => e.clickable && onEdgeClick?.(e)}
          >
            <path d={e.path} className="graph-edge-hit" fill="none" />
            <path d={e.path} className="graph-edge-line" fill="none" markerEnd={e.active ? "url(#arrow-active)" : "url(#arrow)"} />
            {e.lines.length > 0 && (
              <>
                <rect
                  x={e.labelX - e.labelW / 2}
                  y={e.labelY - e.labelH / 2}
                  width={e.labelW}
                  height={e.labelH}
                  rx={4}
                  className={`graph-label-bg ${editing ? "editable" : ""}`}
                  onClick={(ev) => {
                    if (editing) {
                      ev.stopPropagation();
                      setDialog({ t: "edge", from: e.from, to: e.to });
                    }
                  }}
                />
                <text
                  className={`graph-edge-label ${editing ? "editable" : ""}`}
                  textAnchor="middle"
                  onClick={(ev) => {
                    if (editing) {
                      ev.stopPropagation();
                      setDialog({ t: "edge", from: e.from, to: e.to });
                    }
                  }}
                >
                  {e.lines.map((line, i) => (
                    <tspan
                      key={i}
                      x={e.labelX}
                      y={e.labelY - e.labelH / 2 + LABEL_PAD_Y + i * LABEL_LINE_H + LABEL_BASELINE}
                    >
                      {line}
                    </tspan>
                  ))}
                </text>
              </>
            )}
          </g>
        ))}

        {connectLine && (
          <line
            x1={connectLine.x1}
            y1={connectLine.y1}
            x2={connectLine.x2}
            y2={connectLine.y2}
            className="graph-connect-line"
            markerEnd="url(#arrow)"
          />
        )}

        {nodes.map((n) => (
          <g
            key={n.id}
            className={`graph-node ${n.active ? "active" : ""} ${cellId ? "movable" : ""} ${
              connectTarget === n.id ? "connect-target" : ""
            }`}
            transform={`translate(${n.x} ${n.y})`}
            onPointerDown={(e) => onNodePointerDown(e, n)}
          >
            {n.start && (
              <>
                <line x1={-n.r - 26} y1={0} x2={-n.r - 7} y2={0} className="graph-start-line" markerEnd="url(#arrow)" />
              </>
            )}
            {n.active && <circle r={n.r + 7} className="graph-node-halo" />}
            {editing && <circle r={n.r + 5} className="graph-ring-vis" />}
            <circle r={n.r} className="graph-node-circle" />
            {n.accept && <circle r={n.r - 4.5} className="graph-node-accept" />}
            <text className="graph-node-label" textAnchor="middle" dominantBaseline="central">
              {n.label}
            </text>
            {editing && (
              <>
                {/* edge dragging starts from the border band (ring) */}
                <circle
                  r={n.r + 4}
                  className="graph-ring-hit"
                  onPointerDown={(e) => onPortPointerDown(e, n)}
                >
                  <title>{t("graph.dragToConnect")}</title>
                </circle>
                <g
                  className="graph-port-dot"
                  transform={`translate(${n.r + 12} 0)`}
                  onPointerDown={(e) => onPortPointerDown(e, n)}
                >
                  <circle r={7.5} className="port-dot-bg" />
                  <path d="M -2.6 -3.4 L 2.6 0 L -2.6 3.4" className="port-dot-arrow" fill="none" />
                  <title>{t("graph.dragToConnect")}</title>
                </g>
              </>
            )}
          </g>
        ))}
      </svg>

      <div className="graph-tools">
        <div className="menu-anchor">
          <button
            className="graph-fit"
            title={t("graph.export.buttonTitle")}
            onClick={() => setExportOpen((o) => !o)}
          >
            <Download size={15} />
          </button>
          {exportOpen && (
            <div className="graph-export-menu" onMouseLeave={() => setExportOpen(false)}>
              <button onClick={onExportSVG}>
                <FileImage size={14} /> {t("graph.export.svg")}
              </button>
              <button onClick={onExportPNG}>
                <FileImage size={14} /> {t("graph.export.png")}
              </button>
              <button onClick={onExportTikz}>
                <FileType size={14} /> {t("graph.export.tikz")}
              </button>
              <button onClick={onCopyTikz}>
                {copied ? <Check size={14} /> : <Copy size={14} />}
                {copied ? t("graph.export.copied") : t("graph.export.copyTikz")}
              </button>
            </div>
          )}
        </div>
        <button className="graph-fit" title={t("graph.resetView")} onClick={() => setView(null)}>
          ⤢
        </button>
      </div>

      {editing && (
        <div className="graph-hint" ref={hintRef}>
          {t("graph.editingHint")}
        </div>
      )}

      {dialog?.t === "state" && editing && (
        <StateDialog
          mode={dialog.name ? "edit" : "new"}
          initial={
            dialog.name
              ? editing.getState(dialog.name)
              : {
                  name: suggestStateName(new Set(editing.states)),
                  isInit: editing.states.length === 0,
                  isAccept: false
                }
          }
          onSave={(p) =>
            dialog.name ? editing.updateState(dialog.name, p) : editing.addState(p, dialog.x, dialog.y)
          }
          onDelete={dialog.name ? () => editing.deleteState(dialog.name!) : undefined}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog?.t === "edge" && editing && (
        <EdgeDialog
          fields={editing.edgeFields}
          from={dialog.from}
          to={dialog.to}
          initial={editing.getEdge(dialog.from, dialog.to)}
          onSave={(m) => editing.setEdge(dialog.from, dialog.to, m)}
          onClose={() => setDialog(null)}
        />
      )}
    </div>
  );
};
