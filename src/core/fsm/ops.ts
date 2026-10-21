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

/** Not deterministic: several targets somewhere, or ε-transitions — the subset construction fixes both. */
function explainNondeterministic(f: FSM, opId: string, fixCode: string): Diagnostic {
  const a = analyzeFSM(f);
  const spots = [
    ...a.nondeterministicAt.map((n) => `δ(${n.state}, ${n.symbol}) = {${n.targets.join(", ")}}`),
    ...a.epsilonTransitions.map((t) => `${t.from} →ε ${t.to}`)
  ];
  return err(
    tx("ops.needsDeterministic.title", { opKey: `opNames.${opId}` }),
    tx("ops.needsDeterministic.detail", {
      spots: spots.slice(0, 3).join("; "),
      ellipsis: spots.length > 3 ? "; …" : ""
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
      table: { headers: [tx("ops.table.newTransition"), tx("ops.table.reason")], rows: newTransRows }
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

/**
 * The subset construction of the lecture notes (2.16): the states are sets of states, the
 * start state is E({q₀}), and δ'(R, a) = ⋃ E(δ(r, a)) over r ∈ R — with E the ε-closure,
 * so ε-transitions need no removal first. Only the sets reachable from the start are made.
 */
export function determinize(f: FSM): OpResult<FSM> {
  const a = analyzeFSM(f);
  const diags: Diagnostic[] = [];
  const steps: AlgoStep[] = [];

  if (a.isDeterministic) {
    diags.push(info(tx("ops.det.alreadyDeterministic.title"), tx("ops.det.alreadyDeterministic.detail")));
  }

  const tm = transMap(f);
  const acceptSet = new Set(f.accept);
  const closure = (states: Iterable<string>) => epsilonClosure(f, states, tm);

  if (a.hasEpsilon) {
    steps.push({
      title: tx("ops.det.closures.title"),
      detail: tx("ops.det.closures.detail"),
      table: { headers: [tx("ops.table.state"), "E(q)"], rows: f.states.map((q) => [q, setName(closure([q]))]) }
    });
  }

  const startSet = closure([f.start]);
  const queue: Set<string>[] = [startSet];
  const seen = new Set<string>([setName(startSet)]);

  const out = makeFSM({
    name: f.name,
    alphabet: [...f.alphabet],
    states: [],
    start: setName(startSet),
    accept: [],
    transitions: []
  });

  const tableRows: string[][] = [];
  let needEmpty = false;

  while (queue.length) {
    const cur = queue.shift()!;
    const curName = setName(cur);
    out.states.push(curName);
    if ([...cur].some((s) => acceptSet.has(s))) out.accept.push(curName);

    const row = [curName];
    for (const sym of f.alphabet) {
      // one part per element of the set: E(δ(r, a)) — the union of the parts is the next set
      const parts = [...cur].sort().map((r) => closure(tm.get(r)?.get(sym) ?? []));
      const next = new Set(parts.flatMap((p) => [...p]));
      const nextName = setName(next);
      // as the notes write it (2.17): {A} ∪ {C} = {A,C}; one part, or many, is just the set
      row.push(parts.length > 1 && parts.length <= 4 ? `${parts.map(setName).join(" ∪ ")} = ${nextName}` : nextName);
      if (next.size === 0) needEmpty = true;
      addTransition(out, curName, sym, nextName);
      if (!seen.has(nextName) && next.size > 0) {
        seen.add(nextName);
        queue.push(next);
      }
    }
    tableRows.push(row);
  }

  if (needEmpty) {
    out.states.push("∅");
    for (const sym of f.alphabet) addTransition(out, "∅", sym, "∅");
    tableRows.push(["∅", ...f.alphabet.map(() => "∅")]);
    diags.push(info(tx("ops.det.emptySet.title"), tx("ops.det.emptySet.detail")));
  }

  steps.push({
    title: tx("ops.det.step.title"),
    detail: a.hasEpsilon
      ? tx("ops.det.step.detailEpsilon", { start: setName(startSet), startExpr: `E({${f.start}})` })
      : tx("ops.det.step.detail", { start: setName(startSet) }),
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

  // the groups are named A₁, A₂, … as in the notes (2.30); a set is written in state order
  const groupName = (i: number) => `A_${i + 1}`;
  const members = (g: string[]) => `{${g.join(", ")}}`;
  const partText = (p: string[][]) => p.map((g, i) => `${groupName(i)} = ${members(g)}`).join(", ");

  // 0-equivalence (2.4.1): A₁ = Q − F, A₂ = F
  const acceptSet = new Set(work.accept);
  let partition: string[][] = [
    work.states.filter((s) => !acceptSet.has(s)),
    work.states.filter((s) => acceptSet.has(s))
  ].filter((g) => g.length > 0);
  steps.push({
    title: tx("ops.min.step1.title"),
    detail: tx("ops.min.step1.detail", { partition: partText(partition) })
  });

  // refinement: p and q stay together when every letter takes them into the same group
  for (let round = 1; ; round++) {
    const groupOf = new Map<string, number>();
    partition.forEach((g, i) => g.forEach((s) => groupOf.set(s, i)));
    const signature = (s: string) => work.alphabet.map((c) => groupOf.get(delta(s, c))!);

    const next: string[][] = partition.map(() => []);
    const added: string[][] = [];
    const splits: string[] = [];
    const rows: string[][] = [];
    partition.forEach((group, i) => {
      const buckets = new Map<string, string[]>();
      for (const st of group) {
        const key = signature(st).join(",");
        if (!buckets.has(key)) buckets.set(key, []);
        buckets.get(key)!.push(st);
        rows.push([
          groupName(i),
          st,
          ...work.alphabet.map((c) => `${delta(st, c)} ∈ ${groupName(groupOf.get(delta(st, c))!)}`)
        ]);
      }
      const parts = [...buckets.values()];
      // the part with the group's first state keeps its name; the others are new groups at the end
      next[i] = parts[0];
      added.push(...parts.slice(1));
      if (parts.length > 1) {
        const why = parts
          .map(
            (b) =>
              `${members(b)}: ${work.alphabet.map((c, k) => `${c} → ${groupName(signature(b[0])[k])}`).join(", ")}`
          )
          .join("; ");
        splits.push(`${groupName(i)} ⇒ ${why}`);
      }
    });
    const refined = [...next, ...added];
    const table = {
      headers: [tx("ops.min.table.group"), tx("ops.table.state"), ...work.alphabet.map((c) => `δ(·, ${c})`)],
      rows
    };

    if (splits.length === 0) {
      steps.push({
        title: tx("ops.min.fixpoint.title", { round }),
        detail: tx("ops.min.fixpoint.detail", { partition: partText(partition), round, prev: round - 1 }),
        table
      });
      break;
    }
    partition = refined;
    steps.push({
      title: tx("ops.min.refine.title", { round }),
      detail: tx("ops.min.refine.detail", { splits: splits.join(" · "), partition: partText(partition), round }),
      table
    });
  }

  // the classes are the new states (2.29): a one-element class keeps its state's name
  const className = new Map<string, string>();
  for (const g of partition) {
    const nm = g.length === 1 ? g[0] : setName(g);
    for (const st of g) className.set(st, nm);
  }

  const out = makeFSM({
    name: work.name,
    alphabet: [...work.alphabet],
    states: [...new Set(partition.map((g) => className.get(g[0])!))],
    start: className.get(work.start)!,
    accept: [...new Set(work.accept.map((st) => className.get(st)!))],
    transitions: []
  });
  for (const g of partition) {
    const rep = g[0];
    for (const c of work.alphabet) {
      addTransition(out, className.get(rep)!, c, className.get(delta(rep, c))!);
    }
  }
  steps.push({
    title: tx("ops.min.build.title"),
    detail: tx("ops.min.build.detail", {
      start: className.get(work.start)!,
      accept: out.accept.length ? out.accept.join(", ") : "∅"
    }),
    table: {
      headers: [tx("ops.min.table.newState"), tx("ops.min.table.class"), ...work.alphabet.map((c) => `δ(·, ${c})`)],
      rows: partition.map((g) => [
        className.get(g[0])!,
        members(g),
        ...work.alphabet.map((c) => className.get(delta(g[0], c))!)
      ])
    }
  });

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

export function product(first: FSM, second: FSM, mode: ProductMode): OpResult<FSM> {
  let m1 = first;
  let m2 = second;
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
          { label: tx("ops.fix.insertDet"), code: chain(`det(${m.name})`) }
        )
      );
    else if (!a.isDeterministic)
      fixes.push(
        err(
          tx("ops.product.nondeterministic.title", { partKey: labelKey }),
          tx("ops.product.nondeterministic.detail"),
          { label: tx("ops.fix.insertDet"), code: chain(`det(${m.name})`) }
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

  // a common alphabet Σ = Σ₁ ∪ Σ₂ (lecture notes 3.4): an automaton lacking letters of it is
  // incomplete over Σ, and it is completed first (2.10) — the missing letters lead to a trap
  const alphabet = [...new Set([...m1.alphabet, ...m2.alphabet])];
  const preSteps: AlgoStep[] = [];
  const extend = (m: FSM, partKey: string): FSM => {
    const missing = alphabet.filter((c) => !m.alphabet.includes(c));
    if (missing.length === 0) return m;
    const out = withAlphabet(m, alphabet);
    const trap = out.states[out.states.length - 1];
    preSteps.push({
      title: tx("ops.product.extend.title", { partKey, name: m.name }),
      detail: tx("ops.product.extend.detail", {
        name: m.name,
        missing: missing.join(", "),
        sigma: `{${alphabet.join(", ")}}`,
        trap
      })
    });
    return out;
  };
  m1 = extend(m1, "ops.product.first");
  m2 = extend(m2, "ops.product.second");

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
    ...preSteps,
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
/* Concatenation and closure (lecture notes 3.9, 3.10)               */
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

/**
 * Equivalence by lecture notes 5.3: L(A) = L(B) exactly when (L(A) ∩ ¬L(B)) ∪ (¬L(A) ∩ L(B))
 * is empty. Both automata are made complete DFAs over the common alphabet, and a breadth-first
 * search over their product looks for a reachable pair where exactly one accepts — the word
 * leading there is a shortest distinguishing word.
 */
export function checkEquivalence(a: FSM, b: FSM): OpResult<EquivalenceVerdict> {
  const alphabet = [...new Set([...a.alphabet, ...b.alphabet])];
  const steps: AlgoStep[] = [];
  const prepare = (f: FSM): FSM => {
    let m = f;
    if (!analyzeFSM(m).isCompleteDFA) {
      m = determinize(m).value!;
      steps.push({ title: tx("ops.equal.det.title", { name: f.name }), detail: tx("ops.equal.det.detail", { name: f.name, count: m.states.length }) });
    }
    const missing = alphabet.filter((c) => !m.alphabet.includes(c));
    if (missing.length > 0) {
      m = withAlphabet(m, alphabet);
      steps.push({
        title: tx("ops.equal.extend.title", { name: f.name }),
        detail: tx("ops.equal.extend.detail", { name: f.name, missing: missing.join(", "), trap: m.states[m.states.length - 1] })
      });
    }
    return m;
  };
  const da = prepare(a);
  const db = prepare(b);

  // traverse the product, looking for a pair where exactly one side accepts
  const ta = transMap(da);
  const tb = transMap(db);
  const d1 = (s: string, c: string) => [...(ta.get(s)?.get(c) ?? [])][0];
  const d2 = (s: string, c: string) => [...(tb.get(s)?.get(c) ?? [])][0];

  const seen = new Set<string>();
  const queue: { p: string; q: string; word: string }[] = [{ p: da.start, q: db.start, word: "" }];
  seen.add(`${da.start}|${db.start}`);
  const rows: string[][] = [];
  const MAX_ROWS = 60;
  const searchStep = (found: boolean): AlgoStep => ({
    title: tx("ops.equal.search.title"),
    detail: tx(found ? "ops.equal.search.detailFound" : "ops.equal.search.detailNone", { a: a.name, b: b.name, count: seen.size }),
    table: {
      headers: ["(p, q)", tx("ops.equal.table.word"), `p ∈ F(${a.name})`, `q ∈ F(${b.name})`],
      rows: rows.length > MAX_ROWS ? [...rows.slice(0, MAX_ROWS - 1), ["…", "", "", ""], rows[rows.length - 1]] : rows
    }
  });

  while (queue.length) {
    const { p, q, word } = queue.shift()!;
    const accA = da.accept.includes(p);
    const accB = db.accept.includes(q);
    rows.push([`(${p}, ${q})`, word === "" ? EPS : word, accA ? "✓" : "✗", accB ? "✓" : "✗"]);
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
        ...steps,
        searchStep(true),
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

  return okResult({ kind: "verdict", name: "", machineA: a.name, machineB: b.name, equal: true }, [], [
    ...steps,
    searchStep(false),
    { title: tx("ops.equal.proof.title"), detail: tx("ops.equal.proof.detail") }
  ]);
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
