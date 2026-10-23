import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CellHistory,
  CellsSnapshot,
  createActionGate,
  EMPTY_HISTORY,
  HISTORY_LIMIT,
  redoStep,
  remember,
  restoredLayouts,
  TYPING_PAUSE_MS,
  undoStep
} from "./history";

// the store's i18n wants a browser (the history needs no words), and it saves into the window's localStorage
vi.mock("../i18n", () => ({ default: { t: (key: string) => key } }));
const saved = new Map<string, string>();
vi.stubGlobal("window", {
  localStorage: {
    getItem: (key: string) => saved.get(key) ?? null,
    setItem: (key: string, value: string) => void saved.set(key, value),
    removeItem: (key: string) => void saved.delete(key)
  }
});
const { activeWorkspace, canRedo, canUndo, useAppStore } = await import("./store");

const snap = (sources: string[], activeCellId: string | null = "c0", layouts: CellsSnapshot["layouts"] = {}): CellsSnapshot => ({
  cells: sources.map((source, i) => ({ id: `c${i}`, source })),
  activeCellId,
  layouts
});
const sourcesOf = (s: CellsSnapshot) => s.cells.map((c) => c.source);

/** a user action of its own: the action gate closes once the event's code has run */
const nextEvent = () => Promise.resolve();

describe("remembering edits", () => {
  it("an edit remembers the cells before it, and forgets what was undone", () => {
    const before = snap(["M"]);
    const h = remember({ past: [], future: [snap(["X"])] }, before, { at: 0, sameAction: false });
    expect(h.past).toEqual([before]);
    expect(h.future).toEqual([]);
    expect(h.typing).toBeUndefined();
  });

  it("typing on in the same cell without a pause is one step", () => {
    let h: CellHistory = EMPTY_HISTORY;
    h = remember(h, snap([""]), { at: 0, sameAction: false, typingIn: "c0" });
    h = remember(h, snap(["d"]), { at: 300, sameAction: false, typingIn: "c0" });
    h = remember(h, snap(["de"]), { at: 300 + TYPING_PAUSE_MS - 1, sameAction: false, typingIn: "c0" });
    expect(h.past.map(sourcesOf)).toEqual([[""]]);
    expect(h.typing).toEqual({ cellId: "c0", at: 300 + TYPING_PAUSE_MS - 1 });
  });

  it("a pause in typing starts a new step", () => {
    let h: CellHistory = EMPTY_HISTORY;
    h = remember(h, snap([""]), { at: 0, sameAction: false, typingIn: "c0" });
    h = remember(h, snap(["d"]), { at: TYPING_PAUSE_MS, sameAction: false, typingIn: "c0" });
    expect(h.past.map(sourcesOf)).toEqual([[""], ["d"]]);
  });

  it("typing in another cell starts a new step", () => {
    let h: CellHistory = EMPTY_HISTORY;
    h = remember(h, snap(["", ""]), { at: 0, sameAction: false, typingIn: "c0" });
    h = remember(h, snap(["a", ""]), { at: 10, sameAction: false, typingIn: "c1" });
    expect(h.past.map(sourcesOf)).toEqual([
      ["", ""],
      ["a", ""]
    ]);
  });

  it("an action between two bursts of typing in the same cell separates them", () => {
    let h: CellHistory = EMPTY_HISTORY;
    h = remember(h, snap([""]), { at: 0, sameAction: false, typingIn: "c0" });
    h = remember(h, snap(["a"]), { at: 10, sameAction: false });
    h = remember(h, snap(["a", ""]), { at: 20, sameAction: false, typingIn: "c0" });
    expect(h.past.map(sourcesOf)).toEqual([[""], ["a"], ["a", ""]]);
  });

  it("the changes of one user action are one step", () => {
    let h: CellHistory = EMPTY_HISTORY;
    h = remember(h, snap(["M", ""]), { at: 0, sameAction: false });
    h = remember(h, snap(["M"]), { at: 0, sameAction: true });
    expect(h.past.map(sourcesOf)).toEqual([["M", ""]]);
  });

  it("only the newest steps are kept", () => {
    let h: CellHistory = EMPTY_HISTORY;
    for (let i = 0; i < HISTORY_LIMIT + 5; i++) h = remember(h, snap([String(i)]), { at: i, sameAction: false });
    expect(h.past).toHaveLength(HISTORY_LIMIT);
    expect(sourcesOf(h.past[0])).toEqual(["5"]);
    expect(sourcesOf(h.past[HISTORY_LIMIT - 1])).toEqual([String(HISTORY_LIMIT + 4)]);
  });
});

