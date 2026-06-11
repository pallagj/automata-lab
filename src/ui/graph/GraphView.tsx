import dagre from "@dagrejs/dagre";
import React, { useEffect, useMemo, useRef, useState } from "react";
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
  /** pozíció-rögzítés kulcsa (cella) — ha van, az állapotok húzhatók */
  cellId?: string | null;
  editing?: GraphEditing | null;
  /** export-fájlnév alapja */
  exportName?: string;
}

type DialogState =
  | { t: "state"; name: string | null; x: number; y: number }
  | { t: "edge"; from: string; to: string };

interface LaidOutNode extends GraphNode {
  x: number;
  y: number;
  r: number;
}

interface LaidOutEdge extends GraphEdge {
  path: string;
  labelX: number;
  labelY: number;
}

function nodeRadius(label: string): number {
  return Math.max(22, 10 + label.length * 4.6);
}

function layout(
  spec: GraphSpec,
  overrides: Map<string, { x: number; y: number }>
): { nodes: LaidOutNode[]; edges: LaidOutEdge[]; bounds: [number, number, number, number] } {
  const g = new dagre.graphlib.Graph({ multigraph: true });
  g.setGraph({ rankdir: "LR", nodesep: 34, ranksep: 56, marginx: 24, marginy: 24 });
  g.setDefaultEdgeLabel(() => ({}));

  const radii = new Map<string, number>();
  for (const n of spec.nodes) {
    const r = nodeRadius(n.label);
    radii.set(n.id, r);
    g.setNode(n.id, { width: r * 2, height: r * 2 });
  }
  for (const e of spec.edges) {
    if (e.from !== e.to) {
      g.setEdge(e.from, e.to, { width: e.label.length * 7, height: 18, labelpos: "c" }, e.id);
    }
  }
  dagre.layout(g);

  const nodes: LaidOutNode[] = spec.nodes.map((n) => {
    const pos = overrides.get(n.id) ?? g.node(n.id);
    return { ...n, x: pos?.x ?? 0, y: pos?.y ?? 0, r: radii.get(n.id)! };
  });
  const byId = new Map(nodes.map((n) => [n.id, n]));

  // azonos (from,to) párok és oda-vissza élpárok megkülönböztetése görbülettel
  const pairCount = new Map<string, number>();
  for (const e of spec.edges) {
    if (e.from === e.to) continue;
    const key = [e.from, e.to].sort().join("→");
    pairCount.set(key, (pairCount.get(key) ?? 0) + 1);
  }

  const edges: LaidOutEdge[] = spec.edges.map((e) => {
    const a = byId.get(e.from)!;
    const b = byId.get(e.to)!;

    if (e.from === e.to) {
      // hurokél: kör a csomópont fölött
      const r = a.r;
      const path = `M ${a.x - r * 0.5} ${a.y - r * 0.85} C ${a.x - r * 1.1} ${a.y - r * 2.6}, ${a.x + r * 1.1} ${a.y - r * 2.6}, ${a.x + r * 0.5} ${a.y - r * 0.85}`;
      return { ...e, path, labelX: a.x, labelY: a.y - r * 2.45 };
    }

    const key = [e.from, e.to].sort().join("→");
    const both = (pairCount.get(key) ?? 1) > 1;

    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const dist = Math.hypot(dx, dy) || 1;
    const ux = dx / dist;
    const uy = dy / dist;
    // merőleges eltolás, ha oda-vissza él is van
    const offset = both ? 26 : 0;
    const px = -uy * offset;
    const py = ux * offset;

    const sx = a.x + ux * a.r + px * 0.4;
    const sy = a.y + uy * a.r + py * 0.4;
    const ex = b.x - ux * (b.r + 7) + px * 0.4;
    const ey = b.y - uy * (b.r + 7) + py * 0.4;
    const mx = (a.x + b.x) / 2 + px;
    const my = (a.y + b.y) / 2 + py;

    const path = `M ${sx} ${sy} Q ${mx} ${my} ${ex} ${ey}`;
    return { ...e, path, labelX: mx, labelY: my - 7 };
  });

  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const n of nodes) {
    minX = Math.min(minX, n.x - n.r - 30);
    minY = Math.min(minY, n.y - n.r * 3);
    maxX = Math.max(maxX, n.x + n.r + 30);
    maxY = Math.max(maxY, n.y + n.r + 30);
  }
  for (const e of edges) {
    minY = Math.min(minY, e.labelY - 20);
  }
  if (!isFinite(minX)) {
    minX = 0;
    minY = 0;
    maxX = 100;
    maxY = 100;
  }
  return { nodes, edges, bounds: [minX, minY, maxX - minX, maxY - minY] };
}

