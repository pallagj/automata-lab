import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronRight, Maximize2, Minimize2 } from "lucide-react";

/**
 * Canvas-first layout for machines: the graph fills the whole right side, the
 * title/badges and the collapsible info panels float above it, and the
 * simulation (tape, configurations) lives in a strip docked at the bottom.
 * A panel can be enlarged over the whole canvas, for a long table or explanation.
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
  /** drawn over the canvas's bottom edge (an animation's controls) */
  overlay?: React.ReactNode;
}

export const Stage: React.FC<Props> = ({ graph, chips, bottom, panels, overlay }) => {
  const { t } = useTranslation();
  const [enlargedKey, setEnlargedKey] = useState<string | null>(null);
  const enlarged = panels?.find((p) => p.key === enlargedKey) ?? null;

  // Esc puts the enlarged panel back
  useEffect(() => {
    if (!enlarged) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setEnlargedKey(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [enlarged]);

  return (
    <div className="stage">
      <div className="stage-canvas">
        {graph}
        <div className="stage-chips">{chips}</div>
        {overlay}
        {panels && panels.length > 0 && (
          // hidden, not unmounted, while one is enlarged: the panels stay open or closed as they were
          <div className="stage-panels" hidden={enlarged !== null}>
            {panels.map((p) => (
              <details key={p.key} className="stage-panel" open={p.defaultOpen}>
                <summary>
                  {p.title}
                  <button
                    className="panel-enlarge"
                    title={t("detail.panelEnlarge")}
                    aria-label={t("detail.panelEnlarge")}
                    onClick={(e) => {
                      // a click in the summary would open or close the panel too
                      e.preventDefault();
                      setEnlargedKey(p.key);
                    }}
                  >
                    <Maximize2 size={13} />
                  </button>
                  <ChevronRight size={14} className="chev" />
                </summary>
                <div className="stage-panel-body">{p.content}</div>
              </details>
            ))}
          </div>
        )}
        {enlarged && (
          <div className="stage-panel stage-panel-enlarged">
            <div className="stage-panel-head">
              {enlarged.title}
              <button
                className="panel-enlarge"
                title={t("detail.panelRestore")}
                aria-label={t("detail.panelRestore")}
                onClick={() => setEnlargedKey(null)}
              >
                <Minimize2 size={13} />
              </button>
            </div>
            <div className="stage-panel-body">{enlarged.content}</div>
          </div>
        )}
      </div>
      {bottom && <div className="stage-bottom">{bottom}</div>}
    </div>
  );
};
