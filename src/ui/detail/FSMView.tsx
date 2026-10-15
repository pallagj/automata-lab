import React, { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
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
import { TapeInput } from "./TapeInput";
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
  const { t } = useTranslation();
  const { cellId, editing } = useGraphEditing();
  const analysis = useMemo(() => analyzeFSM(fsm), [fsm]);
  const tm = useMemo(() => transMap(fsm), [fsm]);

  const [input, setInput] = useState("");
  const [history, setHistory] = useState<Set<string>[]>([initialStates(fsm)]);

  // automaton changed → restart the simulation
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
    // a specific edge was chosen: step only into its target state
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
      <span className="stage-title">
        {t("detail.fsm.title")}
        {fsm.name && ` — ${fsm.name}`}
      </span>
      <span className="badge accent">{t("detail.fsm.stateCount", { count: fsm.states.length })}</span>
      <span
        className={`badge ${analysis.isDeterministic ? "ok" : "no"}`}
        title={
          analysis.isDeterministic
            ? t("detail.fsm.deterministicHint")
            : t("detail.fsm.nondeterministicHint", {
                spots: analysis.nondeterministicAt
                  .slice(0, 3)
                  .map((n) => `δ(${n.state},${n.symbol})={${n.targets.join(",")}}`)
                  .join("; "),
                epsilonNote: analysis.hasEpsilon ? t("detail.fsm.andHasEpsilon") : ""
              })
        }
      >
        {analysis.isDeterministic ? t("detail.fsm.deterministic") : t("detail.fsm.nondeterministic")}
      </span>
      <span
        className={`badge ${analysis.isComplete ? "ok" : "no"}`}
        title={
          analysis.isComplete
            ? t("detail.fsm.completeHint")
            : t("detail.fsm.incompleteHint", {
                missing: analysis.missing
                  .slice(0, 4)
                  .map((m) => `δ(${m.state},${m.symbol})`)
                  .join(", "),
                ellipsis: analysis.missing.length > 4 ? ", …" : ""
              })
        }
      >
        {analysis.isComplete ? t("detail.fsm.complete") : t("detail.fsm.incomplete")}
      </span>
      <span
        className={`badge ${analysis.hasEpsilon ? "warn" : "ok"}`}
        title={
          analysis.hasEpsilon
            ? t("detail.fsm.epsilonListHint", {
                list: analysis.epsilonTransitions.map((tr) => `${tr.from}→${tr.to}`).join(", ")
              })
            : t("detail.fsm.noEpsilonHint")
        }
      >
        {analysis.hasEpsilon ? t("detail.fsm.hasEpsilon") : t("detail.fsm.epsilonFree")}
      </span>
      {analysis.unreachableStates.length > 0 && (
        <span className="badge warn" title={t("detail.fsm.unreachableHint")}>
          {t("detail.fsm.unreachableLabel")}: {analysis.unreachableStates.join(", ")}
        </span>
      )}
    </>
  );

  const panels: StagePanel[] = [
    {
      key: "table",
      title: (
        <>
          <Table2 size={14} /> {t("detail.fsm.transitionTable")}
        </>
      ),
      content: (
        <div className="t-wrap">
          <table className="t">
            <thead>
              <tr>
                <th>{t("detail.fsm.state")}</th>
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
          <ListOrdered size={14} /> {t("detail.fsm.acceptedWords")}
        </>
      ),
      content:
        words.words.length === 0 ? (
          <div style={{ color: "var(--muted)" }}>
            {t("detail.fsm.noAcceptedWords")}
          </div>
        ) : (
          <>
            <div className="words">
              {words.words.map((w) => (
                <button
                  key={w}
                  className="word-chip"
                  title={t("detail.fsm.loadIntoSimulation")}
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
                {t("detail.fsm.wordsNotExhaustive")}
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
          <ListTree size={14} /> {t("detail.fsm.howWasThisBuilt")}
        </>
      ),
      content: <StepsContent stepGroups={stepGroups} />
    });
  }

  const bottom = (
    <>
      <div className="sim-row">
        <TapeInput
          value={input}
          onChange={(v) => {
            setInput(v);
            setHistory([initialStates(fsm)]);
          }}
          pos={input.length > 0 ? pos : undefined}
          placeholder={t("detail.fsm.inputPlaceholder")}
        />
        <button className="sim-btn" onClick={reset} title={t("detail.fsm.restart")}>
          <RotateCcw size={16} />
        </button>
        <button className="sim-btn" onClick={stepBack} disabled={history.length <= 1} title={t("detail.fsm.stepBack")}>
          <Undo2 size={16} />
        </button>
        <button className="sim-btn" onClick={step} disabled={status !== "working"} title={t("detail.fsm.oneStep")}>
          <StepForward size={16} />
        </button>
        <button className="sim-btn" onClick={runAll} disabled={status !== "working"} title={t("detail.fsm.runAll")}>
          <Play size={16} />
        </button>
        <span className={`verdict-pill ${status}`}>
          {status === "accepted" && (
            <>
              <Check size={15} /> {t("detail.fsm.accepts")}
            </>
          )}
          {status === "rejected" && (
            <>
              <X size={15} /> {t("detail.fsm.rejects")}
            </>
          )}
          {status === "working" && <>{t("detail.fsm.running")}</>}
        </span>
      </div>

      <div className="timeline">
        {history.map((set, i) => (
          <button
            key={i}
            className={i === history.length - 1 ? "current" : ""}
            onClick={() => setHistory((h) => h.slice(0, i + 1))}
            title={i === 0 ? t("detail.fsm.initialStatesHint") : t("detail.fsm.afterReadingHint", { symbol: input[i - 1] })}
          >
            {i === 0 ? "▶" : input[i - 1]} {setName(epsilonClosure(fsm, set, tm))}
          </button>
        ))}
        {nextChar !== null && status === "working" && (
          <span className="sim-tip">{t("detail.fsm.branchTip")}</span>
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
