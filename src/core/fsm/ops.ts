import {
  AlgoStep,
  Diagnostic,
  EPS,
  err,
  failResult,
  info,
  okResult,
  OpResult,
  setName,
  tx,
  warn
} from "../types";
import {
  addTransition,
  analyzeFSM,
  cloneFSM,
  disjointStates,
  epsilonClosure,
  freshStateName,
  FSM,
  makeFSM,
  reachableStates,
  transMap
} from "./fsm";

/* ------------------------------------------------------------------ */
/* Precondition explanations                                           */
/* ------------------------------------------------------------------ */

function explainEpsilon(f: FSM, opId: string, fixCode: string): Diagnostic {
  const a = analyzeFSM(f);
  const list = a.epsilonTransitions
    .slice(0, 4)
    .map((t) => `${t.from} →ε ${t.to}`)
    .join(", ");
  return err(
    tx("ops.needsEpsilonFree.title", { opKey: `opNames.${opId}` }),
    tx("ops.needsEpsilonFree.detail", {
      count: a.epsilonTransitions.length,
      list,
      ellipsis: a.epsilonTransitions.length > 4 ? ", …" : ""
    }),
    { label: tx("ops.fix.insertEpsfree"), code: fixCode }
  );
}

function explainNondeterministic(f: FSM, opId: string, fixCode: string): Diagnostic {
  const a = analyzeFSM(f);
  const spots = a.nondeterministicAt
    .slice(0, 3)
    .map((n) => `δ(${n.state}, ${n.symbol}) = {${n.targets.join(", ")}}`)
    .join("; ");
  return err(
    tx("ops.needsDeterministic.title", { opKey: `opNames.${opId}` }),
    tx("ops.needsDeterministic.detail", {
      spots,
      ellipsis: a.nondeterministicAt.length > 3 ? "; …" : ""
    }),
    { label: tx("ops.fix.insertDet"), code: fixCode }
  );
}

function explainIncomplete(f: FSM, opId: string, fixCode: string, level: "error" | "warning" = "error"): Diagnostic {
  const a = analyzeFSM(f);
  const spots = a.missing
    .slice(0, 4)
    .map((m) => `δ(${m.state}, ${m.symbol})`)
    .join(", ");
  const make = level === "error" ? err : warn;
  return make(
    tx("ops.needsComplete.title", { opKey: `opNames.${opId}` }),
    tx("ops.needsComplete.detail", {
      spots,
      ellipsis: a.missing.length > 4 ? ", …" : "",
      count: a.missing.length
    }),
    { label: tx("ops.fix.insertComplete"), code: fixCode }
  );
}

/* ------------------------------------------------------------------ */
/* ε-removal                                                           */
/* ------------------------------------------------------------------ */

export function removeEpsilon(f: FSM): OpResult<FSM> {
  const a = analyzeFSM(f);
  const steps: AlgoStep[] = [];
  const diags: Diagnostic[] = [];

  if (!a.hasEpsilon) {
    diags.push(info(tx("ops.epsfree.alreadyFree.title"), tx("ops.epsfree.alreadyFree.detail")));
    return okResult(cloneFSM(f), diags, steps);
  }

  const tm = transMap(f);
  const closureRows: string[][] = [];
  const closures = new Map<string, Set<string>>();
  for (const s of f.states) {
    const cl = epsilonClosure(f, [s], tm);
    closures.set(s, cl);
    closureRows.push([s, setName(cl)]);
  }
  steps.push({
    title: tx("ops.epsfree.step1.title"),
    detail: tx("ops.epsfree.step1.detail"),
    table: { headers: [tx("ops.table.state"), "E(q)"], rows: closureRows }
  });

  const out = makeFSM({
    name: f.name,
    alphabet: [...f.alphabet],
    states: [...f.states],
    start: f.start,
    accept: [...f.accept],
    transitions: []
  });

  const newTransRows: string[][] = [];
  for (const q of f.states) {
    for (const p of closures.get(q)!) {
      const inner = tm.get(p);
      if (!inner) continue;
      for (const [sym, targets] of inner) {
        if (sym === EPS) continue;
        for (const t of targets) {
          // δ'(q, a) ∋ elements of E(t) — in the textbook definition δ'(q,a) = E(δ(E(q),a))
          for (const t2 of closures.get(t)!) {
            if (!out.transitions.some((x) => x.from === q && x.symbol === sym && x.to === t2)) {
              addTransition(out, q, sym, t2);
              if (p !== q || t2 !== t)
                newTransRows.push([
                  `δ'(${q}, ${sym}) ∋ ${t2}`,
                  `${p} ∈ E(${q}), δ(${p},${sym}) ∋ ${t}, ${t2} ∈ E(${t})`
                ]);
            }
          }
        }
      }
    }
  }
  if (newTransRows.length)
    steps.push({
      title: tx("ops.epsfree.step2.title"),
      detail: tx("ops.epsfree.step2.detail"),
      table: { headers: [tx("ops.table.newTransition"), tx("ops.table.reason")], rows: newTransRows.slice(0, 25) }
    });

  const newAccept: string[] = [];
  for (const q of f.states) {
    if ([...closures.get(q)!].some((s) => f.accept.includes(s))) newAccept.push(q);
  }
  const becameAccepting = newAccept.filter((s) => !f.accept.includes(s));
  out.accept = newAccept;
  steps.push({
    title: tx("ops.epsfree.step3.title"),
    detail:
      becameAccepting.length > 0
        ? tx("ops.epsfree.step3.detailChanged", { list: becameAccepting.join(", ") })
        : tx("ops.epsfree.step3.detailUnchanged")
  });

  return okResult(out, diags, steps);
}

