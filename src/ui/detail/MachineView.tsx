import React, { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { EPS } from "../../core/types";
import {
  analyzeMachine,
  hasInputHead,
  initialMachineConfig,
  isAcceptingMachineConfig,
  Machine,
  machineCaps,
  MachineConfig,
  machineConfigKey,
  machineMoves,
  machineTransitionLabel,
  runMachine,
  stepMachineConfigs,
  storageOpLabel,
  StorageState,
  TAPE_BLANK,
  TapeState,
  tapeWindow
} from "../../core/machine/machine";
import { GraphEdge, GraphSpec, GraphView } from "../graph/GraphView";
import { useGraphEditing } from "../graph/editing";
import { Stage, StagePanel } from "./Stage";
import { StepsContent } from "./StepsPanel";
import { TapeInput } from "./TapeInput";
import { StepGroup } from "../../core/expr/expression";
import { Check, Layers, ListTree, Play, RotateCcw, StepForward, Table2, Undo2, X } from "lucide-react";
import { machineKindLabel } from "../machineLabels";

const MAX_RUN_LEVELS = 300;

/** Egy tároló tartalmának tömör szövege a konfiguráció-listához. */
function storageText(st: StorageState): string {
  if (typeof st === "string") return st || "ε";
  const w = tapeWindow(st, 8);
  return w.cells.map((c, i) => (i === w.headIndex ? `[${c}]` : c)).join("");
}

/** Egy tároló cellasoros megjelenítése (verem: tető balra, sor: eleje balra). */
const StorageCells: React.FC<{ type: "stack" | "queue" | "tape"; st: StorageState }> = ({ type, st }) => {
  const { t } = useTranslation();
  if (type === "tape") {
    const w = tapeWindow(st as TapeState, 12);
    return (
      <div className="tape">
        {w.cells.map((c, i) => (
          <span key={w.startPos + i} className={`tape-cell ${i === w.headIndex ? "head" : ""}`}>
            {c === TAPE_BLANK ? "␣" : c}
          </span>
        ))}
      </div>
    );
  }
  const content = st as string;
  return (
    <div className="tape">
      {content.length === 0 && <span className="tape-cell empty">ε</span>}
      {[...content].map((c, i) => (
        <span
          key={i}
          className={`tape-cell ${i === 0 ? "head" : ""}`}
          title={i === 0 ? (type === "stack" ? t("detail.machine.top") : t("detail.machine.front")) : undefined}
        >
          {c}
        </span>
      ))}
    </div>
  );
};

export const MachineView: React.FC<{ machine: Machine; stepGroups?: StepGroup[] }> = ({
  machine: m,
  stepGroups
}) => {
  const { t } = useTranslation();
  const { cellId, editing } = useGraphEditing();
  const caps = useMemo(() => machineCaps(m), [m]);
  const analysis = useMemo(() => analyzeMachine(m), [m]);
  const head = hasInputHead(m);

  const [inputState, setInput] = useState("");
  const [historyState, setHistory] = useState<MachineConfig[][]>([[initialMachineConfig(m, "")]]);
  const [selected, setSelected] = useState(0);

  // gépváltáskor render közben nullázunk: a régi konfigurációk tárolói nem
  // illenek az új géphez, egyetlen ilyen képkocka is összeomlana
  const [forMachine, setForMachine] = useState(m);
  const machineChanged = forMachine !== m;
  if (machineChanged) {
    setForMachine(m);
    setInput("");
    setHistory([[initialMachineConfig(m, "")]]);
    setSelected(0);
  }
  // a folyamatban lévő (eldobás előtti) renderben is az új géphez illő adatokkal dolgozunk
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
  const overall = useMemo(() => runMachine(m, input), [m, input]);

  const status: "accepted" | "rejected" | "working" = anyAccepting
    ? "accepted"
    : configs.length === 0 || !anyMove
      ? "rejected"
      : "working";

  const resetWith = (word: string) => {
    setHistory([[initialMachineConfig(m, word)]]);
    setSelected(0);
  };
  const step = () => setHistory((h) => [...h, stepMachineConfigs(m, h[h.length - 1], input)]);
  const stepBack = () => setHistory((h) => (h.length > 1 ? h.slice(0, -1) : h));
  const runToEnd = () => {
    setHistory((h) => {
      const out = [...h];
      for (let i = 0; i < MAX_RUN_LEVELS; i++) {
        const cur = out[out.length - 1];
        if (cur.length === 0 || cur.some((c) => isAcceptingMachineConfig(m, c, input))) break;
        const next = stepMachineConfigs(m, cur, input);
        if (next.length === 0 && cur.every((c) => machineMoves(m, c, input).length === 0)) break;
        out.push(next);
        if (next.length === 0) break;
      }
      return out;
    });
  };

  /** él-kattintás: csak a kattintott él átmeneteivel lépünk (ágválasztás) */
  const stepEdge = (edge: GraphEdge) => {
    if (status !== "working") return;
    const [from, , to] = edge.id.split("⇒");
    const chosen: MachineConfig[] = [];
    const seen = new Set<string>();
    for (const ms of movesPerConfig) {
      for (const { config, transition } of ms) {
        if (transition.from !== from || transition.to !== to) continue;
        const key = machineConfigKey(config);
        if (!seen.has(key)) {
          seen.add(key);
          chosen.push(config);
        }
      }
    }
    if (chosen.length > 0) setHistory((h) => [...h, chosen]);
  };

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
      g.labels.push(machineTransitionLabel(m, t));
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
        label: g.labels.join("  ·  "),
        active: g.active,
        clickable: g.active
      }))
    };
  }, [m, configs, movesPerConfig, status]);

  const chips = (
    <>
      <span className="stage-title">
        {machineKindLabel(t, caps)} — {m.name}
      </span>
      <span className="badge accent">{t("detail.fsm.stateCount", { count: m.states.length })}</span>
      {m.storages
        .filter((s) => s.init !== "")
        .map((s) => (
          <span key={s.id} className="badge accent" title={t("detail.machine.initialContentHint", { id: s.id })}>
            {t("detail.machine.initial")} {s.id}: {s.init}
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
                  .map((n) => `${n.state}: ${n.detail}`)
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
                    {s.id} ({t(`detail.machine.storageType.${s.type}`)})
                  </th>
                ))}
                <th>{t("detail.machine.to")}</th>
              </tr>
            </thead>
            <tbody>
              {m.transitions.map((t, i) => (
                <tr key={i}>
                  <td>{t.from}</td>
                  {head && <td>{t.input}</td>}
                  {t.ops.map((op, j) => (
                    <td key={j}>{storageOpLabel(op)}</td>
                  ))}
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
          <ListTree size={14} /> {t("detail.fsm.howWasThisBuilt")}
        </>
      ),
      content: <StepsContent stepGroups={stepGroups} />
    });
  }

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
        <button className="sim-btn" onClick={runToEnd} disabled={status !== "working"} title={t("detail.fsm.runAll")}>
          <Play size={16} />
        </button>
        <span
          className={`verdict-pill ${overall.verdict === "accepted" ? "accepted" : overall.verdict === "rejected" ? "rejected" : "limit"}`}
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
              <span className="storage-name" title={t(`detail.machine.storageType.${s.type}`)}>
                {s.id}
                {s.type === "stack" ? " ⊓" : s.type === "queue" ? " ⇉" : ""}
              </span>
              <StorageCells type={s.type} st={featured.storages[i]} />
            </div>
          ))}
        </div>
      )}

      <div style={{ marginTop: 8, fontSize: 12.5, color: "var(--muted)" }}>
        {analysis.isDeterministic
          ? t("detail.machine.step", { n: history.length - 1 })
          : t("detail.machine.nondeterministicStepInfo", { n: history.length - 1, count: configs.length })}
        {status === "working" && spec.edges.some((e) => e.clickable) && ` · ${t("detail.fsm.branchTip")}`}
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
              <span className="cfg-state">{c.state}</span>
            </span>
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
                {storageText(c.storages[j])}
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
        <GraphView spec={spec} onEdgeClick={stepEdge} cellId={cellId} editing={editing} exportName={m.name} />
      }
      chips={chips}
      panels={panels}
      bottom={bottom}
    />
  );
};
