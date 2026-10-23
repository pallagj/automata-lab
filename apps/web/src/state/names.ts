import { formatIdent, parseIdent, withSubscript } from "@automatalab/core/symbols";
import { splitAssignment } from "@automatalab/core/expr/expression";

/**
 * Names in a worksheet. A cell may define a name (`name:` in a definition, `name =` in an
 * expression) or stay unnamed. A name is a single
 * letter with an optional subscript (core/symbols.ts).
 */
const DEFINITION = /^\s*[A-Za-z]+\s*:/;
const DEFINITION_NAME = /^\s*name:\s*["']?([^"'\n#]*?)["']?\s*$/m;

/** The name a cell defines (canonical, M1 → M_1), or null for an unnamed cell. */
export function cellName(source: string): string | null {
  if (DEFINITION.test(source)) {
    const raw = DEFINITION_NAME.exec(source)?.[1]?.trim();
    return raw ? (parseIdent(raw) ? formatIdent(parseIdent(raw)!) : null) : null;
  }
  return splitAssignment(source)?.name ?? null;
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

/** `base`, or the base with a numbered subscript (M_2, M_3, …; M_{det2}) — the first one not taken. */
export function uniqueName(base: string, used: Set<string>): string {
  if (!used.has(base)) return base;
  const id = parseIdent(base);
  // a numbered name counts on: M_1 → M_2
  if (id && /^[0-9]+$/.test(id.sub)) {
    let n = Number(id.sub) + 1;
    while (used.has(formatIdent({ ...id, sub: String(n) }))) n++;
    return formatIdent({ ...id, sub: String(n) });
  }
  let i = 2;
  while (used.has(withSubscript(base, String(i)))) i++;
  return withSubscript(base, String(i));
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
