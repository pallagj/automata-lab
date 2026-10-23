import React, { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { Check, Copy, Link2, X } from "lucide-react";
import { WORKSHEET_LIMITS } from "@automatalab/core/worksheet/document";
import { activeWorkspace, useAppStore } from "../state/store";
import { shareDocument, sharedDocument, ShareOutcome } from "../state/sharing";

/** Shares the active worksheet as it is now: makes its link at once, ready to copy. */
export const ShareDialog: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const { t } = useTranslation();
  const [outcome, setOutcome] = useState<ShareOutcome | null>(null);
  const [copied, setCopied] = useState(false);
  const linkRef = useRef<HTMLInputElement>(null);

  const share = useCallback(() => {
    setOutcome(null);
    const s = useAppStore.getState();
    void shareDocument(sharedDocument(activeWorkspace(s), s.layouts), window.location.origin).then(setOutcome);
  }, []);

  useEffect(share, [share]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    if (outcome?.ok) linkRef.current?.select();
  }, [outcome]);

  const copy = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      // no clipboard access (an insecure page, an old browser): the link stays selected to copy by hand
      linkRef.current?.select();
      return;
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  };

  return createPortal(
    <div className="modal-back" onClick={onClose}>
      <div className="modal gdialog share-dialog" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <div className="gd-head">
          <h2>
            <Link2 size={17} /> {t("share.title")}
          </h2>
          <button className="icon-btn" onClick={onClose} aria-label={t("share.close")}>
            <X size={15} />
          </button>
        </div>
        <div className="gd-body">
          {outcome === null && <p className="share-status">{t("share.creating")}</p>}
          {outcome?.ok && (
            <div className="share-link">
              <input ref={linkRef} readOnly value={outcome.url} onFocus={(e) => e.currentTarget.select()} aria-label={t("share.link")} />
              <button className="gd-btn primary" onClick={() => copy(outcome.url)}>
                {copied ? <Check size={14} /> : <Copy size={14} />} {copied ? t("share.copied") : t("share.copy")}
              </button>
            </div>
          )}
          {outcome && !outcome.ok && (
            <div className="gd-error" role="alert">
              {t(`share.error.${outcome.reason}`, { cells: WORKSHEET_LIMITS.cells, chars: WORKSHEET_LIMITS.source })}
            </div>
          )}
          <p className="gd-note">{t("share.note")}</p>
        </div>
        {outcome && !outcome.ok && outcome.reason !== "too_large" && (
          <div className="gd-actions">
            <span className="spacer" />
            <button className="gd-btn" onClick={share}>
              {t("share.retry")}
            </button>
          </div>
        )}
      </div>
    </div>,
    document.body
  );
};
