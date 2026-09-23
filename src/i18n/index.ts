import i18next from "i18next";
import LanguageDetector from "i18next-browser-languagedetector";
import { initReactI18next } from "react-i18next";

import enUi from "./locales/en/ui.json";
import enCore from "./locales/en/core.json";
import deUi from "./locales/de/ui.json";
import deCore from "./locales/de/core.json";
import huUi from "./locales/hu/ui.json";
import huCore from "./locales/hu/core.json";

export const SUPPORTED_LANGUAGES = ["en", "de", "hu"] as const;
export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number];

const STORAGE_KEY = "automata-lab-lang";

i18next
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      en: { ui: enUi, core: enCore },
      de: { ui: deUi, core: deCore },
      hu: { ui: huUi, core: huCore }
    },
    ns: ["ui", "core"],
    defaultNS: "ui",
    fallbackLng: "en",
    supportedLngs: [...SUPPORTED_LANGUAGES],
    nonExplicitSupportedLngs: true,
    load: "languageOnly",
    detection: {
      order: ["localStorage", "navigator"],
      lookupLocalStorage: STORAGE_KEY,
      caches: ["localStorage"]
    },
    interpolation: { escapeValue: false },
    returnNull: false
  });

i18next.on("languageChanged", (lng) => {
  document.documentElement.lang = lng;
});
document.documentElement.lang = i18next.language;

export default i18next;
