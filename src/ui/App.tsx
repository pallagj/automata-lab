import React, { useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { activeWorkspace, useAppStore } from "../state/store";
import { evaluateCells } from "../core/workspace";
import { TopBar } from "./TopBar";
import { EditorColumn } from "./editor/EditorColumn";
import { DetailPane } from "./detail/DetailPane";
import { Code2, Eye } from "lucide-react";

export const App: React.FC = () => {
  const { t, i18n } = useTranslation();
  const theme = useAppStore((s) => s.theme);
  const mobileTab = useAppStore((s) => s.mobileTab);
  const setMobileTab = useAppStore((s) => s.setMobileTab);
  const ws = useAppStore(activeWorkspace);
  const activeCellId = useAppStore((s) => s.activeCellId);
  const paneWidth = useAppStore((s) => s.paneWidth);
  const setPaneWidth = useAppStore((s) => s.setPaneWidth);

  /** dragging the left panel's width */
  const onResizeStart = (e: React.PointerEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = paneWidth;
    const move = (ev: PointerEvent) =>
      setPaneWidth(Math.min(760, Math.max(280, startW + ev.clientX - startX)));
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      document.body.classList.remove("resizing");
    };
    document.body.classList.add("resizing");
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);

  useEffect(() => {
    document.title = t("app.title");
  }, [t, i18n.language]);

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
      <div
        className={`app-body tab-${mobileTab}`}
        style={{ ["--pane-w" as string]: `${paneWidth}px` } as React.CSSProperties}
      >
        <div className="editor-col">
          <EditorColumn workspace={ws} results={results} />
        </div>
        <div className="col-resizer" onPointerDown={onResizeStart} title={t("app.resizePane")} />
        <div className="detail-col">
          <DetailPane result={activeResult} />
        </div>
      </div>
      <nav className="mobile-tabs">
        <button className={mobileTab === "code" ? "active" : ""} onClick={() => setMobileTab("code")}>
          <Code2 size={16} style={{ verticalAlign: "-3px", marginRight: 6 }} />
          {t("app.code")}
        </button>
        <button className={mobileTab === "view" ? "active" : ""} onClick={() => setMobileTab("view")}>
          <Eye size={16} style={{ verticalAlign: "-3px", marginRight: 6 }} />
          {t("app.visualization")}
        </button>
      </nav>
    </div>
  );
};
