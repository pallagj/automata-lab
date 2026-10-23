import { ruleToString } from "@automatalab/core/grammar/grammar";
import { machineCaps } from "@automatalab/core/machine/machine";
import { parseDefinition } from "@automatalab/core/parse/definitionParser";
import type { GraphSpec } from "../graph/GraphView";

/** What a worksheet contains — shown as badges and usable as a filter. */
export type WorksheetKind = "fsm" | "pda" | "tm" | "general" | "grammar" | "regex";
export const WORKSHEET_KINDS: WorksheetKind[] = ["fsm", "pda", "tm", "general", "grammar", "regex"];

export type PreviewContent =
  { t: "graph"; spec: GraphSpec; cellId: string } | { t: "lines"; lines: string[] } | { t: "empty" };

export interface WorksheetSummary {
  preview: PreviewContent;
  kinds: WorksheetKind[];
}

interface CellLike {
  id: string;
  source: string;
}

/** Bigger machines would only render as an unreadable blob at thumbnail size. */
const MAX_PREVIEW_STATES = 40;
const MAX_PREVIEW_LINES = 6;

const cache = new Map<string, WorksheetSummary>();

/**
 * Summarises a worksheet for the browser: a preview of its first definition
 * (graph for machines, rules for grammars, otherwise the first lines of text)
 * and the kinds of objects it defines. Only parses — nothing is evaluated —
 * and results are cached by content, so rendering many cards stays cheap.
 */
export function summarizeCells(cells: CellLike[]): WorksheetSummary {
  const key = cells.map((c) => `${c.id}\u0000${c.source}`).join("\u0001");
  const hit = cache.get(key);
  if (hit) return hit;

  const kinds = new Set<WorksheetKind>();
  let preview: PreviewContent | null = null;
  let firstText: string[] | null = null;

  for (const cell of cells) {
    const src = cell.source.trim();
    if (src === "") continue;
    if (/\bregex\s*\(/.test(src)) kinds.add("regex");
    const parsed = parseDefinition(src);
    const def = parsed?.ok ? parsed.value : undefined;
    if (def?.kind === "machine") {
      kinds.add(machineCaps(def).kind);
      if (!preview && def.states.length > 0 && def.states.length <= MAX_PREVIEW_STATES) {
        const pairs = new Map<string, { from: string; to: string }>();
        for (const tr of def.transitions) pairs.set(`${tr.from}⇒${tr.to}`, { from: tr.from, to: tr.to });
        preview = {
          t: "graph",
          cellId: cell.id,
          spec: {
            nodes: def.states.map((s) => ({ id: s, label: s, accept: def.accept.includes(s), start: s === def.start })),
            edges: [...pairs.entries()].map(([id, p]) => ({ id, from: p.from, to: p.to, label: "" }))
          }
        };
      }
    } else if (def?.kind === "grammar") {
      kinds.add("grammar");
      if (!preview) preview = { t: "lines", lines: def.rules.slice(0, MAX_PREVIEW_LINES).map(ruleToString) };
    }
    if (!firstText) firstText = src.split("\n").slice(0, MAX_PREVIEW_LINES);
  }

  const summary: WorksheetSummary = {
    preview: preview ?? (firstText ? { t: "lines", lines: firstText } : { t: "empty" }),
    kinds: WORKSHEET_KINDS.filter((k) => kinds.has(k))
  };
  if (cache.size > 500) cache.clear();
  cache.set(key, summary);
  return summary;
}
