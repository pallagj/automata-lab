import React from "react";

/**
 * Names in any displayed text: X_a and X_{ab} are shown with a real
 * subscript (core/symbols.ts writes them so). A "_" that does not follow a letter —
 * the tape blank in a/_ — stays as it is.
 */
const NAME = /(\p{L}′*)_(\{[^{}\s]+\}|[^\s{}_])/gu;

export function rich(text: string): React.ReactNode {
  const out: React.ReactNode[] = [];
  let last = 0;
  for (const m of text.matchAll(NAME)) {
    const at = m.index!;
    if (at > last) out.push(text.slice(last, at));
    const sub = m[2].startsWith("{") ? m[2].slice(1, -1) : m[2];
    out.push(
      <span key={at} className="sym">
        {m[1]}
        <sub>{sub}</sub>
      </span>
    );
    last = at + m[0].length;
  }
  if (last === 0) return text;
  if (last < text.length) out.push(text.slice(last));
  return out;
}

/** The text with names rendered, as an element. */
export const Rich: React.FC<{ text: string }> = ({ text }) => <>{rich(text)}</>;

/** Plain text of a name for places that cannot render markup (titles, SVG exports): X_{ab} → Xab. */
export function plainName(text: string): string {
  return text.replace(NAME, (_m, base: string, sub: string) => base + (sub.startsWith("{") ? sub.slice(1, -1) : sub));
}

/** Subscript metrics in SVG: no baseline-shift (Firefox ignores it), a dy pair instead. */
const SVG_SUB_SIZE = 0.72;
const SVG_SUB_DROP = 0.3; // in the parent's em

/** The same as rich(), as SVG <tspan>s. */
export function svgRich(text: string): React.ReactNode {
  const out: React.ReactNode[] = [];
  let last = 0;
  let lowered = false;
  for (const m of text.matchAll(NAME)) {
    const at = m.index!;
    const before = text.slice(last, at) + m[1];
    out.push(
      <tspan key={`t${at}`} dy={lowered ? `${-SVG_SUB_DROP}em` : undefined}>
        {before}
      </tspan>
    );
    const sub = m[2].startsWith("{") ? m[2].slice(1, -1) : m[2];
    out.push(
      <tspan key={`s${at}`} fontSize={`${SVG_SUB_SIZE}em`} dy={`${SVG_SUB_DROP / SVG_SUB_SIZE}em`}>
        {sub}
      </tspan>
    );
    lowered = true;
    last = at + m[0].length;
  }
  if (last === 0) return text;
  if (last < text.length)
    out.push(
      <tspan key="end" dy={`${-SVG_SUB_DROP}em`}>
        {text.slice(last)}
      </tspan>
    );
  return out;
}

/** Visible length of a text whose names render with subscripts (a subscript is narrower). */
export function displayLength(text: string): number {
  let n = 0;
  let last = 0;
  for (const m of text.matchAll(NAME)) {
    n += [...text.slice(last, m.index!)].length + [...m[1]].length;
    const sub = m[2].startsWith("{") ? m[2].slice(1, -1) : m[2];
    n += [...sub].length * SVG_SUB_SIZE;
    last = m.index! + m[0].length;
  }
  return n + [...text.slice(last)].length;
}

/** Names in TeX math: X_{ab} → $X_{ab}$ (the rest of the text is escaped by the caller's function). */
export function texNames(text: string, escape: (s: string) => string): string {
  let out = "";
  let last = 0;
  for (const m of text.matchAll(NAME)) {
    const sub = m[2].startsWith("{") ? m[2].slice(1, -1) : m[2];
    out += escape(text.slice(last, m.index!)) + `$${m[1].replaceAll("′", "'")}_{${escape(sub)}}$`;
    last = m.index! + m[0].length;
  }
  return out + escape(text.slice(last));
}
