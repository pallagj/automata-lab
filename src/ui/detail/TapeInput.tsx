import React, { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Pencil } from "lucide-react";

/**
 * Directly editable tape: the input word is shown as cells; clicking a cell moves
 * the cursor there and you can type right away — the actual text lives in an
 * invisible input, so keyboard handling stays native.
 */

interface Props {
  value: string;
  onChange: (v: string) => void;
  /** the read head's position in the simulation (highlight); undefined = no head */
  pos?: number;
  placeholder?: string;
}

export const TapeInput: React.FC<Props> = ({ value, onChange, pos, placeholder }) => {
  const { t } = useTranslation();
  const inputRef = useRef<HTMLInputElement>(null);
  const [focused, setFocused] = useState(false);
  const [caret, setCaret] = useState(0);

  const syncCaret = () => setCaret(inputRef.current?.selectionStart ?? 0);

  const focusAt = (i: number) => (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const el = inputRef.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(i, i);
    setCaret(i);
  };

  return (
    <div
      className={`tape tape-input ${focused ? "editing" : ""}`}
      onMouseDown={focusAt(value.length)}
      title={t("detail.tapeInput.hint")}
    >
      <input
        ref={inputRef}
        className="tape-hidden-input"
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          requestAnimationFrame(syncCaret);
        }}
        onSelect={syncCaret}
        onFocus={() => {
          setFocused(true);
          syncCaret();
        }}
        onBlur={() => setFocused(false)}
        spellCheck={false}
        autoComplete="off"
        aria-label={placeholder ?? t("detail.tapeInput.input")}
      />
      {value.length === 0 && !focused && (
        <span className="tape-cell empty tape-placeholder">{placeholder ?? "ε"}</span>
      )}
      {[...value].map((c, i) => (
        <span
          key={i}
          className={`tape-cell ${pos === i ? "head" : ""} ${pos !== undefined && i < pos ? "done" : ""} ${
            focused && caret === i ? "caret" : ""
          }`}
          onMouseDown={focusAt(i)}
        >
          {c}
        </span>
      ))}
      <span
        className={`tape-cell ghost ${focused && caret === value.length ? "caret" : ""}`}
        onMouseDown={focusAt(value.length)}
      >
        {!focused && <Pencil size={12} />}
      </span>
    </div>
  );
};
