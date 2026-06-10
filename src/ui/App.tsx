import React, { useEffect, useMemo } from "react";
import { activeWorkspace, useAppStore } from "../state/store";
import { evaluateCells } from "../core/workspace";
import { TopBar } from "./TopBar";
import { EditorColumn } from "./editor/EditorColumn";
import { DetailPane } from "./detail/DetailPane";
import { Code2, Eye } from "lucide-react";

export const App: React.FC = () => {
  const theme = useAppStore((s) => s.theme);
  const mobileTab = useAppStore((s) => s.mobileTab);
  const setMobileTab = useAppStore((s) => s.setMobileTab);
  const ws = useAppStore(activeWorkspace);
  const activeCellId = useAppStore((s) => s.activeCellId);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);

  const sources = useMemo(() => ws.cells.map((c) => c.source), [ws.cells]);
  const results = useMemo(() => evaluateCells(sources), [sources]);

  const activeIndex = Math.max(
    0,
    ws.cells.findIndex((c) => c.id === activeCellId)
  );
  const activeResult = results[activeIndex] ?? null;

  return (
    <div className="app">
      <TopBar />
      <div className={`app-body tab-${mobileTab}`}>
        <div className="editor-col">
          <EditorColumn workspace={ws} results={results} />
        </div>
        <div className="detail-col">
          <DetailPane result={activeResult} />
        </div>
      </div>
      <nav className="mobile-tabs">
        <button className={mobileTab === "code" ? "active" : ""} onClick={() => setMobileTab("code")}>
          <Code2 size={16} style={{ verticalAlign: "-3px", marginRight: 6 }} />
          Kód
        </button>
        <button className={mobileTab === "view" ? "active" : ""} onClick={() => setMobileTab("view")}>
          <Eye size={16} style={{ verticalAlign: "-3px", marginRight: 6 }} />
          Vizualizáció
        </button>
      </nav>
    </div>
  );
};
