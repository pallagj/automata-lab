import { useMemo } from "react";
import { fieldsToTokens, tokensToFields } from "../editor/opFields";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { activeWorkspace, useAppStore } from "../../state/store";
import {
  draftStorages,
  EntityDraft,
  parseEntityDraft,
  serializeEntityDraft
} from "../editor/EntityForm";
import { StorageSpec } from "../../core/machine/machine";

/**
 * Visual graph editing: modifies the active cell's YAML definition with
 * structured operations (add, change, delete states/transitions), so the
 * form, code and graph views always stay in sync.
 */

export interface StatePatch {
  name: string;
  isInit: boolean;
  isAccept: boolean;
}

/** One input field of the transition dialog. */
export interface EdgeField {
  label: string;
  placeholder: string;
  widget: "text" | "move";
}

/** The "middle part" of a transition split into dialog fields (see edgeFields). */
export type EdgeMiddle = string[];

export interface GraphEditing {
  states: string[];
  /** fields of the transition dialog — generated from the machine's storages */
  edgeFields: EdgeField[];
  getState(name: string): StatePatch;
  /** returns an error message on failure */
  addState(p: StatePatch, x: number, y: number): string | null;
  updateState(oldName: string, p: StatePatch): string | null;
  deleteState(name: string): void;
  getEdge(from: string, to: string): EdgeMiddle[];
  /** empty list = delete every from→to transition */
  setEdge(from: string, to: string, middles: EdgeMiddle[]): void;
}

const list = (s: string) => s.split(",").map((x) => x.trim()).filter(Boolean);

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

/** The dialog's fields: input symbol + the sub-fields of each storage's operation. */
export function edgeFieldsFor(t: TFunction, hasHead: boolean, storages: Pick<StorageSpec, "id" | "type">[]): EdgeField[] {
  const fields: EdgeField[] = [];
  if (hasHead) fields.push({ label: t("graph.edgeFields.symbol"), placeholder: "a", widget: "text" });
  for (const s of storages) {
    if (s.type === "stack") {
      fields.push({ label: t("graph.edgeFields.stackPop", { id: s.id }), placeholder: "Z", widget: "text" });
      fields.push({ label: t("graph.edgeFields.stackPush", { id: s.id }), placeholder: "AZ", widget: "text" });
    } else if (s.type === "queue") {
      fields.push({ label: t("graph.edgeFields.queuePop", { id: s.id }), placeholder: "A", widget: "text" });
      fields.push({ label: t("graph.edgeFields.queuePush", { id: s.id }), placeholder: "B", widget: "text" });
    } else {
      fields.push({ label: t("graph.edgeFields.tapeRead", { id: s.id }), placeholder: "a", widget: "text" });
      fields.push({ label: t("graph.edgeFields.tapeWrite", { id: s.id }), placeholder: "b", widget: "text" });
      fields.push({ label: t("graph.edgeFields.move"), placeholder: ">", widget: "move" });
    }
  }
  return fields;
}

export function useGraphEditing(): {
  cellId: string | null;
  editing: GraphEditing | null;
} {
  const { t } = useTranslation();
  const activeCellId = useAppStore((s) => s.activeCellId);
  const ws = useAppStore(activeWorkspace);
  const setCellSource = useAppStore((s) => s.setCellSource);
  const setNodePos = useAppStore((s) => s.setNodePos);

  const cell = ws.cells.find((c) => c.id === activeCellId) ?? null;
  const draft = useMemo(() => (cell ? parseEntityDraft(cell.source) : null), [cell?.source]);

  if (!cell || !draft || draft.kind !== "machine") {
    return { cellId: activeCellId, editing: null };
  }

  const storages = draftStorages(draft);
  const hasHead = draft.input === "head";

  const commit = (d: EntityDraft) => setCellSource(cell.id, serializeEntityDraft(d));
  const states = list(draft.states);
  const accept = list(draft.accept);
  const init = draft.init.trim();

  const middleOf = (r: string[]): EdgeMiddle => tokensToFields(hasHead, storages, r.slice(1, -1));
  const rowOf = (from: string, to: string, m: EdgeMiddle): string[] => [
    from,
    ...fieldsToTokens(hasHead, storages, m),
    to
  ];

  /** shared state-field update based on name/init/accept */
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
    if (name === "") return t("graph.validation.emptyName");
    if (/[\s,]/.test(name)) return t("graph.validation.noSpaceComma");
    if (states.includes(name) && name !== ignore) return t("graph.validation.duplicateName", { name });
    return null;
  };

  const lastIdx = (r: string[]) => r.length - 1;

  const editing: GraphEditing = {
    states,
    edgeFields: edgeFieldsFor(t, hasHead, storages),

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
      // unticking the start state is not silently allowed: it stays as it was
      let nextAccept = accept.map(renamed);
      nextAccept = p.isAccept
        ? nextAccept.includes(p.name)
          ? nextAccept
          : [...nextAccept, p.name]
        : nextAccept.filter((s) => s !== p.name);
      const rows = draft.rows.map((r) => {
        const c = [...r];
        if (c[0] === oldName) c[0] = p.name;
        if (c[lastIdx(c)] === oldName) c[lastIdx(c)] = p.name;
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
      const rows = draft.rows.filter((r) => r[0] !== name && r[lastIdx(r)] !== name);
      commit({ ...applyState(draft, nextStates, nextInit, nextAccept), rows });
    },

    getEdge: (from, to) =>
      draft.rows.filter((r) => r[0] === from && r[lastIdx(r)] === to).map(middleOf),

    setEdge: (from, to, middles) => {
      const keep = draft.rows.filter((r) => !(r[0] === from && r[lastIdx(r)] === to));
      const added = middles
        .filter((m) => m.some((f) => f.trim() !== ""))
        .map((m) => rowOf(from, to, m.map((f) => f.trim())));
      commit({ ...draft, rows: [...keep, ...added] });
    }
  };

  return { cellId: activeCellId, editing };
}
