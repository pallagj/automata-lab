import React, { useEffect, useMemo, useState } from "react";
import { EPS, setName } from "../../core/types";
import {
  analyzeFSM,
  enumerateWords,
  epsilonClosure,
  FSM,
  initialStates,
  stepStates,
  transMap
} from "../../core/fsm/fsm";
import { GraphEdge, GraphSpec, GraphView } from "../graph/GraphView";
import { useGraphEditing } from "../graph/editing";
import { Stage, StagePanel } from "./Stage";
import { StepsContent } from "./StepsPanel";
import { StepGroup } from "../../core/expr/expression";
import {
  Check,
  ListOrdered,
  ListTree,
  Play,
  RotateCcw,
  StepForward,
  Table2,
  Undo2,
  X
} from "lucide-react";

export const FSMView: React.FC<{ fsm: FSM; stepGroups?: StepGroup[] }> = ({ fsm, stepGroups }) => {
  const { cellId, editing } = useGraphEditing("fsm");
  const analysis = useMemo(() => analyzeFSM(fsm), [fsm]);
  const tm = useMemo(() => transMap(fsm), [fsm]);

  const [input, setInput] = useState("");
  const [history, setHistory] = useState<Set<string>[]>([initialStates(fsm)]);

  // automata csere → szimuláció újraindítása
  useEffect(() => {
    setHistory([initialStates(fsm)]);
    setInput("");
  }, [fsm]);

  const current = history[history.length - 1];
  const pos = history.length - 1;
  const nextChar = pos < input.length ? input[pos] : null;
  const currentClosure = useMemo(() => epsilonClosure(fsm, current, tm), [fsm, current, tm]);

  const status: "working" | "accepted" | "rejected" =
    current.size === 0
      ? "rejected"
      : pos >= input.length
        ? [...currentClosure].some((s) => fsm.accept.includes(s))
          ? "accepted"
          : "rejected"
        : "working";

  const step = () => {
    if (nextChar === null || current.size === 0) return;
    setHistory((h) => [...h, stepStates(fsm, h[h.length - 1], nextChar, tm)]);
  };

  const runAll = () => {
    setHistory((h) => {
      const out = [...h];
      let cur = out[out.length - 1];
      for (let i = out.length - 1; i < input.length; i++) {
        if (cur.size === 0) break;
        cur = stepStates(fsm, cur, input[i], tm);
        out.push(cur);
      }
      return out;
    });
  };

  const stepBack = () => setHistory((h) => (h.length > 1 ? h.slice(0, -1) : h));
  const reset = () => setHistory([initialStates(fsm)]);

  const stepEdge = (edge: GraphEdge) => {
    // egy konkrét él választása: csak az adott célállapotba lépünk
    const [from, , to] = edge.id.split("⇒");
    if (nextChar === null) return;
    const symbols = tm.get(from);
    if (!symbols) return;
    const viaSymbol = symbols.get(nextChar)?.has(to);
    if (viaSymbol && currentClosure.has(from)) {
      setHistory((h) => [...h, epsilonClosure(fsm, [to], tm)]);
    }
  };

  const spec: GraphSpec = useMemo(() => {
    const edgeGroups = new Map<string, { from: string; to: string; labels: string[]; active: boolean; clickable: boolean }>();
    for (const t of fsm.transitions) {
      const key = `${t.from}⇒${t.to}`;
      if (!edgeGroups.has(key))
        edgeGroups.set(key, { from: t.from, to: t.to, labels: [], active: false, clickable: false });
      const g = edgeGroups.get(key)!;
      g.labels.push(t.symbol);
      const usable = t.symbol === nextChar && currentClosure.has(t.from) && current.size > 0;
      if (usable) {
        g.active = true;
        g.clickable = true;
      }
    }
    return {
      nodes: fsm.states.map((s) => ({
        id: s,
        label: s,
        accept: fsm.accept.includes(s),
        start: s === fsm.start,
        active: currentClosure.has(s) && current.size > 0
      })),
      edges: [...edgeGroups.entries()].map(([key, g]) => ({
        id: `${g.from}⇒${g.labels.join("")}⇒${g.to}`,
        from: g.from,
        to: g.to,
        label: g.labels.join(", "),
        active: g.active,
        clickable: g.clickable
      }))
    };
  }, [fsm, currentClosure, nextChar, current]);

  const words = useMemo(() => enumerateWords(fsm, 7, 24), [fsm]);

  const symbols = analysis.hasEpsilon ? [...fsm.alphabet, EPS] : fsm.alphabet;

  const chips = (
    <>
      <span className="stage-title">Automata — {fsm.name}</span>
      <span className="badge accent">{fsm.states.length} állapot</span>
      <span
        className={`badge ${analysis.isDeterministic ? "ok" : "no"}`}
        title={
          analysis.isDeterministic
            ? "Minden (állapot, szimbólum) párhoz legfeljebb egy átmenet tartozik, és nincs ε-átmenet."
            : `Nemdeterminisztikus pontok: ${analysis.nondeterministicAt
                .slice(0, 3)
                .map((n) => `δ(${n.state},${n.symbol})={${n.targets.join(",")}}`)
                .join("; ")}${analysis.hasEpsilon ? " — és ε-átmenetek is vannak" : ""}`
        }
      >
        {analysis.isDeterministic ? "determinisztikus" : "nemdeterminisztikus"}
      </span>
      <span
        className={`badge ${analysis.isComplete ? "ok" : "no"}`}
        title={
          analysis.isComplete
            ? "Minden (állapot, szimbólum) párhoz van átmenet."
            : `Hiányzó átmenetek: ${analysis.missing
                .slice(0, 4)
                .map((m) => `δ(${m.state},${m.symbol})`)
                .join(", ")}${analysis.missing.length > 4 ? ", …" : ""}`
        }
      >
        {analysis.isComplete ? "teljes" : "nem teljes"}
      </span>
      <span
        className={`badge ${analysis.hasEpsilon ? "warn" : "ok"}`}
        title={
          analysis.hasEpsilon
            ? `ε-átmenetek: ${analysis.epsilonTransitions.map((t) => `${t.from}→${t.to}`).join(", ")}`
            : "Nincs ε-átmenet."
        }
      >
        {analysis.hasEpsilon ? "ε-átmenetes" : "ε-mentes"}
      </span>
      {analysis.unreachableStates.length > 0 && (
        <span className="badge warn" title="A kezdőállapotból nem elérhető állapotok — a reachable() művelettel elhagyhatók.">
          elérhetetlen: {analysis.unreachableStates.join(", ")}
        </span>
      )}
    </>
  );

  const panels: StagePanel[] = [
    {
      key: "table",
      title: (
        <>
          <Table2 size={14} /> Átmenet-táblázat
        </>
      ),
      content: (
        <div className="t-wrap">
          <table className="t">
            <thead>
              <tr>
                <th>állapot</th>
                {symbols.map((c) => (
                  <th key={c}>{c}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {fsm.states.map((s) => (
                <tr key={s}>
                  <td className={`state-cell ${fsm.accept.includes(s) ? "accept" : ""}`}>
                    {s === fsm.start ? "→ " : ""}
                    {s}
                    {fsm.accept.includes(s) ? " ✓" : ""}
                  </td>
                  {symbols.map((c) => (
                    <td key={c}>{[...(tm.get(s)?.get(c) ?? [])].join(", ") || "—"}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )
    },
    {
      key: "words",
      title: (
        <>
          <ListOrdered size={14} /> Elfogadott szavak
        </>
      ),
      content:
        words.words.length === 0 ? (
          <div style={{ color: "var(--muted)" }}>
            Nem találtam elfogadott szót 7 hosszig — lehet, hogy a felismerendő nyelv üres.
          </div>
        ) : (
          <>
            <div className="words">
              {words.words.map((w) => (
                <button
                  key={w}
                  className="word-chip"
                  title="Kattints: betöltés a szimulációba"
                  onClick={() => {
                    setInput(w === EPS ? "" : w);
                    setHistory([initialStates(fsm)]);
                  }}
                >
                  {w}
                </button>
              ))}
            </div>
            {!words.exhaustive && (
              <div style={{ marginTop: 8, fontSize: 12.5, color: "var(--muted)" }}>
                …és a nyelv ennél bővebb (a lista 7 hosszig / 24 szóig terjed).
              </div>
            )}
          </>
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
        <input
          className="sim-input"
          value={input}
          placeholder="bemeneti szó, pl. abab"
          onChange={(e) => {
            setInput(e.target.value);
            setHistory([initialStates(fsm)]);
          }}
          spellCheck={false}
        />
        <button className="sim-btn" onClick={reset} title="Újraindítás">
          <RotateCcw size={16} />
        </button>
        <button className="sim-btn" onClick={stepBack} disabled={history.length <= 1} title="Visszalépés">
          <Undo2 size={16} />
        </button>
        <button className="sim-btn" onClick={step} disabled={status !== "working"} title="Egy lépés">
          <StepForward size={16} />
        </button>
        <button className="sim-btn" onClick={runAll} disabled={status !== "working"} title="Futtatás végig">
          <Play size={16} />
        </button>
        <span className={`verdict-pill ${status}`}>
          {status === "accepted" && (
            <>
              <Check size={15} /> elfogadja
            </>
          )}
          {status === "rejected" && (
            <>
              <X size={15} /> elutasítja
            </>
          )}
          {status === "working" && <>fut…</>}
        </span>
      </div>

      {input.length > 0 && (
        <div className="tape">
          {[...input].map((c, i) => (
            <span key={i} className={`tape-cell ${i === pos ? "head" : ""} ${i < pos ? "done" : ""}`}>
              {c}
            </span>
          ))}
        </div>
      )}

      <div className="timeline">
        {history.map((set, i) => (
          <button
            key={i}
            className={i === history.length - 1 ? "current" : ""}
            onClick={() => setHistory((h) => h.slice(0, i + 1))}
            title={i === 0 ? "kezdőállapotok (ε-lezárással)" : `a(z) „${input[i - 1]}” beolvasása után`}
          >
            {i === 0 ? "▶" : input[i - 1]} {setName(epsilonClosure(fsm, set, tm))}
          </button>
        ))}
        {nextChar !== null && status === "working" && (
          <span className="sim-tip">a gráf kiemelt éleire kattintva ágat választhatsz</span>
        )}
      </div>
    </>
  );

  return (
    <Stage
      graph={<GraphView spec={spec} onEdgeClick={stepEdge} cellId={cellId} editing={editing} exportName={fsm.name} />}
      chips={chips}
      panels={panels}
      bottom={bottom}
    />
  );
};
