/**
 * Names in a worksheet. A cell may define a name (`name:` in a definition, `name =` in an
 * expression) or stay unnamed, like an unnamed expression in Desmos.
 */
const IDENT = "[A-Za-z][A-Za-z0-9_'′]*";
const DEFINITION = /^\s*[A-Za-z]+\s*:/;
const DEFINITION_NAME = new RegExp(`^\\s*name:\\s*(${IDENT})`, "m");
const ASSIGNMENT = new RegExp(`^\\s*(${IDENT})\\s*=`);

/** The name a cell defines, or null for an unnamed cell. */
export function cellName(source: string): string | null {
  return (DEFINITION.test(source) ? DEFINITION_NAME : ASSIGNMENT).exec(source)?.[1] ?? null;
}

/** Names already taken in the worksheet. */
export function usedNames(cells: { source: string }[]): Set<string> {
  const used = new Set<string>();
  for (const c of cells) {
    const name = cellName(c.source);
    if (name) used.add(name);
  }
  return used;
}

/** `base`, or `base2`, `base3`, … — the first one not taken yet. */
export function uniqueName(base: string, used: Set<string>): string {
  if (!used.has(base)) return base;
  let i = 2;
  while (used.has(`${base}${i}`)) i++;
  return `${base}${i}`;
}

/** Gives an unnamed cell a name: a `name:` line for definitions, `name =` for expressions. */
export function withName(source: string, name: string): string {
  if (DEFINITION.test(source)) {
    const [first, ...rest] = source.split("\n");
    const indent = rest.find((l) => l.trim())?.match(/^\s*/)?.[0] || "  ";
    return [first, `${indent}name: ${name}`, ...rest].join("\n");
  }
  return `${name} = ${source.trim()}`;
}
