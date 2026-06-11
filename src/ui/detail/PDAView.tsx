import React, { useEffect, useMemo, useState } from "react";
import {
  initialConfig,
  isAcceptingConfig,
  PDA,
  PDAConfig,
  pdaMoves,
  pdaTransitionLabel,
  runPDA,
  stepPDAConfigs
} from "../../core/pda/pda";
import { GraphSpec, GraphView } from "../graph/GraphView";
import { useGraphEditing } from "../graph/editing";
import { Stage, StagePanel } from "./Stage";
import { StepsContent } from "./StepsPanel";
import { StepGroup } from "../../core/expr/expression";
import { Check, Layers, ListTree, Play, RotateCcw, StepForward, Table2, Undo2, X } from "lucide-react";

export const PDAView: React.FC<{ pda: PDA; stepGroups?: StepGroup[] }> = ({ pda, stepGroups }) => {
  const { cellId, editing } = useGraphEditing("pda");
  const [input, setInput] = useState("");
  const [history, setHistory] = useState<PDAConfig[][]>([[initialConfig(pda)]]);

  useEffect(() => {
    setInput("");
    setHistory([[initialConfig(pda)]]);
  }, [pda]);

  const configs = history[history.length - 1];
  const anyAccepting = configs.some((c) => isAcceptingConfig(pda, c, input.length));
  const overall = useMemo(() => runPDA(pda, input), [pda, input]);

  const status: "accepted" | "rejected" | "working" | "limit" = anyAccepting
    ? "accepted"
    : configs.length === 0
      ? "rejected"
      : "working";

  const step = () => setHistory((h) => [...h, stepPDAConfigs(pda, h[h.length - 1], input)]);
  const stepBack = () => setHistory((h) => (h.length > 1 ? h.slice(0, -1) : h));
  const reset = () => setHistory([[initialConfig(pda)]]);
  const runToEnd = () => {
    setHistory((h) => {
      const out = [...h];
      for (let i = 0; i < 200; i++) {
        const cur = out[out.length - 1];
        if (cur.length === 0 || cur.some((c) => isAcceptingConfig(pda, c, input.length))) break;
        out.push(stepPDAConfigs(pda, cur, input));
      }
      return out;
    });
  };

  const spec: GraphSpec = useMemo(() => {
    const activeEdges = new Set<string>();
    for (const c of configs) {
      for (const { transition } of pdaMoves(pda, c, input)) {
        activeEdges.add(`${transition.from}⇒${transition.to}`);
      }
    }
    const groups = new Map<string, { from: string; to: string; labels: string[] }>();
    for (const t of pda.transitions) {
      const key = `${t.from}⇒${t.to}`;
      if (!groups.has(key)) groups.set(key, { from: t.from, to: t.to, labels: [] });
      groups.get(key)!.labels.push(pdaTransitionLabel(t));
    }
    const activeStates = new Set(configs.map((c) => c.state));
    return {
      nodes: pda.states.map((s) => ({
        id: s,
        label: s,
        accept: pda.accept.includes(s),
        start: s === pda.start,
        active: activeStates.has(s)
      })),
      edges: [...groups.entries()].map(([key, g]) => ({
        id: key,
        from: g.from,
        to: g.to,
        label: g.labels.join("  ·  "),
        active: activeEdges.has(key)
      }))
    };
  }, [pda, configs, input]);

  const chips = (
    <>
      <span className="stage-title">Veremautomata — {pda.name}</span>
      <span className="badge accent">{pda.states.length} állapot</span>
      <span className="badge accent" title="A kezdő veremszimbólum">
        kezdő verem: {pda.startStack}
      </span>
      <span
        className="badge ok"
        title={
          pda.acceptMode === "emptyStack"
            ? "A szó akkor elfogadott, ha a bemenet elfogyott és a verem kiürült."
            : "A szó akkor elfogadott, ha a bemenet elfogyott és az automata elfogadó állapotban van."
        }
      >
        {pda.acceptMode === "emptyStack" ? "üres veremmel fogad el" : "elfogadó állapottal fogad el"}
      </span>
    </>
  );

  const panels: StagePanel[] = [
    {
      key: "table",
      title: (
        <>
          <Table2 size={14} /> Átmenetek
        </>
      ),
      content: (
        <div className="t-wrap">
          <table className="t">
            <thead>
              <tr>
                <th>honnan</th>
                <th>bemenet</th>
                <th>verem: levesz / felír</th>
                <th>hova</th>
              </tr>
            </thead>
            <tbody>
              {pda.transitions.map((t, i) => (
                <tr key={i}>
                  <td>{t.from}</td>
                  <td>{t.input}</td>
                  <td>
                    {t.pop} / {t.push === "" ? "ε" : t.push}
                  </td>
                  <td>{t.to}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )
    }
  ];
  if (stepGroups && stepGroups.length > 0) {
    panels.push({
      key: "steps",
      title: (
        <>
          <ListTree size={14} /> Hogyan készült?
        </>
      ),
      content: <StepsContent stepGroups={stepGroups} />
    });
  }

  const bottom = (
    <>
      <div className="sim-row">
        <span className="sim-dock-icon">
          <Layers size={15} />
        </span>
        <input
          className="sim-input"
          value={input}
          placeholder="bemeneti szó, pl. aabb"
          onChange={(e) => {
            setInput(e.target.value);
            setHistory([[initialConfig(pda)]]);
          }}
          spellCheck={false}
        />
        <button className="sim-btn" onClick={reset} title="Újraindítás">
          <RotateCcw size={16} />
        </button>
        <button className="sim-btn" onClick={stepBack} disabled={history.length <= 1} title="Visszalépés">
          <Undo2 size={16} />
        </button>
        <button className="sim-btn" onClick={step} disabled={status !== "working"} title="Egy lépés (minden ág)">
          <StepForward size={16} />
        </button>
        <button className="sim-btn" onClick={runToEnd} disabled={status !== "working"} title="Futtatás">
          <Play size={16} />
        </button>
        <span className={`verdict-pill ${overall.verdict === "accepted" ? "accepted" : overall.verdict === "rejected" ? "rejected" : "limit"}`}>
          {overall.verdict === "accepted" && (
            <>
              <Check size={15} /> elfogadja
            </>
          )}
          {overall.verdict === "rejected" && (
            <>
              <X size={15} /> elutasítja
            </>
          )}
          {overall.verdict === "limit" && <>korlátba ütközött</>}
        </span>
      </div>

      <div style={{ marginTop: 8, fontSize: 12.5, color: "var(--muted)" }}>
        A veremautomata nemdeterminisztikus: egyszerre minden lehetséges ágat követünk. Lépés:{" "}
        {history.length - 1} · aktív konfigurációk: {configs.length}
      </div>

      <div className="config-list">
        {configs.length === 0 && <div style={{ color: "var(--danger)" }}>Nincs több folytatható ág — a szó elutasítva.</div>}
        {configs.slice(0, 40).map((c, i) => (
          <div key={i} className={`config-item ${isAcceptingConfig(pda, c, input.length) ? "accepting" : ""}`}>
            <span>
              <span className="cfg-label">állapot </span>
              <span className="cfg-state">{c.state}</span>
            </span>
            <span>
              <span className="cfg-label">hátralévő bemenet </span>
              {input.slice(c.pos) || "ε"}
            </span>
            <span>
              <span className="cfg-label">verem (tető balra) </span>
              {c.stack || "ε"}
            </span>
          </div>
        ))}
        {configs.length > 40 && (
          <div style={{ color: "var(--muted)", fontSize: 12.5 }}>… és még {configs.length - 40} konfiguráció</div>
        )}
      </div>
    </>
  );

  return (
    <Stage
      graph={<GraphView spec={spec} cellId={cellId} editing={editing} exportName={pda.name} />}
      chips={chips}
      panels={panels}
      bottom={bottom}
    />
  );
};