/* ------------------------------------------------------------------ */
/* Determinisation (powerset construction)                            */
/* ------------------------------------------------------------------ */

export function determinize(f: FSM): OpResult<FSM> {
  const a = analyzeFSM(f);
  const diags: Diagnostic[] = [];
  const steps: AlgoStep[] = [];

  if (a.hasEpsilon) {
    return failResult([explainEpsilon(f, "det", `det(epsfree(${f.name}))`)]);
  }

  if (a.isDeterministic) {
    diags.push(info(tx("ops.det.alreadyDeterministic.title"), tx("ops.det.alreadyDeterministic.detail")));
  }
  if (!a.isComplete) {
    diags.push(info(tx("ops.det.notComplete.title"), tx("ops.det.notComplete.detail")));
  }

  const tm = transMap(f);
  const acceptSet = new Set(f.accept);

  const startSet = new Set([f.start]);
  const queue: Set<string>[] = [startSet];
  const seen = new Map<string, Set<string>>();
  seen.set(setName(startSet), startSet);

  const out = makeFSM({
    name: f.name,
    alphabet: [...f.alphabet],
    states: [],
    start: setName(startSet),
    accept: [],
    transitions: []
  });

  const tableRows: string[][] = [];
  const needEmpty = { value: false };

  while (queue.length) {
    const cur = queue.shift()!;
    const curName = setName(cur);
    if (!out.states.includes(curName)) out.states.push(curName);
    if ([...cur].some((s) => acceptSet.has(s)) && !out.accept.includes(curName)) out.accept.push(curName);

    const row = [curName];
    for (const sym of f.alphabet) {
      let next = new Set<string>();
      for (const s of cur) {
        const targets = tm.get(s)?.get(sym);
        if (targets) for (const t of targets) next.add(t);
      }
      const nextName = setName(next);
      row.push(nextName);
      if (next.size === 0) needEmpty.value = true;
      addTransition(out, curName, sym, nextName);
      if (!seen.has(nextName) && next.size > 0) {
        seen.set(nextName, next);
        queue.push(next);
      }
    }
    tableRows.push(row);
  }

  if (needEmpty.value) {
    out.states.push("∅");
    for (const sym of f.alphabet) addTransition(out, "∅", sym, "∅");
    tableRows.push(["∅", ...f.alphabet.map(() => "∅")]);
  }

  steps.push({
    title: tx("ops.det.step.title"),
    detail: tx("ops.det.step.detail"),
    table: { headers: [tx("ops.table.stateSet"), ...f.alphabet], rows: tableRows }
  });
  steps.push({
    title: tx("ops.det.result.title"),
    detail: tx("ops.det.result.detail", {
      count: out.states.length,
      possible: 2 ** f.states.length,
      exponent: f.states.length,
      accept: out.accept.length ? out.accept.join(", ") : "—"
    })
  });

  return okResult(out, diags, steps);
}

/* ------------------------------------------------------------------ */
/* Completion                                                          */
/* ------------------------------------------------------------------ */

