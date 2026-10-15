import { useMemo } from "react";
import { useAppStore } from "../../state/store";
import { shortcutWords } from "./epsilon";

/** The ε typing-shortcut words currently enabled in the settings. */
export function useEpsilonWords(): Set<string> {
  const enabled = useAppStore((s) => s.epsilonShortcut);
  return useMemo(() => shortcutWords(enabled), [enabled]);
}
