import type { TFunction } from "i18next";
import type { I18nText } from "../core/types";

/**
 * Resolves an I18nText (or a raw passthrough string, e.g. a table header
 * symbol/formula) via i18next. Defaults to the "core" namespace; pass
 * `ns: "ui"` on the I18nText for UI-authored values (see the type's doc).
 *
 * Convention: a param named `<name>Key` (e.g. `opKey: "determinize"`) is
 * itself resolved as a nested translation key in the *same* namespace as the
 * outer key (e.g. `core:opNames.determinize`) before being substituted as
 * `{{<name>}}` in the outer message. This lets core algorithms pass stable,
 * language-neutral identifiers (operation names, storage kinds, …) instead
 * of baking a language into the string.
 */
export function tr(t: TFunction, x: I18nText | string | undefined): string {
  if (x === undefined) return "";
  if (typeof x === "string") return x;
  const ns = x.ns ?? "core";
  const params: Record<string, string | number> = {};
  for (const [k, v] of Object.entries(x.params ?? {})) {
    if (k.endsWith("Key") && typeof v === "string") {
      params[k.slice(0, -3)] = t(v, { ns }) as string;
    } else {
      params[k] = v;
    }
  }
  return t(x.key, { ns, ...params }) as string;
}