export function complete(f: FSM, trapName?: string): OpResult<FSM> {
  const a = analyzeFSM(f);
  const steps: AlgoStep[] = [];
  const diags: Diagnostic[] = [];

  if (a.isComplete) {
    diags.push(info(tx("ops.complete.alreadyComplete.title"), tx("ops.complete.alreadyComplete.detail")));
    return okResult(cloneFSM(f), diags, steps);
  }

  const out = cloneFSM(f);
  const trap = trapName && trapName.trim() !== "" ? trapName.trim() : freshStateName(f.states, "T");
  if (out.states.includes(trap)) {
    return failResult([
      err(
        tx("ops.complete.nameTaken.title", { trap }),
        tx("ops.complete.nameTaken.detail"),
        { label: tx("ops.complete.nameTaken.fixLabel"), code: `complete(${f.name})` }
      )
    ]);
  }
  out.states.push(trap);

  const added: string[][] = [];
  for (const m of a.missing) {
    addTransition(out, m.state, m.symbol, trap);
    added.push([`δ(${m.state}, ${m.symbol})`, trap]);
  }
  for (const sym of out.alphabet) addTransition(out, trap, sym, trap);

  steps.push({
    title: tx("ops.complete.step.title", { trap }),
    detail: tx("ops.complete.step.detail", { trap }),
    table: { headers: [tx("ops.table.missingTransition"), tx("ops.table.newTarget")], rows: added }
  });

  return okResult(out, diags, steps);
}

/* ------------------------------------------------------------------ */
/* Reachable part                                                      */
/* ------------------------------------------------------------------ */

export function reachable(f: FSM): OpResult<FSM> {
  const reach = reachableStates(f);
  const removed = f.states.filter((s) => !reach.has(s));
  const diags: Diagnostic[] = [];
  const steps: AlgoStep[] = [];

  if (removed.length === 0) {
    diags.push(info(tx("ops.reachable.allReachable.title"), tx("ops.reachable.allReachable.detail")));
    return okResult(cloneFSM(f), diags, steps);
  }

  const out = makeFSM({
    name: f.name,
    alphabet: [...f.alphabet],
    states: f.states.filter((s) => reach.has(s)),
    start: f.start,
    accept: f.accept.filter((s) => reach.has(s)),
    transitions: f.transitions.filter((t) => reach.has(t.from) && reach.has(t.to))
  });

  steps.push({
    title: tx("ops.reachable.step.title"),
    detail: tx("ops.reachable.step.detail", { removed: removed.join(", ") })
  });

  return okResult(out, diags, steps);
}

/* ------------------------------------------------------------------ */
/* Minimisation (partition refinement)                                */
/* ------------------------------------------------------------------ */

