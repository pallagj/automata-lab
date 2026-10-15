import React from "react";
import { useTranslation } from "react-i18next";
import { ChevronDown, Globe } from "lucide-react";
import { SUPPORTED_LANGUAGES, SupportedLanguage } from "../i18n";

const SHORT_LABELS: Record<SupportedLanguage, string> = {
  en: "EN",
  de: "DE",
  hu: "HU"
};

// A legördülő listában a nyelvek saját nevükön szerepelnek.
const NATIVE_NAMES: Record<SupportedLanguage, string> = {
  en: "English",
  de: "Deutsch",
  hu: "Magyar"
};

export const LanguageSwitcher: React.FC = () => {
  const { i18n, t } = useTranslation();
  const detected = (i18n.resolvedLanguage ?? i18n.language ?? "en").split("-")[0] as SupportedLanguage;
  const current = SUPPORTED_LANGUAGES.includes(detected) ? detected : "en";

  // A natív <select> láthatatlanul fedi a gombot: a megjelenés egyezik a többi
  // fejléc-gombbal, a kiválasztás viszont natív (billentyűzet, mobil) marad.
  return (
    <label className="icon-btn lang-switcher" title={t("topbar.language")}>
      <Globe size={15} aria-hidden />
      <span className="lang-current">{SHORT_LABELS[current]}</span>
      <ChevronDown size={13} aria-hidden className="lang-chevron" />
      <select
        className="lang-select"
        value={current}
        onChange={(e) => i18n.changeLanguage(e.target.value)}
        aria-label={t("topbar.language")}
      >
        {SUPPORTED_LANGUAGES.map((lng) => (
          <option key={lng} value={lng}>
            {NATIVE_NAMES[lng]}
          </option>
        ))}
      </select>
    </label>
  );
};
