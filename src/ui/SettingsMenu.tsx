import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { Settings } from "lucide-react";
import { useAppStore } from "../state/store";
import { Popover } from "./browser/controls";

/** App settings behind the gear icon in the header. */
export const SettingsMenu: React.FC = () => {
  const { t } = useTranslation();
  const epsilonShortcut = useAppStore((s) => s.epsilonShortcut);
  const setEpsilonShortcut = useAppStore((s) => s.setEpsilonShortcut);
  const [anchor, setAnchor] = useState<DOMRect | null>(null);

  return (
    <>
      <button
        className="icon-btn ghost"
        title={t("settings.title")}
        aria-label={t("settings.title")}
        onClick={(e) => setAnchor(e.currentTarget.getBoundingClientRect())}
      >
        <Settings size={17} />
      </button>
      {anchor && (
        <Popover rect={anchor} width={300} onClose={() => setAnchor(null)}>
          <div className="menu-group">{t("settings.title")}</div>
          <div className="settings-section">
            <label className="settings-toggle">
              <input type="checkbox" checked={epsilonShortcut} onChange={(e) => setEpsilonShortcut(e.target.checked)} />
              <span>
                <code>eps</code> <span className="settings-arrow">→</span> <code>ε</code> {t("settings.epsilon.title")}
              </span>
            </label>
            <p className="settings-hint">{t("settings.epsilon.hint")}</p>
          </div>
        </Popover>
      )}
    </>
  );
};
