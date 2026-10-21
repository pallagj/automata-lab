import { describe, expect, it } from "vitest";
import enUi from "./locales/en/ui.json";
import enCore from "./locales/en/core.json";
import deUi from "./locales/de/ui.json";
import deCore from "./locales/de/core.json";
import huUi from "./locales/hu/ui.json";
import huCore from "./locales/hu/core.json";

/** Every text of a locale with its key. */
function texts(o: unknown, path = ""): [string, string][] {
  if (typeof o === "string") return [[path, o]];
  if (typeof o !== "object" || o === null) return [];
  return Object.entries(o).flatMap(([k, v]) => texts(v, path ? `${path}.${k}` : k));
}

const LOCALES = {
  en: [...texts(enUi), ...texts(enCore)],
  de: [...texts(deUi), ...texts(deCore)],
  hu: [...texts(huUi), ...texts(huCore)]
};

describe("the lecture notes' terms in every language", () => {
  // the notes say változó and kezdőváltozó: variable and start variable, Variable and Startvariable
  const AVOIDED: Record<keyof typeof LOCALES, RegExp> = {
    en: /non-?terminal|start symbol/i,
    de: /nicht-?terminal|startsymbol/i,
    hu: /nemterminális|kezdőszimbólum/i
  };

  for (const [lang, all] of Object.entries(LOCALES) as [keyof typeof LOCALES, [string, string][]][]) {
    it(`${lang}: a grammar's variables and its start variable`, () => {
      expect(all.length).toBeGreaterThan(300);
      expect(all.filter(([, text]) => AVOIDED[lang].test(text))).toEqual([]);
    });
  }

  it("every language has the same texts", () => {
    const keys = (lang: keyof typeof LOCALES) => LOCALES[lang].map(([k]) => k).sort();
    expect(keys("de")).toEqual(keys("en"));
    expect(keys("hu")).toEqual(keys("en"));
  });
});
