import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { Check, Settings } from "lucide-react";
import { DefinitionView, FormLabels, useAppStore } from "../state/store";
import { Popover } from "./browser/controls";

const VIEWS: DefinitionView[] = ["form", "code"];
const LABELS: FormLabels[] = ["symbols", "words"];

/** The settings: how definitions open (the form or their YAML code), and the form's labels. */
export const SettingsMenu: React.FC = () => {
  const { t } = useTranslation();
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  const definitionView = useAppStore((s) => s.definitionView);
  const setDefinitionView = useAppStore((s) => s.setDefinitionView);
  const formLabels = useAppStore((s) => s.formLabels);
  const setFormLabels = useAppStore((s) => s.setFormLabels);

  return (
    <>
      <button
        className="icon-btn ghost"
        title={t("topbar.settings")}
        aria-label={t("topbar.settings")}
        onClick={(e) => setAnchor(e.currentTarget.getBoundingClientRect())}
      >
        <Settings size={17} />
      </button>
      {anchor && (
        <Popover rect={anchor} width={240} onClose={() => setAnchor(null)}>
          <div className="menu-group">{t("settings.definitionView")}</div>
          {VIEWS.map((v) => (
            <button
              key={v}
              onClick={() => {
                setDefinitionView(v);
                setAnchor(null);
              }}
            >
              <span className="check-slot">{v === definitionView && <Check size={14} />}</span>
              {t(`settings.view.${v}`)}
            </button>
          ))}
          <div className="menu-sep" />
          <div className="menu-group">{t("settings.formLabels")}</div>
          {LABELS.map((l) => (
            <button
              key={l}
              onClick={() => {
                setFormLabels(l);
                setAnchor(null);
              }}
            >
              <span className="check-slot">{l === formLabels && <Check size={14} />}</span>
              {t(`settings.labels.${l}`)}
            </button>
          ))}
        </Popover>
      )}
    </>
  );
};
