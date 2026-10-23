import React, { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Diagnostic, EPS } from "@automatalab/core/types";
import {
  analyzeMachine,
  hasInputHead,
  initialMachineConfig,
  isAcceptingMachineConfig,
  isOneWayTape,
  isReadOnlyTape,
  Machine,
  machineCaps,
  MachineConfig,
  machineMoves,
  machineTransitionLabel,
  readOnlyByDefault,
  runMachine,
  stepMachineConfigs,
  storageOpLabel,
  StorageSpec,
  StorageState,
  TapeState,
  tapeWindow
} from "@automatalab/core/machine/machine";
import { pdaDecider } from "@automatalab/core/machine/pda";
import { GraphSpec, GraphView } from "../graph/GraphView";
import { useGraphEditing } from "../graph/editing";
import { Stage, StagePanel } from "./Stage";
import { StepsContent } from "./StepsPanel";
import { notesPanel } from "./DiagnosticsList";
import { TapeInput } from "./TapeInput";
import { StepGroup } from "@automatalab/core/expr/expression";
import { Check, Layers, ListTree, Pause, Play, RotateCcw, StepForward, Table2, Undo2, X } from "lucide-react";
import { machineKindLabel, moveLetters } from "../machineLabels";
import { rich } from "../Rich";
import { showSymbols } from "@automatalab/core/symbols";

/** a played run stops after this many steps (a machine may run forever) */
const MAX_RUN_LEVELS = 300;
/** how long one step of a played run takes (ms) */
const SIM_STEP_MS = 600;

/** Compact text of a storage's content for the configuration list; [✗] is a head that fell off. */
function storageText(spec: StorageSpec, st: StorageState): string {
  if (Array.isArray(st)) return showSymbols(st);
  const w = tapeWindow(st, 8, isOneWayTape(spec));
  const cells = w.cells.map((c, i) => (i === w.headIndex ? `[${c}]` : c)).join("");
  return w.headIndex < 0 ? `[✗]${cells}` : cells;
}

/** Shows a storage as a row of cells (stack: top on the left, queue: front on the left). */
const StorageCells: React.FC<{ spec: StorageSpec; st: StorageState }> = ({ spec, st }) => {
  const { t } = useTranslation();
  const type = spec.type;
  if (type === "tape") {
    const oneWay = isOneWayTape(spec);
    const w = tapeWindow(st as TapeState, 12, oneWay);
    return (
      <div className="tape">
        {w.headIndex < 0 && (
          <span className="tape-cell head fell" title={t("detail.machine.fellOffCell")}>
            ✗
          </span>
        )}
        {w.cells.map((c, i) => (
          <span
            key={w.startPos + i}
            className={`tape-cell ${i === w.headIndex ? "head" : ""} ${oneWay && w.startPos + i === 0 ? "first" : ""}`}
            title={oneWay && w.startPos + i === 0 ? t("detail.machine.firstCell") : undefined}
          >
            {c}
          </span>
        ))}
      </div>
    );
  }
  const content = st as string[];
  return (
    <div className="tape">
      {content.length === 0 && <span className="tape-cell empty">ε</span>}
      {content.map((c, i) => (
        <span
          key={i}
          className={`tape-cell ${i === 0 ? "head" : ""}`}
          title={i === 0 ? (type === "stack" ? t("detail.machine.top") : t("detail.machine.front")) : undefined}
        >
          {rich(c)}
        </span>
      ))}
    </div>
  );
};

