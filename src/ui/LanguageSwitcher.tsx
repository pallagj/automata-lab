import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { Check, Globe } from "lucide-react";
import { SUPPORTED_LANGUAGES, SupportedLanguage } from "../i18n";
import { Popover } from "./browser/controls";

// The list shows each language under its own name.
const NATIVE_NAMES: Record<SupportedLanguage, string> = {
  en: "English",
  de: "Deutsch",
  hu: "Magyar"
};

export const LanguageSwitcher: React.FC = () => {
  const { i18n, t } = useTranslation();
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  const detected = (i18n.resolvedLanguage ?? i18n.language ?? "en").split("-")[0] as SupportedLanguage;
  const current = SUPPORTED_LANGUAGES.includes(detected) ? detected : "en";

  return (
    <>
      <button
        className="icon-btn ghost"
        title={t("topbar.language")}
        aria-label={t("topbar.language")}
        onClick={(e) => setAnchor(e.currentTarget.getBoundingClientRect())}
      >
        <Globe size={17} />
      </button>
      {anchor && (
        <Popover rect={anchor} width={190} onClose={() => setAnchor(null)}>
          <div className="menu-group">{t("topbar.language")}</div>
          {SUPPORTED_LANGUAGES.map((lng) => (
            <button
              key={lng}
              lang={lng}
              onClick={() => {
                i18n.changeLanguage(lng);
                setAnchor(null);
              }}
            >
              <span className="check-slot">{lng === current && <Check size={14} />}</span>
              {NATIVE_NAMES[lng]}
            </button>
          ))}
        </Popover>
      )}
    </>
  );
};
