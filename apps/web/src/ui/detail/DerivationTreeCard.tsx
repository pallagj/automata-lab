import React, { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronLeft, ChevronRight, Clapperboard, Network } from "lucide-react";
import { Grammar, ruleToString } from "@automatalab/core/grammar/grammar";
import { DerivationTrees, leftmostDerivation, treeAnimation, TreeNode } from "@automatalab/core/grammar/derivationTree";
import { showSymbols } from "@automatalab/core/symbols";
import { EPS } from "@automatalab/core/types";
import { tr } from "@automatalab/core/i18n/translate";
import { displayLength, rich, svgRich } from "../Rich";
import { PlayerBar, usePlayer } from "./AnimationPlayer";

/** The longest word whose trees are drawn: a wider tree is no longer readable, and its table grows with the cube of the length. */
export const MAX_TREE_WORD = 100;

const LEVEL = 54;
const GAP = 12;
const CHAR = 8.6;
const PAD = 10;
const MARGIN = 16;
const NODE_H = 26;

interface Placed {
  node: TreeNode;
  x: number;
  y: number;
  /** the label's width */
  w: number;
  parent?: Placed;
}

/**
 * The tree drawn top down as the definition reads: every leaf in its own column, in the
 * order of the word, each subtree in a block as wide as its leaves (or its label); a
 * variable stands over the middle of its children.
 */
function layout(tree: TreeNode): { nodes: Placed[]; width: number; height: number } {
  const labelWidth = (n: TreeNode) =>
    n.children ? displayLength(n.symbol) * CHAR + 2 * PAD : Math.max(displayLength(n.symbol) * CHAR, 10) + 6;
  const block = new Map<TreeNode, number>();
  const childrenWidth = (n: TreeNode) => n.children!.reduce((a, c) => a + block.get(c)!, 0) + GAP * (n.children!.length - 1);
  const measure = (n: TreeNode): number => {
    n.children?.forEach(measure);
    const w = Math.max(labelWidth(n), n.children ? childrenWidth(n) : 0);
    block.set(n, w);
    return w;
  };
  const width = measure(tree);
  const nodes: Placed[] = [];
  let depth = 0;
  const place = (n: TreeNode, left: number, level: number, parent?: Placed): Placed => {
    const p: Placed = { node: n, x: left + block.get(n)! / 2, y: MARGIN + NODE_H / 2 + level * LEVEL, w: labelWidth(n), parent };
    nodes.push(p);
    depth = Math.max(depth, level);
    if (n.children) {
      let x = left + (block.get(n)! - childrenWidth(n)) / 2;
      const kids = n.children.map((c) => {
        const k = place(c, x, level + 1, p);
        x += block.get(c)! + GAP;
        return k;
      });
      const middle = (kids[0].x + kids[kids.length - 1].x) / 2;
      p.x = Math.min(Math.max(middle, left + p.w / 2), left + block.get(n)! - p.w / 2);
    }
    return p;
  };
  place(tree, MARGIN, 0);
  return { nodes, width: width + 2 * MARGIN, height: 2 * MARGIN + NODE_H + depth * LEVEL };
}

