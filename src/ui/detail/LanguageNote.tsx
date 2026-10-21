import React from "react";
import { useTranslation } from "react-i18next";
import { LanguageSummary } from "../../core/fsm/decide";

/**
 * The line under a list of words: whether the list is the whole language, and if not,
 * whether the language is infinite or how many words it has — exact, not a guess.
 */
export const LanguageNote: React.FC<{ summary: LanguageSummary; shownCount: number; emptyKey: string }> = ({
  summary,
  shownCount,
  emptyKey
}) => {
  const { t } = useTranslation();
  const text = summary.empty
    ? t(emptyKey)
    : !summary.finite
      ? t("detail.language.infinite")
      : summary.countExact && summary.count === shownCount
        ? t("detail.language.allWords")
        : t(summary.countExact ? "detail.language.moreFinite" : "detail.language.moreFiniteAtLeast", { count: summary.count });
  return <div style={{ marginTop: summary.empty ? 0 : 8, fontSize: 12.5, color: "var(--muted)" }}>{text}</div>;
};
