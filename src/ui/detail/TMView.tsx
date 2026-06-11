import React, { useEffect, useMemo, useState } from "react";
import {
  analyzeTM,
  initialTMConfig,
  matchingTransitions,
  stepTM,
  tapeWindow,
  TM,
  TMConfig,
  tmTransitionLabel,
  TM_BLANK
} from "../../core/tm/tm";
import { GraphEdge, GraphSpec, GraphView } from "../graph/GraphView";
import { useGraphEditing } from "../graph/editing";
import { Check, ChevronRight, Play, RotateCcw, StepForward, Table2, Undo2, X } from "lucide-react";

const MAX_RUN = 5000;

export const TMView: React.FC<{ tm: TM }> = ({ tm }) => {
  const { cellId, editing } = useGraphEditing("tm");
  const [input, setInput] = useState("");
  const [history, setHistory] = useState<TMConfig[]>([initialTMConfig(tm, "")]);

  useEffect(() => {
    setInput("");
    setHistory([initialTMConfig(tm, "")]);
  }, [tm]);

  const cfg = history[history.length - 1];
  const options = useMemo(() => matchingTransitions(tm, cfg), [tm, cfg]);
  const nondet = useMemo(() => analyzeTM(tm), [tm]);

  // megálló helyzet státuszának kiszámítása megjelenítéshez
  const displayStatus: "working" | "accepted" | "rejected" | "limit" =
    cfg.status !== "running"
      ? cfg.status
      : options.length === 0
        ? tm.accept.includes(cfg.state)
          ? "accepted"
          : "rejected"
        : "working";

  const step = (chosen?: GraphEdge) => {
    setHistory((h) => {
      const cur = h[h.length - 1];
      let tr = undefined;
      if (chosen) {
        const [from, , to] = chosen.id.split("⇒");
        tr = matchingTransitions(tm, cur).find((t) => t.from === from && t.to === to);
        if (!tr) return h;
      }
      const next = stepTM(tm, cur, tr);
      return next === cur ? h : [...h, next];
    });
  };

  const runAll = () => {
    setHistory((h) => {
      const out = [...h];
      let cur = out[out.length - 1];
      let guard = 0;
      while (cur.status === "running" && guard < MAX_RUN) {
        const next = stepTM(tm, cur);
        if (next === cur) break;
        cur = next;
        guard++;
        // csak a végeredményt és az utolsó lépéseket tartjuk meg, hogy ne nőjön hatalmasra
        out.push(cur);
        if (out.length > 400) out.splice(1, out.length - 400);
      }
      if (cur.status === "running" && guard >= MAX_RUN) {
        out.push({ ...cur, status: "limit" });
      }
      return out;
    });
  };

  const stepBack = () => setHistory((h) => (h.length > 1 ? h.slice(0, -1) : h));
  const reset = () => setHistory([initialTMConfig(tm, input)]);

  const spec: GraphSpec = useMemo(() => {
    const groups = new Map<string, { from: string; to: string; labels: string[]; active: boolean; clickable: boolean }>();
    for (const t of tm.transitions) {
      const key = `${t.from}⇒${t.to}`;
      if (!groups.has(key)) groups.set(key, { from: t.from, to: t.to, labels: [], active: false, clickable: false });
      const g = groups.get(key)!;
      g.labels.push(tmTransitionLabel(t));
      if (cfg.status === "running" && options.some((o) => o.from === t.from && o.to === t.to && o.read === t.read)) {
        g.active = true;
        g.clickable = true;
      }
    }
    return {
      nodes: tm.states.map((s) => ({
        id: s,
        label: s,
        accept: tm.accept.includes(s),
        start: s === tm.start,
        active: s === cfg.state
      })),
      edges: [...groups.entries()].map(([key, g]) => ({
        id: `${g.from}⇒x⇒${g.to}`,
        from: g.from,
        to: g.to,
        label: g.labels.join("  ·  "),
        active: g.active,
        clickable: g.clickable
      }))
    };
  }, [tm, cfg, options]);

  const tape = tapeWindow(cfg, 12);

  return (
    <>
      <div className="card">
        <div className="card-title">Turing-gép — {tm.name}</div>
        <div className="card-body">
          <div className="badges">
            <span className="badge accent">{tm.states.length} állapot</span>
            <span className="badge accent">lépések: {cfg.steps}</span>
            {nondet.nondeterministicAt.length > 0 && (
              <span
                className="badge warn"
                title={`Többértékű átmenetek: ${nondet.nondeterministicAt
                  .map((n) => `δ(${n.state}, ${n.read === TM_BLANK ? "␣" : n.read})`)
                  .join(", ")} — a gráfon kattintva választhatsz ágat.`}
              >
                nemdeterminisztikus
              </span>
            )}
          </div>
        </div>
        <div style={{ height: 320 }}>
          <GraphView spec={spec} onEdgeClick={(e) => step(e)} cellId={cellId} editing={editing} exportName={tm.name} />
        </div>
      </div>

      <div className="card">
        <div className="card-title">Szimuláció — szalag</div>
        <div className="card-body">
          <div className="sim-row">
            <input
              className="sim-input"
              value={input}
              placeholder="szalag kezdeti tartalma, pl. abba"
              onChange={(e) => {
                setInput(e.target.value);
                setHistory([initialTMConfig(tm, e.target.value)]);
              }}
              spellCheck={false}
            />
            <button className="sim-btn" onClick={reset} title="Újraindítás">
              <RotateCcw size={16} />
            </button>
            <button className="sim-btn" onClick={stepBack} disabled={history.length <= 1} title="Visszalépés">
              <Undo2 size={16} />
            </button>
            <button className="sim-btn" onClick={() => step()} disabled={displayStatus !== "working"} title="Egy lépés">
              <StepForward size={16} />
            </button>
            <button className="sim-btn" onClick={runAll} disabled={displayStatus !== "working"} title="Futtatás">
              <Play size={16} />
            </button>
            <span className={`verdict-pill ${displayStatus}`}>
              {displayStatus === "accepted" && (
                <>
                  <Check size={15} /> elfogadja
                </>
              )}
              {displayStatus === "rejected" && (
                <>
                  <X size={15} /> elutasítja
                </>
              )}
              {displayStatus === "working" && <>fut…</>}
              {displayStatus === "limit" && <>lépéskorlát ({MAX_RUN})</>}
            </span>
          </div>

          <div className="tape" style={{ marginTop: 10 }}>
            {tape.cells.map((c, i) => (
              <span key={tape.startPos + i} className={`tape-cell ${i === tape.headIndex ? "head" : ""}`}>
                {c === TM_BLANK ? "␣" : c}
              </span>
            ))}
          </div>
          <div style={{ fontSize: 12.5, color: "var(--muted)", marginTop: 4 }}>
            aktuális állapot: <b style={{ color: "var(--accent)" }}>{cfg.state}</b> · fejpozíció: {cfg.head}
            {options.length > 1 && " · több átmenet is illeszkedik — a gráfon választhatsz"}
          </div>
        </div>
      </div>

      <details className="card">
        <summary className="card-title">
          <Table2 size={15} />
          Átmenetek
          <ChevronRight size={15} className="chev" />
        </summary>
        <div className="card-body t-wrap">
          <table className="t">
            <thead>
              <tr>
                <th>honnan</th>
                <th>olvas</th>
                <th>ír</th>
                <th>mozgás</th>
                <th>hova</th>
              </tr>
            </thead>
            <tbody>
              {tm.transitions.map((t, i) => (
                <tr key={i}>
                  <td>{t.from}</td>
                  <td>{t.read === TM_BLANK ? "␣" : t.read}</td>
                  <td>{t.write === TM_BLANK ? "␣" : t.write}</td>
                  <td>{t.move === "R" ? "→" : t.move === "L" ? "←" : "·"}</td>
                  <td>{t.to}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </>
  );
};
