import React from "react";
import { CellResult } from "../../core/workspace";
import { FSMView } from "./FSMView";
import { PDAView } from "./PDAView";
import { TMView } from "./TMView";
import { GrammarView } from "./GrammarView";
import { VerdictView } from "./VerdictView";
import { StepsPanel } from "./StepsPanel";

export const DetailPane: React.FC<{ result: CellResult | null }> = ({ result }) => {
  if (!result || result.empty) {
    return (
      <div className="empty-hint">
        <div className="big">⟿</div>
        Válassz egy cellát balra, vagy hozz létre újat a <b>Példák</b> menüből.
        <br />
        Minden munkád automatikusan, offline mentődik.
      </div>
    );
  }

  if (!result.value) {
    return (
      <div className="empty-hint">
        <div className="big">⚠️</div>
        A cella még nem értékelhető ki — a hibák a cella alatt olvashatók, javítási javaslattal.
      </div>
    );
  }

  const v = result.value;

  return (
    <>
      {v.kind === "fsm" && <FSMView fsm={v} />}
      {v.kind === "pda" && <PDAView pda={v} />}
      {v.kind === "tm" && <TMView tm={v} />}
      {v.kind === "grammar" && <GrammarView grammar={v} />}
      {v.kind === "verdict" && <VerdictView verdict={v} />}
      <StepsPanel stepGroups={result.stepGroups} />
    </>
  );
};