export const GraphView: React.FC<Props> = ({ spec, onEdgeClick, className, cellId, editing, exportName }) => {
  const savedPos = useAppStore((s) => (cellId ? s.layouts[cellId] : undefined));
  const setNodePos = useAppStore((s) => s.setNodePos);

  // élő (húzás közbeni) pozíció a mentett fölé rétegezve
  const [livePos, setLivePos] = useState<{ id: string; x: number; y: number } | null>(null);
  const overrides = useMemo(() => {
    const m = new Map<string, { x: number; y: number }>();
    if (savedPos) for (const [k, v] of Object.entries(savedPos)) m.set(k, v);
    if (livePos) m.set(livePos.id, livePos);
    return m;
  }, [savedPos, livePos]);

  const { nodes, edges, bounds } = useMemo(() => layout(spec, overrides), [spec, overrides]);
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

  // csak a gráf szerkezetének változásakor illesztünk újra (mozgatáskor nem)
  const structKey = spec.nodes
    .map((n) => n.id)
    .sort()
    .join("|");
  useEffect(() => {
    setView(null);
  }, [structKey]);

  const vb = view ?? bounds;

  const clientToView = (cx: number, cy: number): [number, number] => {
    const rect = svgRef.current!.getBoundingClientRect();
    // preserveAspectRatio=meet: a tényleges skála a kisebb arány
    const scale = Math.min(rect.width / vb[2], rect.height / vb[3]);
    const padX = (rect.width - vb[2] * scale) / 2;
    const padY = (rect.height - vb[3] * scale) / 2;
    return [vb[0] + (cx - rect.left - padX) / scale, vb[1] + (cy - rect.top - padY) / scale];
  };

  /** húzás indítása előtt rögzítjük a nézetet, hogy ne ugráljon az illesztés */
  const freezeView = () => {
    if (!view) setView([vb[0], vb[1], vb[2], vb[3]]);
  };

  /** a legközelebbi, elég közeli csomópont (átfedő állapotoknál is jó) */
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
    // élre kattintáskor nem indul pan, hogy a kattintás megbízhatóan célba érjen
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
        // kattintás (húzás nélkül) → állapot-szerkesztő dialógus
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
            onClick={() => {
              if (e.clickable) onEdgeClick?.(e);
              else if (editing) setDialog({ t: "edge", from: e.from, to: e.to });
            }}
          >
            <path d={e.path} className="graph-edge-hit" fill="none" />
            <path d={e.path} className="graph-edge-line" fill="none" markerEnd={e.active ? "url(#arrow-active)" : "url(#arrow)"} />
            {editing && (
              <rect
                x={e.labelX - (e.label.length * 7.2) / 2 - 8}
                y={e.labelY - 15}
                width={e.label.length * 7.2 + 16}
                height={22}
                className="graph-label-hit"
                onClick={(ev) => {
                  ev.stopPropagation();
                  setDialog({ t: "edge", from: e.from, to: e.to });
                }}
              />
            )}
            <text
              x={e.labelX}
              y={e.labelY}
              className={`graph-edge-label ${editing ? "editable" : ""}`}
              textAnchor="middle"
              onClick={(ev) => {
                if (editing) {
                  ev.stopPropagation();
                  setDialog({ t: "edge", from: e.from, to: e.to });
                }
              }}
            >
              {e.label}
            </text>
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
                {/* a szegély sávjából (gyűrű) indul az él-húzás */}
                <circle
                  r={n.r + 4}
                  className="graph-ring-hit"
                  onPointerDown={(e) => onPortPointerDown(e, n)}
                >
                  <title>Húzd egy másik állapotra új átmenethez</title>
                </circle>
                <g
                  className="graph-port-dot"
                  transform={`translate(${n.r + 12} 0)`}
                  onPointerDown={(e) => onPortPointerDown(e, n)}
                >
                  <circle r={7.5} className="port-dot-bg" />
                  <path d="M -2.6 -3.4 L 2.6 0 L -2.6 3.4" className="port-dot-arrow" fill="none" />
                  <title>Húzd egy másik állapotra új átmenethez</title>
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
            title="Exportálás — SVG / PNG / LaTeX (TikZ)"
            onClick={() => setExportOpen((o) => !o)}
          >
            <Download size={15} />
          </button>
          {exportOpen && (
            <div className="graph-export-menu" onMouseLeave={() => setExportOpen(false)}>
              <button onClick={onExportSVG}>
                <FileImage size={14} /> SVG letöltése
              </button>
              <button onClick={onExportPNG}>
                <FileImage size={14} /> PNG letöltése
              </button>
              <button onClick={onExportTikz}>
                <FileType size={14} /> LaTeX (TikZ) letöltése
              </button>
              <button onClick={onCopyTikz}>
                {copied ? <Check size={14} /> : <Copy size={14} />}
                {copied ? "Másolva ✓" : "LaTeX (TikZ) másolása"}
              </button>
            </div>
          )}
        </div>
        <button className="graph-fit" title="Nézet visszaállítása" onClick={() => setView(null)}>
          ⤢
        </button>
      </div>

      {editing && (
        <div className="graph-hint">
          dupla katt: új állapot · kattintás: állapot szerkesztése · húzás: áthelyezés · a széléről
          (gyűrű / ▸ pont) húzva: átmenet · él címkéjére katt: átmenetek szerkesztése
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
          kind={editing.kind}
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