export function minimize(f: FSM): OpResult<FSM> {
  const a = analyzeFSM(f);
  const diags: Diagnostic[] = [];

  // Preconditions with a precise explanation and a fix chain
  if (a.hasEpsilon) {
    return failResult([explainEpsilon(f, "min", `min(det(epsfree(${f.name})))`)]);
  }
  if (!a.isDeterministic) {
    return failResult([explainNondeterministic(f, "min", `min(det(${f.name}))`)]);
  }
  if (!a.isComplete) {
    return failResult([explainIncomplete(f, "min", `min(complete(${f.name}))`)]);
  }

  let work = f;
  const steps: AlgoStep[] = [];
  if (a.unreachableStates.length > 0) {
    diags.push(
      warn(
        tx("ops.min.unreachableStates.title"),
        tx("ops.min.unreachableStates.detail", { states: a.unreachableStates.join(", ") })
      )
    );
    work = reachable(f).value!;
    steps.push({
      title: tx("ops.min.step0.title"),
      detail: tx("ops.min.step0.detail", { removed: a.unreachableStates.join(", ") })
    });
  }

  const tm = transMap(work);
  const delta = (s: string, c: string) => [...(tm.get(s)?.get(c) ?? [])][0];

  // Initial partition: {accepting, non-accepting}
  const acceptSet = new Set(work.accept);
  let partition: string[][] = [
    work.states.filter((s) => acceptSet.has(s)),
    work.states.filter((s) => !acceptSet.has(s))
  ].filter((g) => g.length > 0);

  const partName = (p: string[][]) => p.map((g) => setName(g)).join("  ");
  steps.push({
    title: tx("ops.min.step1.title"),
    detail: tx("ops.min.step1.detail", { partition: partName(partition) })
  });

  let round = 2;
  let changed = true;
  while (changed) {
    changed = false;
    const groupOf = new Map<string, number>();
    partition.forEach((g, i) => g.forEach((s) => groupOf.set(s, i)));

    const next: string[][] = [];
    const rows: string[][] = [];
    for (const group of partition) {
      // signature: which group each symbol leads to
      const buckets = new Map<string, string[]>();
      for (const s of group) {
        const sig = work.alphabet.map((c) => groupOf.get(delta(s, c))!).join(",");
        if (!buckets.has(sig)) buckets.set(sig, []);
        buckets.get(sig)!.push(s);
        rows.push([s, ...work.alphabet.map((c) => `${delta(s, c)} ∈ ${setName(partition[groupOf.get(delta(s, c))!])}`)]);
      }
      if (buckets.size > 1) changed = true;
      for (const b of buckets.values()) next.push(b);
    }

    if (changed) {
      steps.push({
        title: tx("ops.min.refine.title", { round }),
        detail: tx("ops.min.refine.detail", { partition: partName(next) }),
        table: { headers: [tx("ops.table.state"), ...work.alphabet.map((c) => `δ(·, ${c})`)], rows }
      });
      round++;
    } else {
      steps.push({
        title: tx("ops.min.fixpoint.title", { round }),
        detail: tx("ops.min.fixpoint.detail", { partition: partName(partition) })
      });
    }
    partition = next;
  }

  // New automaton from the classes
  const className = new Map<string, string>();
  for (const g of partition) {
    const nm = g.length === 1 ? g[0] : setName(g);
    for (const s of g) className.set(s, nm);
  }

  const out = makeFSM({
    name: work.name,
    alphabet: [...work.alphabet],
    states: [...new Set(partition.map((g) => className.get(g[0])!))],
    start: className.get(work.start)!,
    accept: [...new Set(work.accept.map((s) => className.get(s)!))],
    transitions: []
  });
  for (const g of partition) {
    const rep = g[0];
    for (const c of work.alphabet) {
      addTransition(out, className.get(rep)!, c, className.get(delta(rep, c))!);
    }
  }

  if (out.states.length === work.states.length) {
    diags.push(info(tx("ops.min.alreadyMinimal.title"), tx("ops.min.alreadyMinimal.detail")));
  } else {
    diags.push(
      info(
        tx("ops.min.minimized.title", { before: work.states.length, after: out.states.length }),
        tx("ops.min.minimized.detail")
      )
    );
  }

  return okResult(out, diags, steps);
}

/* ------------------------------------------------------------------ */
/* Complement                                                          */
/* ------------------------------------------------------------------ */

export function complement(f: FSM): OpResult<FSM> {
  const a = analyzeFSM(f);
  if (a.hasEpsilon) return failResult([explainEpsilon(f, "complement", `complement(det(epsfree(${f.name})))`)]);
  if (!a.isDeterministic)
    return failResult([
      explainNondeterministic(f, "complement", `complement(det(${f.name}))`),
      info(tx("ops.complement.whyDfa.title"), tx("ops.complement.whyDfa.detail"))
    ]);
  if (!a.isComplete)
    return failResult([
      explainIncomplete(f, "complement", `complement(complete(${f.name}))`),
      info(tx("ops.complement.whyComplete.title"), tx("ops.complement.whyComplete.detail"))
    ]);

  const out = cloneFSM(f);
  out.accept = f.states.filter((s) => !f.accept.includes(s));
  return okResult(out, [], [
    {
      title: tx("ops.complement.step.title"),
      detail: tx("ops.complement.step.detail", { accept: out.accept.length ? out.accept.join(", ") : "∅" })
    }
  ]);
}

/* ------------------------------------------------------------------ */
/* Product construction: union / intersection / difference          */
/* ------------------------------------------------------------------ */

export type ProductMode = "union" | "intersect" | "difference";