describe("undo and redo", () => {
  it("undo goes back one step and keeps the present for redo", () => {
    const h: CellHistory = { past: [snap(["a"]), snap(["ab"])], future: [] };
    const back = undoStep(h, snap(["abc"]))!;
    expect(sourcesOf(back.to)).toEqual(["ab"]);
    expect(back.history.past.map(sourcesOf)).toEqual([["a"]]);
    expect(back.history.future.map(sourcesOf)).toEqual([["abc"]]);

    const forward = redoStep(back.history, back.to)!;
    expect(sourcesOf(forward.to)).toEqual(["abc"]);
    expect(forward.history.past.map(sourcesOf)).toEqual([["a"], ["ab"]]);
    expect(forward.history.future).toEqual([]);
  });

  it("undoing twice and redoing twice comes back to the start", () => {
    let h: CellHistory = { past: [snap(["1"]), snap(["2"])], future: [] };
    let now = snap(["3"]);
    for (const expected of ["2", "1"]) {
      const step = undoStep(h, now)!;
      [h, now] = [step.history, step.to];
      expect(sourcesOf(now)).toEqual([expected]);
    }
    expect(undoStep(h, now)).toBeNull();
    for (const expected of ["2", "3"]) {
      const step = redoStep(h, now)!;
      [h, now] = [step.history, step.to];
      expect(sourcesOf(now)).toEqual([expected]);
    }
    expect(redoStep(h, now)).toBeNull();
  });

  it("nothing to undo or redo in a new history", () => {
    expect(undoStep(EMPTY_HISTORY, snap(["a"]))).toBeNull();
    expect(redoStep(EMPTY_HISTORY, snap(["a"]))).toBeNull();
  });

  it("a cell brought back gets its pinned graph positions again; others keep theirs", () => {
    const pinned = { c0: { q_0: { x: 1, y: 2 } }, c1: { q_1: { x: 3, y: 4 } } };
    const current = { c0: { q_0: { x: 9, y: 9 } } };
    const layouts = restoredLayouts(current, snap(["M", "N"], "c1", pinned));
    expect(layouts).toEqual({ c0: { q_0: { x: 9, y: 9 } }, c1: { q_1: { x: 3, y: 4 } } });
  });
});

describe("the action gate", () => {
  it("is open for the rest of one event and closes after it", async () => {
    const gate = createActionGate();
    expect(gate()).toBe(false);
    expect(gate()).toBe(true);
    expect(gate()).toBe(true);
    await nextEvent();
    expect(gate()).toBe(false);
    expect(gate()).toBe(true);
  });
});

