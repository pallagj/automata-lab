import { EPS, err, failResult, I18nText, OpResult, okResult, tx } from "../types";
import { showSymbols } from "../symbols";
import { classify, Grammar, ruleToString } from "./grammar";

/**
 * Derivation trees of a word (lecture notes, 6.1): the root is the start variable, the inner
 * nodes are variables, the leaves letters or ε; the children of a node A, read left to right,
 * are the right-hand side of a rule A → B₁…B_k, and the leaves read left to right give the
 * word. A word with two trees makes the grammar ambiguous (6.4).
 *
 * The trees are counted and numbered, not listed, on the grammar as it is — ε-rules and unit
 * rules too. A table like CYK's (8.1) says for every variable A and subword u whether A ⇒* u,
 * and for every rule A → X₁…X_k and every d whether X₁…X_d ⇒* u. A tree of A over u is then
 * a rule of A and a split of u among its symbols, with a tree of each variable over its part:
 * counting these choices counts the trees, and the k-th tree is found the same way without
 * building the others.
 *
 * A variable that derives itself over the same subword — A ⇒⁺ αAβ with α, β ⇒* ε, through a
 * unit rule or through symbols that vanish — gives infinitely many trees, as the loop can be
 * taken again and again. The trees numbered then are those with no such repeat on any path
 * from the root: every other tree is one of them with loops put in.
 */
export interface TreeNode {
  /** a variable, a letter, or ε for the leaf of an ε-rule */
  symbol: string;
  /** a variable's children: the right-hand side of its rule; a leaf has none */
  children?: TreeNode[];
  /** the rule applied at a variable, as its index among the grammar's rules */
  rule?: number;
}

export interface DerivationTrees {
  word: string[];
  /** how many derivation trees the word has; null: infinitely many */
  count: bigint | null;
  /** how many trees tree(k) numbers: all of them, or with infinitely many the ones without a repeat */
  listed: bigint;
  /** with infinitely many trees: a variable that derives itself over the same subword */
  repeat?: { variable: string; subword: string };
  /** too many repeat-free trees to number them: tree(0) is one of them, and the only one listed */
  partial?: true;
  /** the k-th tree, 0 ≤ k < listed */
  tree: (k: bigint) => TreeNode;
}

/** counts kept for a node and its ancestors in a loop, beyond one per node, before numbering gives up */
const BUDGET = 200_000;
/** the most variables over one subword that can derive each other: their ancestor sets are bit masks */
const MAX_LOOP = 20;
const MASK_SPACE = 2 ** MAX_LOOP;

const TOO_MANY = new Error("too many trees to number");

/** i, i + 1, …, j */
const range = (i: number, j: number) => Array.from({ length: j - i + 1 }, (_, k) => i + k);