export function product(m1: FSM, m2: FSM, mode: ProductMode): OpResult<FSM> {
  const diags: Diagnostic[] = [];
  const fixes: Diagnostic[] = [];

  for (const [m, labelKey] of [
    [m1, "ops.product.first"],
    [m2, "ops.product.second"]
  ] as const) {
    const a = analyzeFSM(m);
    const chain = (inner: string) => {
      const opCall = mode === "union" ? "union" : mode === "intersect" ? "intersect" : "difference";
      const left = m === m1 ? inner : m1.name;
      const right = m === m2 ? inner : m2.name;
      return `${opCall}(${left}, ${right})`;
    };
    if (a.hasEpsilon)
      fixes.push(
        err(
          tx("ops.product.hasEpsilon.title", { partKey: labelKey }),
          tx("ops.product.hasEpsilon.detail"),
          { label: tx("ops.fix.insertChain"), code: chain(`complete(det(epsfree(${m.name})))`) }
        )
      );
    else if (!a.isDeterministic)
      fixes.push(
        err(
          tx("ops.product.nondeterministic.title", { partKey: labelKey }),
          tx("ops.product.nondeterministic.detail"),
          { label: tx("ops.fix.insertDet"), code: chain(`complete(det(${m.name}))`) }
        )
      );
    else if (!a.isComplete)
      fixes.push(
        err(
          tx("ops.product.incomplete.title", { partKey: labelKey }),
          mode === "union"
            ? tx("ops.product.incomplete.detailUnion")
            : tx("ops.product.incomplete.detailOther"),
          { label: tx("ops.fix.insertComplete"), code: chain(`complete(${m.name})`) }
        )
      );
  }
  if (fixes.length > 0) return failResult(fixes);

  // common alphabet
  const alphabet = [...new Set([...m1.alphabet, ...m2.alphabet])];
  const missing1 = alphabet.filter((c) => !m1.alphabet.includes(c));
  const missing2 = alphabet.filter((c) => !m2.alphabet.includes(c));
  if (missing1.length || missing2.length) {
    return failResult([
      err(
        tx("ops.product.differentAlphabets.title"),
        tx("ops.product.differentAlphabets.detail", {
          missing1: missing1.length ? missing1.join(", ") : "—",
          missing2: missing2.length ? missing2.join(", ") : "—",
          modeKey: `opNames.${mode}`
        })
      )
    ]);
  }

  const t1 = transMap(m1);
  const t2 = transMap(m2);
  const d1 = (s: string, c: string) => [...(t1.get(s)?.get(c) ?? [])][0];
  const d2 = (s: string, c: string) => [...(t2.get(s)?.get(c) ?? [])][0];

  const pairName = (p: string, q: string) => `(${p},${q})`;
  const acceptRule = (p: string, q: string): boolean => {
    const a1 = m1.accept.includes(p);
    const a2 = m2.accept.includes(q);
    if (mode === "union") return a1 || a2;
    if (mode === "intersect") return a1 && a2;
    return a1 && !a2;
  };

  const out = makeFSM({
    name: `${m1.name}_${m2.name}`,
    alphabet,
    states: [],
    start: pairName(m1.start, m2.start),
    accept: [],
    transitions: []
  });

  const queue: [string, string][] = [[m1.start, m2.start]];
  const seen = new Set<string>([pairName(m1.start, m2.start)]);
  const rows: string[][] = [];

  while (queue.length) {
    const [p, q] = queue.shift()!;
    const nm = pairName(p, q);
    out.states.push(nm);
    if (acceptRule(p, q)) out.accept.push(nm);
    const row = [nm];
    for (const c of alphabet) {
      const np = d1(p, c);
      const nq = d2(q, c);
      const tn = pairName(np, nq);
      addTransition(out, nm, c, tn);
      row.push(tn);
      if (!seen.has(tn)) {
        seen.add(tn);
        queue.push([np, nq]);
      }
    }
    rows.push(row);
  }

  const acceptDetailKey =
    mode === "union"
      ? "ops.product.acceptRule.union"
      : mode === "intersect"
        ? "ops.product.acceptRule.intersect"
        : "ops.product.acceptRule.difference";

  const steps: AlgoStep[] = [
    {
      title: tx("ops.product.step.title", { modeKey: `opNames.${mode}` }),
      detail: tx("ops.product.step.detail", { acceptRuleKey: acceptDetailKey }),
      table: { headers: [tx("ops.table.statePair"), ...alphabet], rows }
    }
  ];

  return okResult(out, diags, steps);
}

