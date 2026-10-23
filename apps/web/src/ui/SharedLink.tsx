import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { RotateCw, X } from "lucide-react";
import { useAppStore } from "../state/store";
import { fetchShared, OpenOutcome, sharedIdInPath } from "../state/sharing";

type Status = { t: "opening" } | { t: "failed"; reason: Exclude<OpenOutcome, { ok: true }>["reason"] } | null;

/**
 * A page opened from a share link (/w/<id>) fetches the worksheet and opens it among the
 * visitor's own; the address goes back to the app's, so a reload does not fetch it again.
 */
export const SharedLinkOpener: React.FC = () => {
  const { t } = useTranslation();
  const [status, setStatus] = useState<Status>(null);

  useEffect(() => {
    const id = sharedIdInPath(window.location.pathname);
    if (!id) return;
    setStatus({ t: "opening" });
    void fetchShared(id).then((r) => {
      if (r.ok) {
        useAppStore.getState().openShared(id, r.worksheet);
        window.history.replaceState(null, "", "/");
        setStatus(null);
      } else setStatus({ t: "failed", reason: r.reason });
    });
  }, []);

  if (!status) return null;
  if (status.t === "opening")
    return (
      <div className="outdated-banner shared-banner" role="status">
        {t("shared.opening")}
      </div>
    );
  const close = () => {
    window.history.replaceState(null, "", "/");
    setStatus(null);
  };
  return (
    <div className="outdated-banner" role="alert">
      {t(`shared.error.${status.reason}`)}
      {(status.reason === "offline" || status.reason === "failed" || status.reason === "newer") && (
        <button onClick={() => window.location.reload()}>
          <RotateCw size={14} /> {t("app.reload")}
        </button>
      )}
      <button onClick={close} aria-label={t("share.close")}>
        <X size={14} />
      </button>
    </div>
  );
};