export const MachineView: React.FC<{ machine: Machine; stepGroups?: StepGroup[]; diagnostics?: Diagnostic[] }> = ({
  machine: m,
  stepGroups,
  diagnostics
}) => {
  const { t } = useTranslation();
  const { cellId, editing } = useGraphEditing();
  const caps = useMemo(() => machineCaps(m), [m]);
  const moves = useMemo(() => moveLetters(t), [t]);
  const analysis = useMemo(() => analyzeMachine(m), [m]);
  const head = hasInputHead(m);

  const [inputState, setInput] = useState("");
  const [historyState, setHistory] = useState<MachineConfig[][]>([[initialMachineConfig(m, "")]]);
  const [selected, setSelected] = useState(0);
  const [running, setRunning] = useState(false);

  // reset during render when the machine changes: the old configurations' storages
  // do not fit the new machine, and even a single such frame would crash
  const [forMachine, setForMachine] = useState(m);
  const machineChanged = forMachine !== m;
  if (machineChanged) {
    setForMachine(m);
    setInput("");
    setHistory([[initialMachineConfig(m, "")]]);
    setSelected(0);
    setRunning(false);
  }
  // even the in-progress (to-be-discarded) render works with data that fits the new machine
  const input = machineChanged ? "" : inputState;
  const history = machineChanged ? [[initialMachineConfig(m, "")]] : historyState;

  const configs = history[history.length - 1];
  const featured = configs[Math.min(selected, configs.length - 1)] ?? null;

  const movesPerConfig = useMemo(
    () => configs.map((c) => machineMoves(m, c, input)),
    [m, configs, input]
  );
  const anyMove = movesPerConfig.some((ms) => ms.length > 0);
  const anyAccepting = configs.some((c) => isAcceptingMachineConfig(m, c, input));
  // a pushdown automaton is decided exactly, by CYK on its grammar (7.16); other machines by a bounded search
  const decide = useMemo(() => (caps.isPDALike ? pdaDecider(m) : null), [m, caps]);
  const overall = useMemo(
    () => (decide ? { verdict: decide(input) ? ("accepted" as const) : ("rejected" as const) } : runMachine(m, input)),
    [m, input, decide]
  );

  const status: "accepted" | "rejected" | "working" = anyAccepting
    ? "accepted"
    : configs.length === 0 || !anyMove
      ? "rejected"
      : "working";

  const resetWith = (word: string) => {
    setRunning(false);
    setHistory([[initialMachineConfig(m, word)]]);
    setSelected(0);
  };
  const step = () => setHistory((h) => [...h, stepMachineConfigs(m, h[h.length - 1], input)]);
  const stepBack = () => {
    setRunning(false);
    setHistory((h) => (h.length > 1 ? h.slice(0, -1) : h));
  };

  // the run plays step by step (every branch at once), so the configurations can be followed
  const stepLimit = history.length > MAX_RUN_LEVELS;
  useEffect(() => {
    if (!running) return;
    if (status !== "working" || stepLimit) {
      setRunning(false);
      return;
    }
    const id = setTimeout(step, SIM_STEP_MS);
    return () => clearTimeout(id);
  }, [running, history, status, stepLimit]);

  const spec: GraphSpec = useMemo(() => {
    const groups = new Map<string, { from: string; to: string; labels: string[]; active: boolean }>();
    const activeKeys = new Set<string>();
    for (const ms of movesPerConfig) {
      for (const { transition } of ms) activeKeys.add(`${transition.from}⇒${transition.to}`);
    }
    for (const t of m.transitions) {
      const key = `${t.from}⇒${t.to}`;
      if (!groups.has(key)) groups.set(key, { from: t.from, to: t.to, labels: [], active: false });
      const g = groups.get(key)!;
      g.labels.push(machineTransitionLabel(m, t, moves));
      if (status === "working" && activeKeys.has(key)) g.active = true;
    }
    const activeStates = new Set(configs.map((c) => c.state));
    return {
      nodes: m.states.map((s) => ({
        id: s,
        label: s,
        accept: m.accept.includes(s),
        start: s === m.start,
        active: activeStates.has(s) && configs.length > 0
      })),
      edges: [...groups.entries()].map(([key, g]) => ({
        id: key,
        from: g.from,
        to: g.to,
        // one transition per line, as in the textbooks
        label: g.labels.join("\n"),
        active: g.active
      }))
    };
  }, [m, configs, movesPerConfig, status, moves]);

  const chips = (
    <>
      <span className="stage-title">
        {machineKindLabel(t, caps)}
        {m.name && <> — {rich(m.name)}</>}
      </span>
      <span className="badge accent">{t("detail.fsm.stateCount", { count: m.states.length })}</span>
      {m.storages
        .filter((s) => s.type === "tape" && !isOneWayTape(s))
        .map((s) => (
          <span key={`${s.id}-extent`} className="badge accent" title={t("detail.machine.tapeBothWaysHint")}>
            {t("detail.machine.tapeBothWays", { id: s.id })}
          </span>
        ))}
      {m.storages
        .filter((s) => s.type === "tape" && isReadOnlyTape(s) !== readOnlyByDefault(m.input, m.storages, s.id))
        .map((s) => {
          // a write access other than the default one: the notes' k-tape machine reads its input tape only (9.9)
          const key = isReadOnlyTape(s) ? "tapeReadOnly" : "inputTapeWritable";
          return (
            <span key={`${s.id}-access`} className="badge accent" title={t(`detail.machine.${key}Hint`)}>
              {t(`detail.machine.${key}`, { id: s.id })}
            </span>
          );
        })}
      {m.storages
        .filter((s) => s.init.length > 0)
        .map((s) => (
          <span key={s.id} className="badge accent" title={t("detail.machine.initialContentHint", { id: s.id })}>
            {t("detail.machine.initial")} {s.id}: {rich(showSymbols(s.init))}
          </span>
        ))}
      <span
        className={`badge ${analysis.isDeterministic ? "ok" : "no"}`}
        title={
          analysis.isDeterministic
            ? t("detail.machine.deterministicHint")
            : t("detail.machine.conflictingTransitions", {
                spots: analysis.nondeterministicAt
                  .slice(0, 2)
                  .map((n) => `${n.state}: ${n.pair.map((x) => machineTransitionLabel(m, x, moves)).join("  ‖  ")}`)
                  .join(" · ")
              })
        }
      >
        {analysis.isDeterministic ? t("detail.fsm.deterministic") : t("detail.fsm.nondeterministic")}
      </span>
      {head && (
        <span
          className="badge ok"
          title={
            m.acceptMode === "emptyStorages"
              ? t("detail.machine.acceptEmptyStorageHint")
              : t("detail.machine.acceptAcceptStateHint")
          }
        >
          {m.acceptMode === "emptyStorages" ? t("detail.machine.acceptEmptyStorage") : t("detail.machine.acceptAcceptState")}
        </span>
      )}
      {!head && (
        <span className="badge accent" title={t("detail.machine.decidesOnHaltHint")}>
          {t("detail.machine.decidesOnHalt")}
        </span>
      )}
    </>
  );

  const panels: StagePanel[] = [
    {
      key: "table",
      title: (
        <>
          <Table2 size={14} /> {t("detail.machine.transitions")}
        </>
      ),
      content: (
        <div className="t-wrap">
          <table className="t">
            <thead>
              <tr>
                <th>{t("detail.machine.from")}</th>
                {head && <th>{t("detail.machine.input")}</th>}
                {m.storages.map((s) => (
                  <th key={s.id}>
                    {s.id} ({t(isReadOnlyTape(s) ? "detail.machine.storageType.readOnlyTape" : `detail.machine.storageType.${s.type}`)})
                  </th>
                ))}
                <th>{t("detail.machine.to")}</th>
              </tr>
            </thead>
            <tbody>
              {m.transitions.map((t, i) => (
                <tr key={i}>
                  <td>{rich(t.from)}</td>
                  {head && <td>{t.input}</td>}
                  {t.ops.map((op, j) => (
                    <td key={j}>{rich(storageOpLabel(op, moves, isReadOnlyTape(m.storages[j])))}</td>
                  ))}
                  <td>{rich(t.to)}</td>
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
          <ListTree size={14} /> {t("detail.fsm.howWasThisBuilt")}
        </>
      ),
      content: <StepsContent stepGroups={stepGroups} />
    });
  }
  const notes = notesPanel(diagnostics, t("detail.notes"));
  if (notes) panels.unshift(notes);

  const featuredPos = featured?.pos ?? 0;

  const bottom = (
    <>
      <div className="sim-row">
        <span className="sim-dock-icon">
          <Layers size={15} />
        </span>
        <TapeInput
          value={input}
          onChange={(v) => {
            setInput(v);
            resetWith(v);
          }}
          pos={head && input.length > 0 ? featuredPos : undefined}
          placeholder={head ? t("detail.fsm.inputPlaceholder") : t("detail.machine.tapeStartPlaceholder")}
        />
        <button className="sim-btn" onClick={() => resetWith(input)} title={t("detail.fsm.restart")}>
          <RotateCcw size={16} />
        </button>
        <button className="sim-btn" onClick={stepBack} disabled={history.length <= 1} title={t("detail.fsm.stepBack")}>
          <Undo2 size={16} />
        </button>
        <button className="sim-btn" onClick={step} disabled={status !== "working"} title={t("detail.machine.oneStepAllBranches")}>
          <StepForward size={16} />
        </button>
        <button
          className="sim-btn"
          onClick={() => setRunning((r) => !r)}
          disabled={status !== "working" || stepLimit}
          title={running ? t("detail.fsm.pauseRun") : t("detail.fsm.runAll")}
        >
          {running ? <Pause size={16} /> : <Play size={16} />}
        </button>
        <span
          className={`verdict-pill ${overall.verdict === "accepted" ? "accepted" : overall.verdict === "rejected" ? "rejected" : "limit"}`}
          title={decide ? t("detail.machine.decidedByGrammar") : undefined}
        >
          {overall.verdict === "accepted" && (
            <>
              <Check size={15} /> {t("detail.fsm.accepts")}
            </>
          )}
          {overall.verdict === "rejected" && (
            <>
              <X size={15} /> {t("detail.fsm.rejects")}
            </>
          )}
          {overall.verdict === "limit" && <>{t("detail.machine.hitLimit")}</>}
        </span>
      </div>

      {featured && m.storages.length > 0 && (
        <div className="storages">
          {m.storages.map((s, i) => (
            <div className="storage-row" key={s.id}>
              <span
                className="storage-name"
                title={t(isReadOnlyTape(s) ? "detail.machine.storageType.readOnlyTape" : `detail.machine.storageType.${s.type}`)}
              >
                {s.id}
                {s.type === "stack" ? " ⊓" : s.type === "queue" ? " ⇉" : ""}
              </span>
              <StorageCells spec={s} st={featured.storages[i]} />
            </div>
          ))}
        </div>
      )}

      {featured?.fellOff !== undefined && (
        <div style={{ marginTop: 8, fontSize: 12.5, color: "var(--danger)" }}>
          {t("detail.machine.fellOff", { id: featured.fellOff })}
        </div>
      )}

      <div style={{ marginTop: 8, fontSize: 12.5, color: "var(--muted)" }}>
        {analysis.isDeterministic
          ? t("detail.machine.step", { n: history.length - 1 })
          : t("detail.machine.nondeterministicStepInfo", { n: history.length - 1, count: configs.length })}
      </div>

      <div className="config-list">
        {configs.length === 0 && (
          <div style={{ color: "var(--danger)" }}>{t("detail.machine.noMoreBranches")}</div>
        )}
        {configs.slice(0, 40).map((c, i) => (
          <div
            key={i}
            className={`config-item clickable ${isAcceptingMachineConfig(m, c, input) ? "accepting" : ""} ${
              configs.length > 1 && i === Math.min(selected, configs.length - 1) ? "selected" : ""
            }`}
            onClick={() => setSelected(i)}
            title={t("detail.machine.showConfigStorages")}
          >
            <span>
              <span className="cfg-label">{t("detail.fsm.state")} </span>
              <span className="cfg-state">{rich(c.state)}</span>
            </span>
            {c.fellOff !== undefined && (
              <span style={{ color: "var(--danger)" }}>{t("detail.machine.fellOffShort", { id: c.fellOff })}</span>
            )}
            {head && (
              <span>
                <span className="cfg-label">{t("detail.machine.remainingInput")} </span>
                {input.slice(c.pos) || EPS}
              </span>
            )}
            {m.storages.map((s, j) => (
              <span key={s.id}>
                <span className="cfg-label">
                  {s.id}
                  {s.type === "stack" ? ` (${t("detail.machine.topLeft")}) ` : s.type === "queue" ? ` (${t("detail.machine.frontLeft")}) ` : " "}
                </span>
                {rich(storageText(s, c.storages[j]))}
              </span>
            ))}
          </div>
        ))}
        {configs.length > 40 && (
          <div style={{ color: "var(--muted)", fontSize: 12.5 }}>{t("detail.machine.moreConfigs", { count: configs.length - 40 })}</div>
        )}
      </div>
    </>
  );

  return (
    <Stage
      graph={
        <GraphView spec={spec} cellId={cellId} editing={editing} exportName={m.name} />
      }
      chips={chips}
      panels={panels}
      bottom={bottom}
    />
  );
};
