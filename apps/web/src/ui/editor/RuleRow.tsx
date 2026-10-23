import React, { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { Plus, X } from "lucide-react";
import { SymbolField } from "./SymbolField";
import { caretAt, focusField } from "./formNav";

/**
 * One rule of a grammar: its left-hand side and the alternatives of its right-hand side, each
 * a field of its own with | drawn between them — A → α | β as in the lecture notes, or a row
 * under RuleHead. Typing | starts the next alternative and Backspace at an alternative's start
 * joins it to the one before, as if the | were text; + adds one at the end. In the YAML the rule stays one line (S -> aS | b); an alternative
 * left empty is not written.
 */

/** The column headers over table rows. */
export const RuleHead: React.FC = () => {
  const { t } = useTranslation();
  return (
    <div className="ef-row ef-row-head ef-rule-head">
      <span>{t("editor.form.col.leftSide")}</span>
      <span>{t("editor.form.col.rightSide")}</span>
      <span />
    </div>
  );
};

export const RuleRow: React.FC<{
  /** A → α | β as in the lecture notes, or a row under RuleHead */
  notation: boolean;
  left: string;
  /** the right-hand side's alternatives, at least one */
  right: string[];
  onLeft: (v: string) => void;
  onRight: (alternatives: string[]) => void;
  onRemove: () => void;
  /** whether a digit typed after a letter goes to the subscript */
  digits: (ch: string) => boolean;
}> = ({ notation, left, right, onLeft, onRight, onRemove, digits }) => {
  const { t } = useTranslation();
  const altsRef = useRef<HTMLDivElement>(null);
  // the alternative that takes the caret once it exists: after |, +, or a removal
  const focusNext = useRef<{ alt: number; caret: "start" | "end" | number } | null>(null);
  const fields = () => [...(altsRef.current?.querySelectorAll<HTMLElement>(":scope > .sym-field") ?? [])];
  useEffect(() => {
    const next = focusNext.current;
    if (!next) return;
    focusNext.current = null;
    // a new field gets its editor a moment after it appears
    const focus = () => {
      const content = fields()[next.alt]?.querySelector<HTMLElement>(".cm-content");
      if (content) focusField(content, next.caret);
      return !!content;
    };
    if (!focus()) requestAnimationFrame(focus);
  });

  const set = (n: number, v: string) => onRight(right.map((alt, k) => (k === n ? v : alt)));

  // | ends the alternative: what follows it goes to the next one
  const split = (n: number, parts: string[]) => {
    focusNext.current = { alt: n + parts.length - 1, caret: "start" };
    onRight([...right.slice(0, n), ...parts.map((p) => p.trim()), ...right.slice(n + 1)]);
  };

  // Backspace at the start: the | before goes, an empty first alternative too
  const joinBack = (e: React.KeyboardEvent) => {
    if (e.key !== "Backspace" || e.altKey || e.ctrlKey || e.metaKey || right.length < 2) return;
    const n = fields().findIndex((f) => f.contains(e.target as Node));
    if (n < 0 || !caretAt(e.target as HTMLElement, "start")) return;
    if (n === 0 && right[0] !== "") return;
    e.preventDefault();
    if (n === 0) {
      focusNext.current = { alt: 0, caret: "start" };
      onRight(right.slice(1));
    } else {
      focusNext.current = { alt: n - 1, caret: right[n - 1].length };
      onRight([...right.slice(0, n - 1), right[n - 1] + right[n], ...right.slice(n + 1)]);
    }
  };

  const add = () => {
    focusNext.current = { alt: right.length, caret: "start" };
    onRight([...right, ""]);
  };

  return (
    <div className={`ef-row ${notation ? "ef-row-rule" : ""}`}>
      <SymbolField value={left} onChange={onLeft} digits={digits} placeholder="S" />
      {notation && <span className="ef-op">→</span>}
      <div className="ef-alts" ref={altsRef} onKeyDownCapture={joinBack}>
        {right.flatMap((alt, n) => {
          const field = (
            <SymbolField
              key={n}
              value={alt}
              onChange={(v) => set(n, v)}
              onSplit={(parts) => split(n, parts)}
              epsilon
              digits={digits}
              placeholder={n === 0 ? "aS" : "b"}
            />
          );
          return n === 0 ? [field] : [<span key={`bar${n}`} className="ef-op ef-bar">|</span>, field];
        })}
        <button className="ef-alt-add" title={t("editor.form.newAlternative")} onClick={add}>
          <Plus size={12} />
        </button>
      </div>
      <button className="ef-remove" title={t("editor.form.deleteRow")} onClick={onRemove}>
        <X size={13} />
      </button>
    </div>
  );
};
