/**
 * Gráf-export: önálló SVG, PNG és LaTeX (TikZ) — pl. dolgozatba,
 * jegyzetbe illesztéshez.
 */
import i18n from "../../i18n";

export interface ExportNode {
  id: string;
  label: string;
  start?: boolean;
  accept?: boolean;
  x: number;
  y: number;
}

export interface ExportEdge {
  from: string;
  to: string;
  label: string;
}

export function downloadFile(name: string, mime: string, data: string | Blob) {
  const blob = typeof data === "string" ? new Blob([data], { type: mime }) : data;
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

/* ------------------------------ SVG ------------------------------ */

const STYLE_PROPS = [
  "fill",
  "stroke",
  "stroke-width",
  "stroke-dasharray",
  "stroke-linecap",
  "stroke-linejoin",
  "opacity",
  "font-family",
  "font-size",
  "font-weight",
  "paint-order",
  "text-anchor",
  "dominant-baseline"
];

/** a kiszámított stílusok beégetése, hogy a fájl önállóan is jól nézzen ki */
function inlineStyles(src: Element, dst: Element) {
  const cs = getComputedStyle(src);
  let style = "";
  for (const p of STYLE_PROPS) {
    const v = cs.getPropertyValue(p);
    if (v) style += `${p}:${v};`;
  }
  dst.setAttribute("style", style);
  dst.removeAttribute("class");
  for (let i = 0; i < src.children.length; i++) {
    if (dst.children[i]) inlineStyles(src.children[i], dst.children[i]);
  }
}

export function buildStandaloneSVG(
  svg: SVGSVGElement,
  bounds: [number, number, number, number],
  background: string
): string {
  const clone = svg.cloneNode(true) as SVGSVGElement;
  inlineStyles(svg, clone);

  // csak-UI elemek eltávolítása (hover-gyűrű, port, húzás közbeni vonal):
  // a klónban már nincs class, ezért az eredeti fa indexei alapján párosítunk
  const uiNodes = svg.querySelectorAll(
    ".graph-ring-vis, .graph-ring-hit, .graph-port-dot, .graph-connect-line"
  );
  const all = [...svg.querySelectorAll("*")];
  const allClone = [...clone.querySelectorAll("*")];
  const toRemove: Element[] = [];
  uiNodes.forEach((n) => {
    const i = all.indexOf(n);
    if (i >= 0) toRemove.push(allClone[i]);
  });
  toRemove.forEach((n) => n.remove());

  const pad = 10;
  const vb = [bounds[0] - pad, bounds[1] - pad, bounds[2] + pad * 2, bounds[3] + pad * 2];
  clone.setAttribute("viewBox", vb.join(" "));
  clone.setAttribute("width", String(Math.round(vb[2])));
  clone.setAttribute("height", String(Math.round(vb[3])));
  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");

  const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
  rect.setAttribute("x", String(vb[0]));
  rect.setAttribute("y", String(vb[1]));
  rect.setAttribute("width", String(vb[2]));
  rect.setAttribute("height", String(vb[3]));
  rect.setAttribute("fill", background);
  clone.insertBefore(rect, clone.firstChild);

  return new XMLSerializer().serializeToString(clone);
}

export function svgToPng(svgText: string, width: number, height: number, scale = 3): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(new Blob([svgText], { type: "image/svg+xml" }));
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(width * scale);
      canvas.height = Math.round(height * scale);
      const ctx = canvas.getContext("2d")!;
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error(i18n.t("graph.export.pngFailed")))), "image/png");
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error(i18n.t("graph.export.svgLoadFailed")));
    };
    img.src = url;
  });
}

/* ------------------------------ TikZ ------------------------------ */

const PX_PER_CM = 45;

function texEscape(s: string): string {
  return s
    .replaceAll("\\", "\\textbackslash{}")
    .replaceAll(/([&%$#_{}])/g, "\\$1")
    .replaceAll("~", "\\textasciitilde{}")
    .replaceAll("^", "\\textasciicircum{}")
    .replaceAll("ε", "$\\varepsilon$")
    .replaceAll("␣", "\\textvisiblespace{}")
    .replaceAll("∅", "$\\emptyset$")
    .replaceAll("→", "$\\rightarrow$");
}

/** TikZ-kód a tankönyvi automata-stílusban (tikz automata library). */
export function toTikz(nodes: ExportNode[], edges: ExportEdge[]): string {
  // TikZ-barát azonosítók
  const ids = new Map<string, string>();
  nodes.forEach((n, i) => {
    ids.set(n.id, /^[A-Za-z][A-Za-z0-9]*$/.test(n.id) ? n.id : `s${i}`);
  });

  const fmt = (v: number) => (Math.round(v * 100) / 100).toString();

  const lines: string[] = [
    `% ${i18n.t("graph.export.tikzComment")}`,
    "%   \\usepackage{tikz}",
    "%   \\usetikzlibrary{automata, positioning, arrows.meta}",
    "\\begin{tikzpicture}[->, >={Stealth[round]}, auto, semithick,",
    "    initial text={}, every state/.style={minimum size=8mm}]"
  ];

  for (const n of nodes) {
    const opts = ["state"];
    if (n.start) opts.push("initial");
    if (n.accept) opts.push("accepting");
    const x = fmt(n.x / PX_PER_CM);
    const y = fmt(-n.y / PX_PER_CM);
    lines.push(`  \\node[${opts.join(", ")}] (${ids.get(n.id)}) at (${x},${y}) {${texEscape(n.label)}};`);
  }

  // oda-vissza élpárok: ívelt élek
  const pairs = new Set(edges.map((e) => `${e.from}→${e.to}`));
  const edgeLines = edges.map((e) => {
    const a = ids.get(e.from);
    const b = ids.get(e.to);
    const label = texEscape(e.label);
    if (e.from === e.to) return `    (${a}) edge[loop above] node {${label}} (${a})`;
    const opts = pairs.has(`${e.to}→${e.from}`) ? "[bend left=18]" : "";
    return `    (${a}) edge${opts} node {${label}} (${b})`;
  });
  if (edgeLines.length > 0) {
    lines.push("  \\path");
    lines.push(edgeLines.join("\n"));
    lines.push("  ;");
  }
  lines.push("\\end{tikzpicture}");
  return lines.join("\n");
}
