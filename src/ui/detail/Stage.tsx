import React from "react";
import { ChevronRight } from "lucide-react";

/**
 * Canvas-first elrendezés a gépekhez: a gráf tölti ki a teljes jobb oldalt,
 * a cím/badge-ek és az összecsukható információs panelek fölötte lebegnek,
 * a szimuláció (szalag, konfigurációk) alul dokkolt sávban él.
 */

export interface StagePanel {
  key: string;
  title: React.ReactNode;
  content: React.ReactNode;
  defaultOpen?: boolean;
}

interface Props {
  graph: React.ReactNode;
  chips: React.ReactNode;
  bottom?: React.ReactNode;
  panels?: StagePanel[];
}

export const Stage: React.FC<Props> = ({ graph, chips, bottom, panels }) => (
  <div className="stage">
    <div className="stage-canvas">
      {graph}
      <div className="stage-chips">{chips}</div>
      {panels && panels.length > 0 && (
        <div className="stage-panels">
          {panels.map((p) => (
            <details key={p.key} className="stage-panel" open={p.defaultOpen}>
              <summary>
                {p.title}
                <ChevronRight size={14} className="chev" />
              </summary>
              <div className="stage-panel-body">{p.content}</div>
            </details>
          ))}
        </div>
      )}
    </div>
    {bottom && <div className="stage-bottom">{bottom}</div>}
  </div>
);
