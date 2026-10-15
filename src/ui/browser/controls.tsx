import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { Check, ChevronLeft, Folder, FolderPlus } from "lucide-react";

/** Popover rendered in a portal, anchored to a button's rect; opens upwards near the bottom edge. */
export const Popover: React.FC<{ rect: DOMRect; width: number; onClose: () => void; children: React.ReactNode }> = ({
  rect,
  width,
  onClose,
  children
}) => {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  const left = Math.max(8, Math.min(rect.right - width, window.innerWidth - width - 8));
  const openUp = rect.bottom > window.innerHeight * 0.62;
  const style: React.CSSProperties = openUp
    ? { left, width, bottom: window.innerHeight - rect.top + 6 }
    : { left, width, top: rect.bottom + 6 };
  return createPortal(
    <>
      <div className="popover-back" onClick={onClose} />
      <div className="menu popover browser-popover" style={style} onClick={(e) => e.stopPropagation()}>
        {children}
      </div>
    </>,
    document.body
  );
};

/** Inline text input for renaming; Enter/blur commits, Escape cancels. */
export const InlineInput: React.FC<{
  initial: string;
  placeholder?: string;
  onCommit: (value: string) => void;
  onCancel: () => void;
}> = ({ initial, placeholder, onCommit, onCancel }) => {
  const ref = useRef<HTMLInputElement>(null);
  const done = useRef(false);
  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);
  const finish = (commit: boolean) => {
    if (done.current) return;
    done.current = true;
    const v = ref.current?.value.trim() ?? "";
    if (commit && v) onCommit(v);
    else onCancel();
  };
  return (
    <input
      ref={ref}
      className="inline-input"
      defaultValue={initial}
      placeholder={placeholder}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Enter") finish(true);
        if (e.key === "Escape") finish(false);
      }}
      onBlur={() => finish(true)}
    />
  );
};

/** Folder picker for moving worksheets: filter the list or type a new name to create a folder. */
export const MovePanel: React.FC<{
  folders: string[];
  currentFolders: Set<string | undefined>;
  onMove: (folder: string | undefined) => void;
}> = ({ folders, currentFolders, onMove }) => {
  const { t } = useTranslation();
  const [q, setQ] = useState("");
  const query = q.trim();
  const matches = folders.filter((f) => f.toLocaleLowerCase().includes(query.toLocaleLowerCase()));
  const exact = folders.some((f) => f.toLocaleLowerCase() === query.toLocaleLowerCase());
  const onlyIn = currentFolders.size === 1 ? [...currentFolders][0] : null;
  return (
    <div className="move-panel">
      <div className="menu-group">{t("browser.move.title")}</div>
      <input
        autoFocus
        className="move-input"
        value={q}
        placeholder={t("browser.move.placeholder")}
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => {
          if (e.key !== "Enter" || !query) return;
          onMove(exact ? folders.find((f) => f.toLocaleLowerCase() === query.toLocaleLowerCase()) : query);
        }}
      />
      {!query && (
        <button disabled={onlyIn === undefined} onClick={() => onMove(undefined)}>
          <ChevronLeft size={14} /> {t("browser.move.noFolder")}
        </button>
      )}
      {matches.map((f) => (
        <button key={f} disabled={onlyIn === f} onClick={() => onMove(f)}>
          <Folder size={14} /> {f}
          {onlyIn === f && <Check size={14} className="move-current" />}
        </button>
      ))}
      {query && !exact && (
        <button className="move-create" onClick={() => onMove(query)}>
          <FolderPlus size={14} /> {t("browser.move.create", { name: query })}
        </button>
      )}
      {!query && <div className="move-hint">{t("browser.move.hint")}</div>}
    </div>
  );
};
