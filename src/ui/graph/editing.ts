import { useMemo } from "react";
import { activeWorkspace, useAppStore } from "../../state/store";
import {
  EntityDraft,
  EntityKind,
  parseEntityDraft,
  serializeEntityDraft
} from "../editor/EntityForm";
import { GraphEdge, GraphEditing } from "./GraphView";

/**
 * Vizuális gráf-szerkesztés bekötése: az aktív cella YAML-definícióját
 * módosítja (állapot felvétele, átmenet húzása, címke átírása/törlése),
 * így az űrlap-, a kód- és a gráfnézet mindig szinkronban marad.
 */

function suggestStateName(used: Set<string>): string {
  if (used.size > 0 && [...used].every((s) => /^q\d+$/.test(s))) {
    let i = 0;
    while (used.has(`q${i}`)) i++;
    return `q${i}`;
  }
  for (const c of "ABCDEFGHIJKLMNOPQRSTUVWXYZ") if (!used.has(c)) return c;
  let i = 0;
  while (used.has(`s${i}`)) i++;
  return `s${i}`;
}

/** a kérdés szövege és példa az átmenet „közepére” géptípusonként */
const MIDDLE_HINT: Record<EntityKind, [string, string]> = {
  fsm: ["Átmenet jele(i), vesszővel elválasztva (ε: $):", "a"],
  pda: ["Átmenet: „jel veremtető/verembe” — pl. a Z/AZ (ε: $); többet pontosvesszővel:", "a Z/AZ"],
  tm: ["Átmenet: „olvas/ír mozgás” — pl. a/b > (mozgás: > < =); többet pontosvesszővel:", "a/a >"],
  grammar: ["", ""]
};

export function useGraphEditing(kind: EntityKind): {
  cellId: string | null;
  editing: GraphEditing | null;
} {
  const activeCellId = useAppStore((s) => s.activeCellId);
  const ws = useAppStore(activeWorkspace);
  const setCellSource = useAppStore((s) => s.setCellSource);
  const setNodePos = useAppStore((s) => s.setNodePos);

  const cell = ws.cells.find((c) => c.id === activeCellId) ?? null;
  const draft = useMemo(() => (cell ? parseEntityDraft(cell.source) : null), [cell?.source]);

  if (!cell || !draft || draft.kind !== kind || kind === "grammar") {
    return { cellId: activeCellId, editing: null };
  }

  const commit = (d: EntityDraft) => setCellSource(cell.id, serializeEntityDraft(d));
  const states = draft.states.split(",").map((s) => s.trim()).filter(Boolean);
  const middleLen = kind === "fsm" ? 1 : 2;
  const sep = kind === "fsm" ? "," : ";";

  /** „közép”-szöveg(ek) → teljes átmenet-sorok */
  const middlesToRows = (from: string, to: string, text: string): string[][] =>
    text
      .split(sep)
      .map((s) => s.trim())
      .filter(Boolean)
      .map((mid) => {
        const parts = kind === "fsm" ? [mid] : mid.split(/\s+/);
        while (parts.length < middleLen) parts.push("");
        return [from, ...parts.slice(0, middleLen), to];
      });

  const editing: GraphEditing = {
    addState: (x, y) => {
      const used = new Set(states);
      const name = prompt("Új állapot neve:", suggestStateName(used))?.trim();
      if (!name) return;
      if (used.has(name)) {
        alert(`Már létezik „${name}” nevű állapot.`);
        return;
      }
      setNodePos(cell.id, name, x, y);
      commit({
        ...draft,
        states: states.length === 0 ? name : `${draft.states.trim()}, ${name}`,
        init: draft.init.trim() === "" ? name : draft.init
      });
    },

    connect: (from, to) => {
      const [hint, example] = MIDDLE_HINT[kind];
      const text = prompt(hint, example);
      if (text === null || text.trim() === "") return;
      commit({ ...draft, rows: [...draft.rows, ...middlesToRows(from, to, text)] });
    },

    editEdge: (edge: GraphEdge) => {
      const last = middleLen + 1;
      const matches = draft.rows
        .map((r, i) => ({ r, i }))
        .filter(({ r }) => r[0] === edge.from && r[last] === edge.to);
      if (matches.length === 0) return;
      const current = matches
        .map(({ r }) => r.slice(1, last).join(" "))
        .join(`${sep} `);
      const [hint] = MIDDLE_HINT[kind];
      const text = prompt(`${hint}\n(Üresre törölve az átmenet törlődik.)`, current);
      if (text === null) return;
      const keep = draft.rows.filter((_, i) => !matches.some((m) => m.i === i));
      const rows =
        text.trim() === "" ? keep : [...keep, ...middlesToRows(edge.from, edge.to, text)];
      commit({ ...draft, rows });
    }
  };

  return { cellId: activeCellId, editing };
}
