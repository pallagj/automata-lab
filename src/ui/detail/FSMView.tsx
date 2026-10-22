import React, { useEffect, useMemo, useState } from "react";
import { rich } from "../Rich";
import { useTranslation } from "react-i18next";
import { Diagnostic, EPS, setName } from "../../core/types";
import {
  analyzeFSM,
  epsilonClosure,
  FSM,
  initialStates,
  stepStates,
  transMap
} from "../../core/fsm/fsm";
import { languageSummary } from "../../core/fsm/decide";
import { showWord } from "../../core/verdict";
import { LanguageNote } from "./LanguageNote";
import { GraphEdge, GraphSpec, GraphView } from "../graph/GraphView";
import { useGraphEditing } from "../graph/editing";
import { Stage, StagePanel } from "./Stage";
import { StepsContent } from "./StepsPanel";
import { notesPanel } from "./DiagnosticsList";
import { TapeInput } from "./TapeInput";
import { StepGroup } from "../../core/expr/expression";
import { PlayerBar, playedFrames, toGraphFrame, usePlayer } from "./AnimationPlayer";
import {
  Check,
  Clapperboard,
  ListOrdered,
  ListTree,
  Pause,
  Play,
  RotateCcw,
  StepForward,
  Table2,
  Undo2,
  X
} from "lucide-react";

export const FSMView: React.FC<{ fsm: FSM; stepGroups?: StepGroup[]; diagnostics?: Diagnostic[] }> = ({
  fsm,
  stepGroups,
  diagnostics
}) => {
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

  // the run plays letter by letter, so the active states can be followed on the graph
  const [running, setRunning] = useState(false);
  useEffect(() => {
    if (!running) return;
    if (status !== "working") {
      setRunning(false);
      return;
    }
    const id = setTimeout(step, SIM_STEP_MS);
    return () => clearTimeout(id);
  }, [running, history, status]);

  const stepBack = () => {
    setRunning(false);
    setHistory((h) => (h.length > 1 ? h.slice(0, -1) : h));
  };
  const reset = () => {
    setRunning(false);
    setHistory([initialStates(fsm)]);
  };

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

  const spec: GraphSpec = useMemo(
    () => fsmGraphSpec(fsm, current.size > 0 ? { states: currentClosure, nextChar } : undefined),
    [fsm, currentClosure, nextChar, current]
  );

  // the algorithm's steps played on the graph
  const frames = useMemo(() => playedFrames(stepGroups), [stepGroups]);
  const [animating, setAnimating] = useState(false);
  useEffect(() => setAnimating(false), [frames]);
  const player = usePlayer(frames, animating);
  const played = animating ? frames[player.index]?.frame : undefined;
  // the result's own graph keeps its layout (and dragged states); another one is laid out on its own
  const plainSpec = useMemo(() => fsmGraphSpec(fsm), [fsm]);
  // the result's own graph (a copy of it reaches this view) keeps its layout and dragged states
  const playsResult = useMemo(() => !played || sameGraph(played.graph, fsm), [played?.graph, fsm]);
  const playedSpec = useMemo(
    () => (played && !playsResult ? fsmGraphSpec(played.graph) : plainSpec),
    [played?.graph, playsResult, plainSpec]
  );
  const graphFrame = useMemo(() => (played ? toGraphFrame(played, playedSpec) : null), [played, playedSpec]);

  const words = useMemo(() => languageSummary(fsm, 24), [fsm]);

  const symbols = analysis.hasEpsilon ? [...fsm.alphabet, EPS] : fsm.alphabet;

  const chips = (
    <>
      <span className="stage-title">
        {t("detail.fsm.title")}
        {fsm.name && <> — {rich(fsm.name)}</>}
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
      {frames.length > 0 && !animating && (
        <button className="anim-start" onClick={() => setAnimating(true)} title={t("detail.anim.startHint")}>
          <Clapperboard size={14} /> {t("detail.anim.start")}
        </button>
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
                    {rich(s)}
                    {fsm.accept.includes(s) ? " ✓" : ""}
                  </td>
                  {symbols.map((c) => (
                    <td key={c}>{rich([...(tm.get(s)?.get(c) ?? [])].join(", ")) || "—"}</td>
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
        words.empty ? (
          <LanguageNote summary={words} shownCount={0} emptyKey="detail.language.emptyFsm" />
        ) : (
          <>
            <div className="words">
              {words.words.map((w) => (
                <button
                  key={w}
                  className="word-chip"
                  title={t("detail.fsm.loadIntoSimulation")}
                  onClick={() => {
                    setInput(w);
                    setHistory([initialStates(fsm)]);
                  }}
                >
                  {showWord(w)}
                </button>
              ))}
            </div>
            <LanguageNote summary={words} shownCount={words.words.length} emptyKey="detail.language.emptyFsm" />
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
  const notes = notesPanel(diagnostics, t("detail.notes"));
  if (notes) panels.unshift(notes);

  const bottom = (
    <>
      <div className="sim-row">
        <TapeInput
          value={input}
          onChange={(v) => {
            setRunning(false);
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
        <button
          className="sim-btn"
          onClick={() => setRunning((r) => !r)}
          disabled={status !== "working"}
          title={running ? t("detail.fsm.pauseRun") : t("detail.fsm.runAll")}
        >
          {running ? <Pause size={16} /> : <Play size={16} />}
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
      graph={
        played ? (
          <GraphView
            spec={playedSpec}
            frame={graphFrame}
            cellId={playsResult ? cellId : null}
            exportName={fsm.name}
          />
        ) : (
          <GraphView spec={spec} onEdgeClick={stepEdge} cellId={cellId} editing={editing} exportName={fsm.name} />
        )
      }
      chips={chips}
      panels={panels}
      bottom={bottom}
      overlay={animating && <PlayerBar player={player} onClose={() => setAnimating(false)} />}
    />
  );
};

/** the same states and transitions, in the same order: drawn the same */
function sameGraph(a: FSM, b: FSM): boolean {
  if (a === b) return true;
  const key = (f: FSM) =>
    JSON.stringify([f.states, f.start, f.accept, f.transitions.map((t) => [t.from, t.symbol, t.to])]);
  return key(a) === key(b);
}

/** how long one letter of a played run takes (ms) */
const SIM_STEP_MS = 700;

/** The automaton's graph: one edge per pair of states, carrying all its letters; `sim` marks the run's active part. */
function fsmGraphSpec(fsm: FSM, sim?: { states: Set<string>; nextChar: string | null }): GraphSpec {
  const edgeGroups = new Map<string, { from: string; to: string; labels: string[]; active: boolean }>();
  for (const t of fsm.transitions) {
    const key = `${t.from}⇒${t.to}`;
    if (!edgeGroups.has(key)) edgeGroups.set(key, { from: t.from, to: t.to, labels: [], active: false });
    const g = edgeGroups.get(key)!;
    g.labels.push(t.symbol);
    if (sim && t.symbol === sim.nextChar && sim.states.has(t.from)) g.active = true;
  }
  return {
    nodes: fsm.states.map((s) => ({
      id: s,
      label: s,
      accept: fsm.accept.includes(s),
      start: s === fsm.start,
      active: !!sim?.states.has(s)
    })),
    edges: [...edgeGroups.values()].map((g) => ({
      id: `${g.from}⇒${g.labels.join("")}⇒${g.to}`,
      from: g.from,
      to: g.to,
      label: g.labels.join(", "),
      active: g.active,
      clickable: g.active
    }))
  };
}
