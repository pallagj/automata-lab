import React from "react";
import { useTranslation } from "react-i18next";
import { Globe } from "lucide-react";
import { SUPPORTED_LANGUAGES, SupportedLanguage } from "../i18n";

const LABELS: Record<SupportedLanguage, string> = {
  en: "EN",
  de: "DE",
  hu: "HU"
};

export const LanguageSwitcher: React.FC = () => {
  const { i18n, t } = useTranslation();
  const current = (i18n.resolvedLanguage ?? i18n.language ?? "en").split("-")[0] as SupportedLanguage;

  return (
    <label className="icon-btn lang-switcher" title={t("topbar.language")}>
      <Globe size={14} aria-hidden />
      <select
        className="lang-select"
        value={SUPPORTED_LANGUAGES.includes(current) ? current : "en"}
        onChange={(e) => i18n.changeLanguage(e.target.value)}
        aria-label={t("topbar.language")}
      >
        {SUPPORTED_LANGUAGES.map((lng) => (
          <option key={lng} value={lng}>
            {LABELS[lng]}
          </option>
        ))}
      </select>
    </label>
  );
};
