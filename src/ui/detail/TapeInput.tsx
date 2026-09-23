import React, { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Pencil } from "lucide-react";

/**
 * Közvetlenül szerkeszthető szalag: a bemeneti szó cellákként jelenik meg,
 * a cellára kattintva oda ugrik a kurzor és azonnal gépelhetsz — a tényleges
 * szöveget egy láthatatlan input tartja, így a billentyűzet-kezelés natív.
 */

interface Props {
  value: string;
  onChange: (v: string) => void;
  /** az olvasófej pozíciója a szimulációban (kiemelés); undefined = nincs fej */
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
