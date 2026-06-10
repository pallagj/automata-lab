import { EPS } from "../types";

/**
 * Veremautomata (PDA) — nemdeterminisztikus, konfigurációhalmazos szimulációval.
 * Átmenet: (állapot, bemeneti szimbólum vagy ε, verem teteje vagy ε) → (új állapot, verembe írt sztring)
 * A push sztring bal széle kerül a verem tetejére (tankönyvi jelölés szerint).
 */
export interface PDA {
  kind: "pda";
  name: string;
  alphabet: string[];
  stackAlphabet: string[];
  states: string[];
  start: string;
  /** kezdő veremszimbólum */
  startStack: string;
  accept: string[];
  acceptMode: "finalState" | "emptyStack";
  transitions: PDATransition[];
}

export interface PDATransition {
  from: string;
  /** beolvasott szimbólum vagy EPS */
  input: string;
  /** levett veremszimbólum vagy EPS (ε = nem néz/nem vesz le semmit) */
  pop: string;
  /** verembe írt sztring (bal széle lesz a tető); "" = semmi */
  push: string;
  to: string;
}

/** Egy konfiguráció: állapot + hátralévő pozíció + verem tartalma (bal széle a tető). */
export interface PDAConfig {
  state: string;
  pos: number;
  stack: string;
}

export function configKey(c: PDAConfig): string {
  return `${c.state}|${c.pos}|${c.stack}`;
}

export function initialConfig(p: PDA): PDAConfig {
  return { state: p.start, pos: 0, stack: p.startStack };
}

export function isAcceptingConfig(p: PDA, c: PDAConfig, inputLength: number): boolean {
  if (c.pos !== inputLength) return false;
  if (p.acceptMode === "emptyStack") return c.stack.length === 0;
  return p.accept.includes(c.state);
}

/** Egy konfigurációból egy lépésben elérhető konfigurációk (az alkalmazott átmenettel). */
export function pdaMoves(
  p: PDA,
  c: PDAConfig,
  input: string
): { config: PDAConfig; transition: PDATransition }[] {
  const result: { config: PDAConfig; transition: PDATransition }[] = [];
  const nextChar = c.pos < input.length ? input[c.pos] : null;
  const top = c.stack.length > 0 ? c.stack[0] : null;

  for (const t of p.transitions) {
    if (t.from !== c.state) continue;
    // bemenet illesztése
    let newPos = c.pos;
    if (t.input === EPS) {
      // nem olvas
    } else if (nextChar !== null && t.input === nextChar) {
      newPos = c.pos + 1;
    } else continue;
    // verem illesztése
    let newStack = c.stack;
    if (t.pop === EPS) {
      newStack = t.push + c.stack;
    } else if (top !== null && t.pop === top) {
      newStack = t.push + c.stack.slice(1);
    } else continue;

    result.push({ config: { state: t.to, pos: newPos, stack: newStack }, transition: t });
  }
  return result;
}

export interface PDARunResult {
  verdict: "accepted" | "rejected" | "limit";
  /** elfogadó út konfigurációi (ha van) */
  acceptingPath?: { config: PDAConfig; via?: PDATransition }[];
  exploredConfigs: number;
}

/** Szó elfogadásának eldöntése korlátos BFS-sel (a végtelen ε-körök ellen). */
export function runPDA(p: PDA, input: string, maxConfigs = 20000, maxStack = 200): PDARunResult {
  interface Item {
    config: PDAConfig;
    parent: Item | null;
    via?: PDATransition;
  }
  const start: Item = { config: initialConfig(p), parent: null };
  const seen = new Set<string>([configKey(start.config)]);
  let frontier: Item[] = [start];
  let explored = 1;

  const buildPath = (item: Item) => {
    const path: { config: PDAConfig; via?: PDATransition }[] = [];
    let cur: Item | null = item;
    while (cur) {
      path.unshift({ config: cur.config, via: cur.via });
      cur = cur.parent;
    }
    return path;
  };

  if (isAcceptingConfig(p, start.config, input.length)) {
    return { verdict: "accepted", acceptingPath: buildPath(start), exploredConfigs: explored };
  }

  while (frontier.length > 0) {
    const next: Item[] = [];
    for (const item of frontier) {
      for (const { config, transition } of pdaMoves(p, item.config, input)) {
        if (config.stack.length > maxStack) continue;
        const key = configKey(config);
        if (seen.has(key)) continue;
        seen.add(key);
        explored++;
        const newItem: Item = { config, parent: item, via: transition };
        if (isAcceptingConfig(p, config, input.length)) {
          return { verdict: "accepted", acceptingPath: buildPath(newItem), exploredConfigs: explored };
        }
        if (explored >= maxConfigs) {
          return { verdict: "limit", exploredConfigs: explored };
        }
        next.push(newItem);
      }
    }
    frontier = next;
  }
  return { verdict: "rejected", exploredConfigs: explored };
}

/** Interaktív szimuláció: az aktuális konfigurációhalmaz egy lépése. */
export function stepPDAConfigs(p: PDA, configs: PDAConfig[], input: string, maxConfigs = 200): PDAConfig[] {
  const out: PDAConfig[] = [];
  const seen = new Set<string>();
  for (const c of configs) {
    for (const { config } of pdaMoves(p, c, input)) {
      const key = configKey(config);
      if (!seen.has(key)) {
        seen.add(key);
        out.push(config);
        if (out.length >= maxConfigs) return out;
      }
    }
  }
  return out;
}

export function pdaTransitionLabel(t: PDATransition): string {
  const pushStr = t.push === "" ? EPS : t.push;
  return `${t.input}, ${t.pop} / ${pushStr}`;
}