export function derivationTrees(g: Grammar, input: string): OpResult<DerivationTrees> {
  if (!classify(g).contextFreeForm)
    return failResult([
      err(tx("grammar.needsContextFree.title", { opKey: "opNames.derivationTrees" }), tx("grammar.needsContextFree.detail"))
    ]);
  const word = [...input];
  const n = word.length;
  const W = n + 1;
  const sq = W * W;
  const variables = g.nonterminals;
  const nv = variables.length;
  const varIndex = new Map(variables.map((A, k) => [A, k]));
  // a right-hand side's symbols: a variable's index, or a letter
  const rules = g.rules.map((r) => ({
    left: varIndex.get(r.left[0])!,
    right: r.right.map((s) => varIndex.get(s) ?? s)
  }));
  const byLeft = variables.map((_, A) => rules.flatMap((r, index) => (r.left === A ? [index] : [])));

  // Nodes: V(A, i, j) says A ⇒* word[i … j); P(r, d, i, j) says the first d symbols of rule r's
  // right-hand side derive it. Each is a number: the V nodes first, then a block per (r, d).
  const blocks: { r: number; d: number }[] = [];
  const blockOf = rules.map((r, index) => r.right.map((_, d) => blocks.push({ r: index, d: d + 1 }) - 1));
  const vCount = nv * sq;
  const vId = (A: number, i: number, j: number) => A * sq + i * W + j;
  const pId = (r: number, d: number, i: number, j: number) => vCount + blockOf[r][d - 1] * sq + i * W + j;
  const on = new Uint8Array(vCount + blocks.length * sq);
  // the first way a node was found: the rule of a V node, the split point of a P node
  const witness = new Int32Array(on.length);

  const prefixOn = (r: number, d: number, i: number, m: number) => (d === 0 ? i === m : on[pId(r, d, i, m)] === 1);
  const symbolOn = (x: number | string, m: number, j: number) =>
    typeof x === "number" ? on[vId(x, m, j)] === 1 : j === m + 1 && word[m] === x;
  const ruleOn = (r: number, i: number, j: number) => prefixOn(r, rules[r].right.length, i, j);
  /** where the d-th symbol's part of word[i … j) can start: right after i for the first one, before the last letter for a letter */
  const splits = (r: number, d: number, i: number, j: number): number[] =>
    d === 1 ? [i] : typeof rules[r].right[d - 1] === "string" ? (j > i ? [j - 1] : []) : range(i, j);

  // Shorter subwords first. A subword's nodes can also depend on each other — through a unit
  // rule, or through symbols deriving ε —, so its nodes are swept again until nothing changes.
  for (let len = 0; len <= n; len++) {
    for (let changed = true; changed; ) {
      changed = false;
      for (let i = 0, j = len; j <= n; i++, j++) {
        rules.forEach((r, ri) => {
          for (let d = 1; d <= r.right.length; d++) {
            const p = pId(ri, d, i, j);
            if (on[p]) continue;
            for (const m of splits(ri, d, i, j))
              if (prefixOn(ri, d - 1, i, m) && symbolOn(r.right[d - 1], m, j)) {
                on[p] = 1;
                witness[p] = m;
                changed = true;
                break;
              }
          }
          const v = vId(r.left, i, j);
          if (!on[v] && ruleOn(ri, i, j)) {
            on[v] = 1;
            witness[v] = ri;
            changed = true;
          }
        });
      }
    }
  }

  const start = varIndex.get(g.start);
  const root = start === undefined ? -1 : vId(start, 0, n);
  if (root < 0 || !on[root])
    return okResult({
      word,
      count: 0n,
      listed: 0n,
      tree: () => {
        throw new RangeError("the word has no derivation tree");
      }
    });

  const decode = (id: number) => ({ block: Math.floor(id / sq) - nv, i: Math.floor((id % sq) / W), j: id % W });

  /**
   * The ways a node is made: a V node's rules (the ε-rule with no node below it), a P node's
   * splits word[i … m) · word[m … j) between its first d − 1 symbols and its d-th symbol.
   */
  interface Way {
    kids: number[];
    rule?: number;
    letter?: string;
  }
  const ways = (id: number): Way[] => {
    const out: Way[] = [];
    if (id < vCount) {
      const A = Math.floor(id / sq);
      const { i, j } = decode(id);
      for (const r of byLeft[A])
        if (ruleOn(r, i, j)) {
          const k = rules[r].right.length;
          out.push({ rule: r, kids: k === 0 ? [] : [pId(r, k, i, j)] });
        }
      return out;
    }
    const { block, i, j } = decode(id);
    const { r, d } = blocks[block];
    const x = rules[r].right[d - 1];
    for (const m of splits(r, d, i, j))
      if (prefixOn(r, d - 1, i, m) && symbolOn(x, m, j)) {
        const kids = d > 1 ? [pId(r, d - 1, i, m)] : [];
        if (typeof x === "number") kids.push(vId(x, m, j));
        out.push(typeof x === "number" ? { kids } : { kids, letter: x });
      }
    return out;
  };

  // The loops: strongly connected parts of the nodes reachable from the root (Tarjan, without
  // recursion). No node points to itself, so a part is a loop when it has more than one node.
  const order = new Map<number, number>();
  const low = new Map<number, number>();
  const part = new Map<number, number>();
  const loopParts: boolean[] = [];
  const stack: number[] = [];
  const onStack = new Set<number>();
  const work: { id: number; kids: number[]; next: number }[] = [];
  const enter = (id: number) => {
    order.set(id, order.size);
    low.set(id, order.get(id)!);
    stack.push(id);
    onStack.add(id);
    work.push({ id, kids: ways(id).flatMap((w) => w.kids), next: 0 });
  };
  enter(root);
  while (work.length > 0) {
    const top = work[work.length - 1];
    if (top.next < top.kids.length) {
      const k = top.kids[top.next++];
      if (!order.has(k)) enter(k);
      else if (onStack.has(k)) low.set(top.id, Math.min(low.get(top.id)!, order.get(k)!));
      continue;
    }
    work.pop();
    if (work.length > 0) {
      const parent = work[work.length - 1].id;
      low.set(parent, Math.min(low.get(parent)!, low.get(top.id)!));
    }
    if (low.get(top.id) === order.get(top.id)) {
      let size = 0;
      for (let k = -1; k !== top.id; size++) {
        k = stack.pop()!;
        onStack.delete(k);
        part.set(k, loopParts.length);
      }
      loopParts.push(size > 1);
    }
  }
  const infinite = loopParts.some(Boolean);

  // Each V node of a loop gets a bit; a mask holds the node's ancestors in its own loop.
  const bit = new Map<number, number>();
  const loopSize = loopParts.map(() => 0);
  for (const id of order.keys())
    if (id < vCount && loopParts[part.get(id)!]) bit.set(id, loopSize[part.get(id)!]++);
  /** what a node hands to a node below it: its ancestors in that node's loop, itself too */
  const pass = (from: number, mask: number, to: number) =>
    part.get(to) !== part.get(from) || !loopParts[part.get(to)!] ? 0 : bit.has(from) ? mask | (1 << bit.get(from)!) : mask;

  const memo = new Map<number, bigint>();
  let budget = order.size + BUDGET;
  /** the trees of a node in which none of the ancestors in `mask` comes again */
  const countOf = (id: number, mask: number): bigint => {
    const b = bit.get(id);
    if (b !== undefined && (mask >> b) & 1) return 0n;
    const key = id * MASK_SPACE + mask;
    const known = memo.get(key);
    if (known !== undefined) return known;
    if (--budget < 0) throw TOO_MANY;
    let sum = 0n;
    for (const w of ways(id)) {
      let product = 1n;
      for (const k of w.kids) if ((product *= countOf(k, pass(id, mask, k))) === 0n) break;
      sum += product;
    }
    memo.set(key, sum);
    return sum;
  };

  /** the k-th tree of a node: a V node's tree, or the children a P node's d symbols get */
  const nth = (id: number, mask: number, k: bigint): TreeNode[] => {
    for (const w of ways(id)) {
      const masks = w.kids.map((c) => pass(id, mask, c));
      const counts = w.kids.map((c, x) => countOf(c, masks[x]));
      const total = counts.reduce((a, b) => a * b, 1n);
      if (k >= total) {
        k -= total;
        continue;
      }
      // the first part varies slowest
      const parts = counts.map(() => 0n);
      for (let x = counts.length - 1; x >= 0; x--) {
        parts[x] = k % counts[x];
        k /= counts[x];
      }
      const below = w.kids.flatMap((c, x) => nth(c, masks[x], parts[x]));
      if (w.rule !== undefined)
        return [{ symbol: variables[Math.floor(id / sq)], rule: w.rule, children: below.length > 0 ? below : [{ symbol: EPS }] }];
      return w.letter !== undefined ? [...below, { symbol: w.letter }] : below;
    }
    throw new RangeError("tree number out of range");
  };

  /** the tree of the first ways found: each step leads to nodes found before, so it ends */
  const firstFound = (id: number): TreeNode[] => {
    if (id < vCount) {
      const r = witness[id];
      const { i, j } = decode(id);
      const k = rules[r].right.length;
      return [{ symbol: variables[Math.floor(id / sq)], rule: r, children: k === 0 ? [{ symbol: EPS }] : firstFound(pId(r, k, i, j)) }];
    }
    const { block, i, j } = decode(id);
    const { r, d } = blocks[block];
    const m = witness[id];
    const x = rules[r].right[d - 1];
    const before = d > 1 ? firstFound(pId(r, d - 1, i, m)) : [];
    return [...before, ...(typeof x === "number" ? firstFound(vId(x, m, j)) : [{ symbol: x }])];
  };

  // a variable over a subword it derives itself from, when there is one: the longest subword
  let repeat: DerivationTrees["repeat"];
  if (infinite) {
    let best = -1;
    for (const id of bit.keys()) {
      const { i, j } = decode(id);
      if (j - i > best) {
        best = j - i;
        repeat = { variable: variables[Math.floor(id / sq)], subword: word.slice(i, j).join("") };
      }
    }
  }

  let listed: bigint | null = null;
  if (loopSize.every((s) => s <= MAX_LOOP))
    try {
      listed = countOf(root, 0);
    } catch (e) {
      if (e !== TOO_MANY) throw e;
    }
  const inRange = (k: bigint, size: bigint) => {
    if (k < 0n || k >= size) throw new RangeError("tree number out of range");
  };
  if (listed === null)
    return okResult({
      word,
      count: null,
      listed: 1n,
      repeat,
      partial: true,
      tree: (k) => {
        inRange(k, 1n);
        return firstFound(root)[0];
      }
    });
  const size = listed;
  return okResult({
    word,
    count: infinite ? null : listed,
    listed,
    repeat,
    tree: (k) => {
      inRange(k, size);
      return nth(root, 0, k)[0];
    }
  });
}