/** Union of arbitrary (even nondeterministic) automata: a new start state with ε-transitions. */
export function unionEpsilon(m1: FSM, m2: FSM): OpResult<FSM> {
  const b = disjointStates(m1, m2);
  const start = freshStateName([...m1.states, ...b.states], "S0");
  const out = makeFSM({
    name: `${m1.name}_${m2.name}`,
    alphabet: [...new Set([...m1.alphabet, ...b.alphabet])],
    states: [start, ...m1.states, ...b.states],
    start,
    accept: [...m1.accept, ...b.accept],
    transitions: [
      { from: start, symbol: EPS, to: m1.start },
      { from: start, symbol: EPS, to: b.start },
      ...m1.transitions.map((t) => ({ ...t })),
      ...b.transitions.map((t) => ({ ...t }))
    ]
  });
  return okResult(out, [
    info(tx("ops.unionEpsilon.info.title"), tx("ops.unionEpsilon.info.detail"))
  ], [
    {
      title: tx("ops.unionEpsilon.step.title"),
      detail: tx("ops.unionEpsilon.step.detail", { start, m1start: m1.start, bstart: b.start })
    }
  ]);
}

/* ------------------------------------------------------------------ */
/* Concatenation and closure (Thompson style)                         */
/* ------------------------------------------------------------------ */

export function concatFSM(m1: FSM, m2: FSM): OpResult<FSM> {
  const b = disjointStates(m1, m2);
  const out = makeFSM({
    name: `${m1.name}${m2.name}`,
    alphabet: [...new Set([...m1.alphabet, ...b.alphabet])],
    states: [...m1.states, ...b.states],
    start: m1.start,
    accept: [...b.accept],
    transitions: [
      ...m1.transitions.map((t) => ({ ...t })),
      ...b.transitions.map((t) => ({ ...t })),
      ...m1.accept.map((a) => ({ from: a, symbol: EPS, to: b.start }))
    ]
  });
  return okResult(out, [], [
    {
      title: tx("ops.concat.step.title"),
      detail: tx("ops.concat.step.detail", { start: b.start })
    }
  ]);
}

export function starFSM(f: FSM): OpResult<FSM> {
  const start = freshStateName(f.states, "S0");
  const out = makeFSM({
    name: `${f.name}★`,
    alphabet: [...f.alphabet],
    states: [start, ...f.states],
    start,
    accept: [start, ...f.accept],
    transitions: [
      { from: start, symbol: EPS, to: f.start },
      ...f.transitions.map((t) => ({ ...t })),
      ...f.accept.map((a) => ({ from: a, symbol: EPS, to: start }))
    ]
  });
  return okResult(out, [], [
    {
      title: tx("ops.star.step.title"),
      detail: tx("ops.star.step.detail", { start })
    }
  ]);
}

/* ------------------------------------------------------------------ */
/* Reversal                                                            */
/* ------------------------------------------------------------------ */

export function reverseFSM(f: FSM): OpResult<FSM> {
  const start = freshStateName(f.states, "R0");
  const out = makeFSM({
    name: `${f.name}ᴿ`,
    alphabet: [...f.alphabet],
    states: [start, ...f.states],
    start,
    accept: [f.start],
    transitions: [
      ...f.accept.map((a) => ({ from: start, symbol: EPS, to: a })),
      ...f.transitions.map((t) => ({ from: t.to, symbol: t.symbol, to: t.from }))
    ]
  });
  return okResult(out, [], [
    {
      title: tx("ops.reverse.step.title"),
      detail: tx("ops.reverse.step.detail", { start })
    }
  ]);
}

/* ------------------------------------------------------------------ */
/* State renaming (clean-up)                                          */
/* ------------------------------------------------------------------ */

