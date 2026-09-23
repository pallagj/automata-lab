import type { TFunction } from "i18next";
import { MachineCaps } from "../core/machine/machine";

/** Display label for a machine's recognized kind (automaton / pushdown automaton / Turing machine / general machine). */
export function machineKindLabel(t: TFunction, caps: MachineCaps, lowercase = false): string {
  const key = lowercase ? "detail.machine.kindLower" : "detail.machine.kind";
  if (caps.kind === "fsm") return t(`${key}.fsm`);
  if (caps.kind === "pda") return t(`${key}.pda`);
  if (caps.kind === "tm") return t(`${key}.tm`);
  const c = caps.storageCounts ?? {};
  const parts: string[] = [];
  if (c.stack) parts.push(t("detail.machine.storageCount.stack", { count: c.stack }));
  if (c.queue) parts.push(t("detail.machine.storageCount.queue", { count: c.queue }));
  if (c.tape) parts.push(t("detail.machine.storageCount.tape", { count: c.tape }));
  return parts.length > 0
    ? t(`${key}.generalWith`, { parts: parts.join(", ") })
    : t(`${key}.general`);
}