/**
 * The tree's leftmost derivation: each step rewrites the leftmost variable, so the tree
 * determines it (6.5). `forms[s]` is the sentential form after `s` steps, from the start
 * variable to the word; `rewritten[s]` is the node step s + 1 gives its children.
 */
export function leftmostDerivation(tree: TreeNode): { forms: string[][]; rewritten: TreeNode[] } {
  let frontier = [tree];
  const form = () => frontier.filter((x) => x.symbol !== EPS).map((x) => x.symbol);
  const forms = [form()];
  const rewritten: TreeNode[] = [];
  for (let at = 0; (at = frontier.findIndex((x) => x.children !== undefined)) >= 0; ) {
    const node = frontier[at];
    rewritten.push(node);
    frontier = [...frontier.slice(0, at), ...node.children!, ...frontier.slice(at + 1)];
    forms.push(form());
  }
  return { forms, rewritten };
}

/**
 * The tree growing along its leftmost derivation: frame s shows the first s variables of
 * the derivation with their children.
 */
export interface TreeFrame {
  caption: I18nText;
  /** how many variables have their children drawn, in the order the derivation rewrites them */
  expanded: number;
}

export function treeAnimation(g: Grammar, tree: TreeNode): TreeFrame[] {
  const { forms, rewritten } = leftmostDerivation(tree);
  const frames: TreeFrame[] = [{ caption: tx("grammar.trees.anim.start", { start: tree.symbol }), expanded: 0 }];
  rewritten.forEach((node, s) =>
    frames.push({
      caption: tx("grammar.trees.anim.step", {
        variable: node.symbol,
        rule: ruleToString(g.rules[node.rule!]),
        before: showSymbols(forms[s]),
        after: showSymbols(forms[s + 1])
      }),
      expanded: s + 1
    })
  );
  frames.push({ caption: tx("grammar.trees.anim.done", { word: showSymbols(forms[forms.length - 1]) }), expanded: rewritten.length });
  return frames;
}