export function cleanFSM(f: FSM): OpResult<FSM> {
  const names = new Map<string, string>();
  const alpha = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  // rename in BFS order so that the start state becomes A
  const order: string[] = [];
  const tm = transMap(f);
  const queue = [f.start];
  const seen = new Set<string>();
  while (queue.length) {
    const s = queue.shift()!;
    if (seen.has(s)) continue;
    seen.add(s);
    order.push(s);
    const inner = tm.get(s);
    if (inner)
      for (const sym of [...inner.keys()].sort())
        for (const t of [...inner.get(sym)!].sort()) queue.push(t);
  }
  for (const s of f.states) if (!seen.has(s)) order.push(s);

  order.forEach((s, i) => {
    names.set(s, i < alpha.length ? alpha[i] : `Q${i}`);
  });
  const rn = (s: string) => names.get(s) ?? s;

  const out = makeFSM({
    name: f.name,
    alphabet: [...f.alphabet],
    states: f.states.map(rn),
    start: rn(f.start),
    accept: f.accept.map(rn),
    transitions: f.transitions.map((t) => ({ from: rn(t.from), symbol: t.symbol, to: rn(t.to) }))
  });

  return okResult(out, [], [
    {
      title: tx("ops.clean.step.title"),
      detail: tx("ops.clean.step.detail"),
      table: { headers: [tx("ops.table.oldName"), tx("ops.table.newName")], rows: order.map((s) => [s, names.get(s)!]) }
    }
  ]);
}

/* ------------------------------------------------------------------ */
/* Equivalence check with a counterexample                            */
/* ------------------------------------------------------------------ */

export interface EquivalenceVerdict {
  kind: "verdict";
  name: string;
  machineA: string;
  machineB: string;
  equal: boolean;
  /** a word accepted by one but not the other */
  counterexample?: { word: string; acceptedBy: string; rejectedBy: string };
}

/** Normalises an arbitrary (ε-)NFA into a complete DFA. */
function normalizeToCompleteDFA(f: FSM): FSM {
  let m = f;
  const a = analyzeFSM(m);
  if (a.hasEpsilon) m = removeEpsilon(m).value!;
  m = determinize(m).value!; // our determinisation yields a complete DFA (with a ∅ state)
  return m;
}

export function checkEquivalence(a: FSM, b: FSM): OpResult<EquivalenceVerdict> {
  const alphabet = [...new Set([...a.alphabet, ...b.alphabet])];
  const da = withAlphabet(normalizeToCompleteDFA(a), alphabet);
  const db = withAlphabet(normalizeToCompleteDFA(b), alphabet);

  // traverse the product, looking for a pair where exactly one side accepts
  const ta = transMap(da);
  const tb = transMap(db);
  const d1 = (s: string, c: string) => [...(ta.get(s)?.get(c) ?? [])][0];
  const d2 = (s: string, c: string) => [...(tb.get(s)?.get(c) ?? [])][0];

  const seen = new Set<string>();
  const queue: { p: string; q: string; word: string }[] = [{ p: da.start, q: db.start, word: "" }];
  seen.add(`${da.start}|${db.start}`);

  while (queue.length) {
    const { p, q, word } = queue.shift()!;
    const accA = da.accept.includes(p);
    const accB = db.accept.includes(q);
    if (accA !== accB) {
      const verdict: EquivalenceVerdict = {
        kind: "verdict",
        name: "",
        machineA: a.name,
        machineB: b.name,
        equal: false,
        counterexample: {
          word: word === "" ? EPS : word,
          acceptedBy: accA ? a.name : b.name,
          rejectedBy: accA ? b.name : a.name
        }
      };
      return okResult(verdict, [], [
        {
          title: tx("ops.equal.counterexampleSearch.title"),
          detail: tx("ops.equal.counterexampleSearch.detail", { word: word === "" ? "ε" : word })
        }
      ]);
    }
    for (const c of alphabet) {
      const np = d1(p, c);
      const nq = d2(q, c);
      if (np === undefined || nq === undefined) continue;
      const key = `${np}|${nq}`;
      if (!seen.has(key)) {
        seen.add(key);
        queue.push({ p: np, q: nq, word: word + c });
      }
    }
  }

  return okResult(
    { kind: "verdict", name: "", machineA: a.name, machineB: b.name, equal: true },
    [],
    [
      {
        title: tx("ops.equal.proof.title"),
        detail: tx("ops.equal.proof.detail")
      }
    ]
  );
}

/** Extends the alphabet (stays a complete DFA: missing symbols go to a trap). */
function withAlphabet(f: FSM, alphabet: string[]): FSM {
  const missing = alphabet.filter((c) => !f.alphabet.includes(c));
  if (missing.length === 0) return f;
  const out = cloneFSM(f);
  out.alphabet = [...alphabet];
  const trap = freshStateName(out.states, "T");
  out.states.push(trap);
  for (const s of out.states) for (const c of missing) addTransition(out, s, c, trap);
  for (const c of out.alphabet) addTransition(out, trap, c, trap);
  return out;
}
