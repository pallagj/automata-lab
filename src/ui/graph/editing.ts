import { useMemo } from "react";
import { activeWorkspace, useAppStore } from "../../state/store";
import {
  EntityDraft,
  EntityKind,
  parseEntityDraft,
  serializeEntityDraft
} from "../editor/EntityForm";

/**
 * Vizuális gráf-szerkesztés: az aktív cella YAML-definícióját módosítja
 * strukturált műveletekkel (állapot/átmenet hozzáadás, átírás, törlés),
 * így az űrlap-, a kód- és a gráfnézet mindig szinkronban marad.
 */

export interface StatePatch {
  name: string;
  isInit: boolean;
  isAccept: boolean;
}

/**
 * Egy átmenet „középrésze” mezőkre bontva:
 *  - fsm: [jel]
 *  - pda: [olvasott jel, verem teteje (le), verembe (fel)]
 *  - tm:  [olvas, ír, mozgás (> < =)]
 */
export type EdgeMiddle = string[];

export interface GraphEditing {
  kind: "fsm" | "pda" | "tm";
  states: string[];
  getState(name: string): StatePatch;
  /** hiba esetén hibaüzenettel tér vissza */
  addState(p: StatePatch, x: number, y: number): string | null;
  updateState(oldName: string, p: StatePatch): string | null;
  deleteState(name: string): void;
  getEdge(from: string, to: string): EdgeMiddle[];
  /** üres lista = az összes from→to átmenet törlése */
  setEdge(from: string, to: string, middles: EdgeMiddle[]): void;
}

const list = (s: string) => s.split(",").map((x) => x.trim()).filter(Boolean);

const splitSlash = (s: string): [string, string] => {
  const i = s.indexOf("/");
  return i >= 0 ? [s.slice(0, i), s.slice(i + 1)] : [s, ""];
};

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

export { suggestStateName };

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
  const states = list(draft.states);
  const accept = list(draft.accept);
  const init = draft.init.trim();
  const lastIdx = kind === "fsm" ? 2 : 3;

  const middleOf = (r: string[]): EdgeMiddle => {
    if (kind === "fsm") return [r[1]];
    if (kind === "pda") return [r[1], ...splitSlash(r[2])];
    return [...splitSlash(r[1]), r[2]]; // tm
  };

  const rowOf = (from: string, to: string, m: EdgeMiddle): string[] => {
    if (kind === "fsm") return [from, m[0], to];
    if (kind === "pda") return [from, m[0], `${m[1]}/${m[2]}`, to];
    return [from, `${m[0]}/${m[1]}`, m[2], to]; // tm
  };

  /** közös állapot-mező frissítés név/init/accept alapján */
  const applyState = (
    d: EntityDraft,
    nextStates: string[],
    nextInit: string,
    nextAccept: string[]
  ): EntityDraft => ({
    ...d,
    states: nextStates.join(", "),
    init: nextInit,
    accept: nextAccept.join(", ")
  });

  const validateName = (name: string, ignore?: string): string | null => {
    if (name === "") return "Az állapot neve nem lehet üres.";
    if (/[\s,]/.test(name)) return "A névben ne legyen szóköz vagy vessző.";
    if (states.includes(name) && name !== ignore) return `Már létezik „${name}” nevű állapot.`;
    return null;
  };

  const editing: GraphEditing = {
    kind,
    states,

    getState: (name) => ({
      name,
      isInit: init === name,
      isAccept: accept.includes(name)
    }),

    addState: (p, x, y) => {
      const err = validateName(p.name);
      if (err) return err;
      setNodePos(cell.id, p.name, x, y);
      commit(
        applyState(
          draft,
          [...states, p.name],
          p.isInit || init === "" ? p.name : init,
          p.isAccept ? [...accept, p.name] : accept
        )
      );
      return null;
    },

    updateState: (oldName, p) => {
      const err = validateName(p.name, oldName);
      if (err) return err;
      const renamed = (s: string) => (s === oldName ? p.name : s);
      const nextStates = states.map(renamed);
      let nextInit = renamed(init);
      if (p.isInit) nextInit = p.name;
      // a kezdőállapot kipipálását nem engedjük el némán: marad, ami volt
      let nextAccept = accept.map(renamed);
      nextAccept = p.isAccept
        ? nextAccept.includes(p.name)
          ? nextAccept
          : [...nextAccept, p.name]
        : nextAccept.filter((s) => s !== p.name);
      const rows = draft.rows.map((r) => {
        const c = [...r];
        if (c[0] === oldName) c[0] = p.name;
        if (c[lastIdx] === oldName) c[lastIdx] = p.name;
        return c;
      });
      if (oldName !== p.name) {
        const pos = useAppStore.getState().layouts[cell.id]?.[oldName];
        if (pos) setNodePos(cell.id, p.name, pos.x, pos.y);
      }
      commit({ ...applyState(draft, nextStates, nextInit, nextAccept), rows });
      return null;
    },

    deleteState: (name) => {
      const nextStates = states.filter((s) => s !== name);
      const nextInit = init === name ? (nextStates[0] ?? "") : init;
      const nextAccept = accept.filter((s) => s !== name);
      const rows = draft.rows.filter((r) => r[0] !== name && r[lastIdx] !== name);
      commit({ ...applyState(draft, nextStates, nextInit, nextAccept), rows });
    },

    getEdge: (from, to) =>
      draft.rows.filter((r) => r[0] === from && r[lastIdx] === to).map(middleOf),

    setEdge: (from, to, middles) => {
      const keep = draft.rows.filter((r) => !(r[0] === from && r[lastIdx] === to));
      const added = middles
        .filter((m) => m.some((f) => f.trim() !== ""))
        .map((m) => rowOf(from, to, m.map((f) => f.trim())));
      commit({ ...draft, rows: [...keep, ...added] });
    }
  };

  return { cellId: activeCellId, editing };
}