describe("the worksheet's undo history in the store", () => {
  const store = () => useAppStore.getState();
  const sources = () => activeWorkspace(store()).cells.map((c) => c.source);
  const cellIds = () => activeWorkspace(store()).cells.map((c) => c.id);
  let clock = 0;

  beforeEach(async () => {
    clock = 1_000_000;
    vi.spyOn(Date, "now").mockImplementation(() => clock);
    useAppStore.setState({
      workspaces: [
        { id: "w1", name: "A", cells: [{ id: "a", source: "M" }], createdAt: 0, updatedAt: 0 },
        { id: "w2", name: "B", cells: [{ id: "b", source: "N" }], createdAt: 0, updatedAt: 0 }
      ],
      activeWorkspaceId: "w1",
      activeCellId: "a",
      layouts: {},
      history: {}
    });
    await nextEvent();
  });
  afterEach(() => vi.restoreAllMocks());

  it("typing a word is one step; undo and redo walk it back and forth", async () => {
    for (const s of ["M ", "M =", "M = det(M)"]) {
      clock += 200;
      store().setCellSource("a", s);
      await nextEvent();
    }
    expect(canUndo(store())).toBe(true);
    expect(canRedo(store())).toBe(false);
    store().undo();
    expect(sources()).toEqual(["M"]);
    expect(canUndo(store())).toBe(false);
    expect(canRedo(store())).toBe(true);
    store().redo();
    expect(sources()).toEqual(["M = det(M)"]);
  });

  it("setting a cell's text to what it is does not make a step", () => {
    store().setCellSource("a", "M");
    expect(canUndo(store())).toBe(false);
  });

  it("a new edit after undo drops the redo step", async () => {
    store().setCellSource("a", "M1");
    await nextEvent();
    store().undo();
    await nextEvent();
    clock += TYPING_PAUSE_MS;
    store().setCellSource("a", "M2");
    expect(canRedo(store())).toBe(false);
    store().undo();
    expect(sources()).toEqual(["M"]);
  });

  it("adding, moving and deleting cells are steps of their own", async () => {
    store().addCell("N = det(M)", "a");
    await nextEvent();
    const added = cellIds()[1];
    store().moveCellTo(added, 0);
    await nextEvent();
    expect(sources()).toEqual(["N = det(M)", "M"]);
    store().removeCell("a");
    await nextEvent();
    expect(sources()).toEqual(["N = det(M)"]);

    store().undo();
    expect(sources()).toEqual(["N = det(M)", "M"]);
    expect(store().activeCellId).toBe(added);
    store().undo();
    expect(sources()).toEqual(["M", "N = det(M)"]);
    store().undo();
    expect(sources()).toEqual(["M"]);
    expect(cellIds()).toEqual(["a"]);
    expect(store().activeCellId).toBe("a");
    expect(canUndo(store())).toBe(false);
  });

  it("moving a cell to its own place is no step", () => {
    store().addCell("N", "a");
    const [a] = cellIds();
    useAppStore.setState({ history: {} });
    store().moveCellTo(a, 0);
    store().moveCellTo(a, 1);
    expect(canUndo(store())).toBe(false);
  });

  it("the changes of one action are undone together", () => {
    store().addCell("", "a");
    const added = cellIds()[1];
    store().setCellSource(added, "det(M)");
    store().removeCell("a");
    expect(sources()).toEqual(["det(M)"]);
    store().undo();
    expect(sources()).toEqual(["M"]);
    expect(canUndo(store())).toBe(false);
  });

  it("a deleted cell comes back with its pinned graph positions", async () => {
    store().addCell("N", "a");
    await nextEvent();
    const added = cellIds()[1];
    store().setNodePos(added, "q_0", 10, 20);
    store().removeCell(added);
    await nextEvent();
    expect(store().layouts[added]).toBeUndefined();
    store().undo();
    expect(sources()).toEqual(["M", "N"]);
    expect(store().layouts[added]).toEqual({ q_0: { x: 10, y: 20 } });
  });

  it("each worksheet has its own history", async () => {
    store().setCellSource("a", "M1");
    await nextEvent();
    store().setActiveWorkspace("w2");
    expect(canUndo(store())).toBe(false);
    store().undo();
    expect(sources()).toEqual(["N"]);
    store().setActiveWorkspace("w1");
    expect(canUndo(store())).toBe(true);
    store().undo();
    expect(sources()).toEqual(["M"]);
  });

  it("the history is not saved with the worksheets", () => {
    store().setCellSource("a", "M1");
    expect(canUndo(store())).toBe(true);
    const { state } = JSON.parse(saved.get("automata-lab")!);
    expect(state.workspaces[0].cells).toEqual([{ id: "a", source: "M1" }]);
    expect(state).not.toHaveProperty("history");
  });
});
