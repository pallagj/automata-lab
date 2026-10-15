import React from "react";
import { Cpu, Equal, Layers, ListTree, LucideIcon, Quote, RectangleEllipsis, Regex, Workflow } from "lucide-react";

/** What a cell or worksheet holds — shown as a small coloured badge. */
export type ValueKind = "fsm" | "pda" | "tm" | "general" | "grammar" | "regex" | "verdict" | "note";

const ICONS: Record<ValueKind, LucideIcon> = {
  fsm: Workflow,
  pda: Layers,
  tm: RectangleEllipsis,
  general: Cpu,
  grammar: ListTree,
  regex: Regex,
  verdict: Equal,
  note: Quote
};

export const KindIcon: React.FC<{ kind: ValueKind; size?: number }> = ({ kind, size = 13 }) => {
  const Icon = ICONS[kind];
  return <Icon size={size} />;
};

/** A round badge in the kind's colour; the title names the kind. */
export const KindBadge: React.FC<{ kind: ValueKind; title?: string; size?: number }> = ({ kind, title, size = 20 }) => (
  <span className={`kind-badge kind-${kind}`} title={title} style={{ width: size, height: size }}>
    <KindIcon kind={kind} size={Math.round(size * 0.6)} />
  </span>
);
