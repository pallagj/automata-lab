import dagre from "@dagrejs/dagre";
import React, { useEffect, useMemo, useRef, useState } from "react";
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
}

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

function layout(spec: GraphSpec): { nodes: LaidOutNode[]; edges: LaidOutEdge[]; bounds: [number, number, number, number] } {
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
    const pos = g.node(n.id);
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

export const GraphView: React.FC<Props> = ({ spec, onEdgeClick, className }) => {
  const { nodes, edges, bounds } = useMemo(() => layout(spec), [spec]);
  const [view, setView] = useState<[number, number, number, number] | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const dragRef = useRef<{ x: number; y: number; view: [number, number, number, number] } | null>(null);
  const boundsKey = bounds.join(",");

  useEffect(() => {
    setView(null); // új gráf → új illesztés
  }, [boundsKey]);

  const vb = view ?? bounds;

  const clientToView = (cx: number, cy: number): [number, number] => {
    const rect = svgRef.current!.getBoundingClientRect();
    // preserveAspectRatio=meet: a tényleges skála a kisebb arány
    const scale = Math.min(rect.width / vb[2], rect.height / vb[3]);
    const padX = (rect.width - vb[2] * scale) / 2;
    const padY = (rect.height - vb[3] * scale) / 2;
    return [vb[0] + (cx - rect.left - padX) / scale, vb[1] + (cy - rect.top - padY) / scale];
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
    if ((e.target as Element).closest(".graph-edge-hit")) return;
    dragRef.current = { x: e.clientX, y: e.clientY, view: vb };
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d || !svgRef.current) return;
    const rect = svgRef.current.getBoundingClientRect();
    const scale = Math.min(rect.width / d.view[2], rect.height / d.view[3]);
    setView([
      d.view[0] - (e.clientX - d.x) / scale,
      d.view[1] - (e.clientY - d.y) / scale,
      d.view[2],
      d.view[3]
    ]);
  };
  const onPointerUp = () => {
    dragRef.current = null;
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
        onDoubleClick={() => setView(null)}
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
            className={`graph-edge ${e.active ? "active" : ""} ${e.clickable ? "clickable" : ""}`}
            onClick={() => e.clickable && onEdgeClick?.(e)}
          >
            <path d={e.path} className="graph-edge-hit" fill="none" />
            <path d={e.path} className="graph-edge-line" fill="none" markerEnd={e.active ? "url(#arrow-active)" : "url(#arrow)"} />
            <text x={e.labelX} y={e.labelY} className="graph-edge-label" textAnchor="middle">
              {e.label}
            </text>
          </g>
        ))}

        {nodes.map((n) => (
          <g key={n.id} className={`graph-node ${n.active ? "active" : ""}`} transform={`translate(${n.x} ${n.y})`}>
            {n.start && (
              <>
                <line x1={-n.r - 26} y1={0} x2={-n.r - 7} y2={0} className="graph-start-line" markerEnd="url(#arrow)" />
              </>
            )}
            {n.active && <circle r={n.r + 7} className="graph-node-halo" />}
            <circle r={n.r} className="graph-node-circle" />
            {n.accept && <circle r={n.r - 4.5} className="graph-node-accept" />}
            <text className="graph-node-label" textAnchor="middle" dominantBaseline="central">
              {n.label}
            </text>
          </g>
        ))}
      </svg>
      <button className="graph-fit" title="Nézet visszaállítása" onClick={() => setView(null)}>
        ⤢
      </button>
    </div>
  );
};
