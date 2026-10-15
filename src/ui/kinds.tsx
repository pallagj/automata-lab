import React from "react";
import {
  Boxes,
  CircleDot,
  Columns3,
  Equal,
  FunctionSquare,
  Layers,
  ListTree,
  LucideIcon,
  Regex,
  StickyNote
} from "lucide-react";

/** What a cell or worksheet holds. One plain, grey icon set used everywhere (cells, Insert menu, browser). */
export type ValueKind = "fsm" | "pda" | "tm" | "general" | "grammar" | "regex" | "verdict" | "expression" | "note";

const ICONS: Record<ValueKind, LucideIcon> = {
  fsm: CircleDot,
  pda: Layers,
  tm: Columns3,
  general: Boxes,
  grammar: ListTree,
  regex: Regex,
  verdict: Equal,
  expression: FunctionSquare,
  note: StickyNote
};

export const KindIcon: React.FC<{ kind: ValueKind; size?: number; title?: string }> = ({ kind, size = 16, title }) => {
  const Icon = ICONS[kind];
  return (
    <span className="kind-icon" title={title}>
      <Icon size={size} />
    </span>
  );
};
