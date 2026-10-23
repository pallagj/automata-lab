import React, { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { Check, Copy, Link2, X } from "lucide-react";
import { WORKSHEET_LIMITS } from "@automatalab/core/worksheet/document";
import { sharePath } from "@automatalab/core/worksheet/shareLink";
import { activeWorkspace, useAppStore } from "../state/store";
import { currentShare, fingerprint, shareDocument, sharedDocument, ShareOutcome } from "../state/sharing";

type Phase =
  | { t: "ask" }
  | { t: "making" }
  | { t: "ready"; url: string; reused: boolean }
  | { t: "failed"; reason: Exclude<ShareOutcome, { ok: true }>["reason"] };

/**
 * Shares the active worksheet as it is now. Nothing leaves the browser until the button
 * is pressed; a worksheet unchanged since its last link shows that link instead.
 */
export const ShareDialog: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const linkRef = useRef<HTMLInputElement>(null);
  const origin = window.location.origin;

  // the worksheet as the dialog opened on it: the dialog covers the editor, so it stays so
  const { ws, doc } = useMemo(() => {
    const s = useAppStore.getState();
    const ws = activeWorkspace(s);
    return { ws, doc: sharedDocument(ws, s.layouts) };
  }, []);

  const [phase, setPhase] = useState<Phase>(() => {
    const id = currentShare(ws, doc);
    return id ? { t: "ready", url: origin + sharePath(id), reused: true } : { t: "ask" };
  });

  const share = async () => {
    setPhase({ t: "making" });
    const r = await shareDocument(doc, origin);
    if (!r.ok) return setPhase({ t: "failed", reason: r.reason });
    useAppStore.getState().rememberShare(ws.id, { id: r.id, fingerprint: fingerprint(doc) });
    setPhase({ t: "ready", url: r.url, reused: false });
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    if (phase.t === "ready") linkRef.current?.select();
  }, [phase.t]);

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
          {phase.t === "ready" ? (
            <>
              <div className="share-link">
                <input
                  ref={linkRef}
                  readOnly
                  value={phase.url}
                  onFocus={(e) => e.currentTarget.select()}
                  aria-label={t("share.link")}
                />
                <button className="gd-btn primary" onClick={() => copy(phase.url)}>
                  {copied ? <Check size={14} /> : <Copy size={14} />} {copied ? t("share.copied") : t("share.copy")}
                </button>
              </div>
              {phase.reused && <p className="share-status">{t("share.current")}</p>}
            </>
          ) : (
            <p className="share-status">{t("share.intro")}</p>
          )}
          {phase.t === "failed" && (
            <div className="gd-error" role="alert">
              {t(`share.error.${phase.reason}`, { cells: WORKSHEET_LIMITS.cells, chars: WORKSHEET_LIMITS.source })}
            </div>
          )}
          <p className="gd-note">{t("share.note")}</p>
        </div>
        {phase.t !== "ready" && !(phase.t === "failed" && phase.reason === "too_large") && (
          <div className="gd-actions">
            <span className="spacer" />
            <button className="gd-btn primary share-create" onClick={share} disabled={phase.t === "making"}>
              <Link2 size={14} />{" "}
              {phase.t === "making" ? t("share.creating") : phase.t === "failed" ? t("share.retry") : t("share.create")}
            </button>
          </div>
        )}
      </div>
    </div>,
    document.body
  );
};
