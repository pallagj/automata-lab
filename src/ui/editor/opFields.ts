import { StorageSpec } from "../../core/machine/machine";

/**
 * A transition line's storage operations as separate fields and back: a stack's
 * "Z/AZ" is the fields Z and AZ, a tape's "a/b R" the fields a, b and R. Used by the
 * graph's edge dialog and by the form's δ(q, a, Z) = (p, γ) rows.
 */

const splitSlash = (s: string): [string, string] => {
  const i = s.indexOf("/");
  return i >= 0 ? [s.slice(0, i), s.slice(i + 1)] : [s, ""];
};

/** line tokens (without from/to) → dialog field values */
export function tokensToFields(hasHead: boolean, storages: Pick<StorageSpec, "id" | "type">[], tokens: string[]): string[] {
  const out: string[] = [];
  let i = 0;
  if (hasHead) out.push(tokens[i++] ?? "");
  for (const s of storages) {
    if (s.type === "tape") {
      const [r, w] = splitSlash(tokens[i++] ?? "");
      out.push(r, w, tokens[i++] ?? "R");
    } else {
      const [a, b] = splitSlash(tokens[i++] ?? "");
      out.push(a, b);
    }
  }
  return out;
}

/** dialog field values → line tokens (without from/to) */
export function fieldsToTokens(hasHead: boolean, storages: Pick<StorageSpec, "id" | "type">[], fields: string[]): string[] {
  const out: string[] = [];
  let i = 0;
  if (hasHead) out.push(fields[i++] ?? "");
  for (const s of storages) {
    if (s.type === "tape") {
      const r = fields[i++] ?? "";
      const w = fields[i++] ?? "";
      out.push(`${r}/${w}`, fields[i++] ?? "R");
    } else {
      const a = fields[i++] ?? "";
      const b = fields[i++] ?? "";
      out.push(`${a}/${b}`);
    }
  }
  return out;
}