/** A word's derivation trees: how many there are, one of them drawn, its leftmost derivation, and the tree growing along it. */
export const DerivationTreeCard: React.FC<{ grammar: Grammar; trees: DerivationTrees }> = ({ grammar, trees }) => {
  const { t } = useTranslation();
  const [picked, setPicked] = useState(0n);
  useEffect(() => setPicked(0n), [trees]);
  const k = picked < trees.listed ? picked : 0n;
  const tree = useMemo(() => trees.tree(k), [trees, k]);
  const { forms, rewritten } = useMemo(() => leftmostDerivation(tree), [tree]);
  const { nodes, width, height } = useMemo(() => layout(tree), [tree]);
  // the step whose rewriting gives a variable its children
  const stepOf = useMemo(() => new Map(rewritten.map((n, s) => [n, s + 1])), [rewritten]);

  const frames = useMemo(() => treeAnimation(grammar, tree), [grammar, tree]);
  const [animating, setAnimating] = useState(false);
  useEffect(() => setAnimating(false), [frames]);
  const player = usePlayer(frames, animating);
  const played = animating ? frames[player.index] : undefined;
  const expanded = played ? played.expanded : rewritten.length;
  const done = !played || player.index === frames.length - 1;
  const focus = played && !done && played.expanded > 0 ? rewritten[played.expanded - 1] : undefined;
  const next = played && !done ? rewritten[played.expanded] : undefined;
  const shown = (p: Placed) => !p.parent || stepOf.get(p.parent.node)! <= expanded;
  /** a child the last step gave */
  const fresh = (p: Placed) => focus !== undefined && p.parent?.node === focus;

  const subword = trees.repeat && (trees.repeat.subword || EPS);
  const summary =
    trees.count === null
      ? t(trees.partial ? "detail.grammar.trees.infinitePartial" : "detail.grammar.trees.infinite", {
          variable: trees.repeat!.variable,
          subword
        })
      : trees.count === 1n
        ? t("detail.grammar.trees.one")
        : t("detail.grammar.trees.many", { count: trees.count.toString() });

  return (
    <div className="card">
      <div className="card-title">
        <Network size={15} />
        {t("detail.grammar.trees.title")}
      </div>
      <div className="card-body">
        <div className="cyk-note">{rich(summary)}</div>
        <div className="tree-bar">
          {trees.listed > 1n && (
            <span className="tree-pager">
              <button className="icon-btn" onClick={() => setPicked(k - 1n)} disabled={k === 0n} title={t("detail.grammar.trees.previous")}>
                <ChevronLeft size={15} />
              </button>
              <span className="tree-count">
                {(k + 1n).toString()} / {trees.listed.toString()}
              </span>
              <button
                className="icon-btn"
                onClick={() => setPicked(k + 1n)}
                disabled={k + 1n >= trees.listed}
                title={t("detail.grammar.trees.next")}
              >
                <ChevronRight size={15} />
              </button>
            </span>
          )}
          {!animating && (
            <button className="anim-start" onClick={() => setAnimating(true)} title={t("detail.grammar.trees.playHint")}>
              <Clapperboard size={14} /> {t("detail.anim.start")}
            </button>
          )}
        </div>
        <div className="tree-wrap">
          <svg className="derivation-tree" width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img">
            {nodes.map(
              (p, i) =>
                p.parent &&
                shown(p) && (
                  <line
                    key={`e${i}`}
                    className={`tree-edge ${fresh(p) ? "fresh" : ""}`}
                    x1={p.parent.x}
                    y1={p.parent.y + NODE_H / 2}
                    x2={p.x}
                    y2={p.y - (p.node.children ? NODE_H / 2 : 9)}
                  />
                )
            )}
            {nodes.map((p, i) => {
              if (!shown(p)) return null;
              const { node } = p;
              if (!node.children)
                return (
                  <text
                    key={i}
                    className={`tree-leaf ${node.symbol === EPS ? "eps" : ""} ${fresh(p) ? "fresh" : ""} ${played && done ? "yield" : ""}`}
                    x={p.x}
                    y={p.y}
                    textAnchor="middle"
                    dominantBaseline="central"
                  >
                    {node.symbol}
                  </text>
                );
              const state = node === focus ? "focus" : node === next ? "next" : fresh(p) ? "fresh" : "";
              return (
                <g key={i} className={`tree-node ${state}`}>
                  <title>{ruleToString(grammar.rules[node.rule!])}</title>
                  <rect x={p.x - p.w / 2} y={p.y - NODE_H / 2} width={p.w} height={NODE_H} rx={NODE_H / 2} />
                  <text x={p.x} y={p.y} textAnchor="middle" dominantBaseline="central">
                    {svgRich(node.symbol)}
                  </text>
                </g>
              );
            })}
          </svg>
        </div>
        {animating && (
          <PlayerBar player={player} caption={played && rich(tr(t, played.caption))} inline onClose={() => setAnimating(false)} />
        )}
        <div className="tree-derivation-title">{t("detail.grammar.trees.leftmost")}</div>
        <div className="derivation">
          {forms.map((f, s) => {
            const current = played ? s === expanded : s === forms.length - 1;
            return (
              <span key={s}>
                {s > 0 && <span title={ruleToString(grammar.rules[rewritten[s - 1].rule!])}> ⇒ </span>}
                {current ? <b>{rich(showSymbols(f))}</b> : rich(showSymbols(f))}
              </span>
            );
          })}
        </div>
      </div>
    </div>
  );
};
