import React, { useId, useMemo } from "react";
import { rich, svgRich } from "../Rich";
import { useTranslation } from "react-i18next";
import { useAppStore } from "../../state/store";
import { GraphSpec, layoutGraph } from "../graph/GraphView";
import type { PreviewContent, WorksheetKind } from "./preview";
import { KindIcon } from "../kinds";

type Pinned = Record<string, { x: number; y: number }> | undefined;
type Layout = ReturnType<typeof layoutGraph>;

/** Layouts survive closing the browser: specs are cached by content in summarizeCells, so they are stable keys. */
const layoutCache = new WeakMap<GraphSpec, { pinned: Pinned; layout: Layout }>();

function cachedLayout(spec: GraphSpec, pinned: Pinned): Layout {
  const hit = layoutCache.get(spec);
  if (hit && hit.pinned === pinned) return hit.layout;
  const layout = layoutGraph(spec, new Map(Object.entries(pinned ?? {})));
  layoutCache.set(spec, { pinned, layout });
  return layout;
}

/** Static mini rendering of a worksheet's first definition, honouring pinned state positions. */
export const WorksheetThumb: React.FC<{ preview: PreviewContent; labels?: boolean }> = ({ preview, labels = true }) => {
  const markerId = `thumb-arrow-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const pinned = useAppStore((s) => (preview.t === "graph" ? s.layouts[preview.cellId] : undefined));
  const laid = useMemo(() => (preview.t === "graph" ? cachedLayout(preview.spec, pinned) : null), [preview, pinned]);

  if (preview.t === "empty") return <div className="thumb thumb-empty" />;
  if (preview.t === "lines")
    return (
      <div className="thumb thumb-lines">
        <pre>{rich(preview.lines.join("\n"))}</pre>
      </div>
    );

  const { nodes, edges, bounds } = laid!;
  const arrow = `url(#${markerId})`;
  return (
    <div className="thumb thumb-graph">
      <svg viewBox={bounds.join(" ")} preserveAspectRatio="xMidYMid meet" aria-hidden>
        <defs>
          <marker
            id={markerId}
            viewBox="0 0 10 10"
            refX="9"
            refY="5"
            markerWidth="6"
            markerHeight="6"
            orient="auto-start-reverse"
          >
            <path d="M 0 0 L 10 5 L 0 10 z" className="thumb-arrow" />
          </marker>
        </defs>
        {edges.map((e) => (
          <path key={e.id} d={e.path} className="thumb-edge" markerEnd={arrow} />
        ))}
        {nodes.map((n) => (
          <g key={n.id} transform={`translate(${n.x} ${n.y})`}>
            {n.start && <line x1={-n.r - 24} y1={0} x2={-n.r - 6} y2={0} className="thumb-edge" markerEnd={arrow} />}
            <circle r={n.r} className="thumb-node" />
            {n.accept && <circle r={n.r - 5} className="thumb-node" />}
            {labels && (
              <text className="thumb-label" dy="0.35em">
                {svgRich(n.label)}
              </text>
            )}
          </g>
        ))}
      </svg>
    </div>
  );
};

/** Small round badges telling what a worksheet contains. */
export const KindBadges: React.FC<{ kinds: WorksheetKind[] }> = ({ kinds }) => {
  const { t } = useTranslation();
  if (kinds.length === 0) return null;
  return (
    <span className="kind-icons">
      {kinds.map((k) => (
        <KindIcon key={k} kind={k} size={14} title={t(`browser.kind.${k}`)} />
      ))}
    </span>
  );
};
