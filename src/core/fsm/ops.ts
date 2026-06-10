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
/* Előfeltétel-magyarázatok                                            */
/* ------------------------------------------------------------------ */

function explainEpsilon(f: FSM, opName: string, fixCode: string): Diagnostic {
  const a = analyzeFSM(f);
  const list = a.epsilonTransitions
    .slice(0, 4)
    .map((t) => `${t.from} →ε ${t.to}`)
    .join(", ");
  return err(
    `A(z) ${opName} művelethez ε-mentes automata kell`,
    `Az automata ${a.epsilonTransitions.length} ε-átmenetet tartalmaz (${list}${
      a.epsilonTransitions.length > 4 ? ", …" : ""
    }). Az ε-átmenet üres szó beolvasásával vált állapotot, ezért előbb az ε-mentesítést kell elvégezni: minden állapothoz kiszámoljuk az ε-lezárását, és az onnan induló átmeneteket „behúzzuk” az eredeti állapotba.`,
    { label: "ε-mentesítés beszúrása", code: fixCode }
  );
}

function explainNondeterministic(f: FSM, opName: string, fixCode: string): Diagnostic {
  const a = analyzeFSM(f);
  const spots = a.nondeterministicAt
    .slice(0, 3)
    .map((n) => `δ(${n.state}, ${n.symbol}) = {${n.targets.join(", ")}}`)
    .join("; ");
  return err(
    `A(z) ${opName} művelethez determinisztikus automata kell`,
    `Nemdeterminizmus található: ${spots}${
      a.nondeterministicAt.length > 3 ? "; …" : ""
    }. Determinisztikus automatában minden (állapot, szimbólum) párhoz pontosan egy következő állapot tartozhat. A hatványhalmaz-konstrukcióval (determinizálás) ekvivalens DFA készíthető.`,
    { label: "determinizálás beszúrása", code: fixCode }
  );
}

function explainIncomplete(f: FSM, opName: string, fixCode: string, level: "error" | "warning" = "error"): Diagnostic {
  const a = analyzeFSM(f);
  const spots = a.missing
    .slice(0, 4)
    .map((m) => `δ(${m.state}, ${m.symbol})`)
    .join(", ");
  const make = level === "error" ? err : warn;
  return make(
    `A(z) ${opName} művelethez teljes automata kell`,
    `Hiányzó átmenetek: ${spots}${
      a.missing.length > 4 ? ", …" : ""
    } — összesen ${a.missing.length} (állapot, szimbólum) párnál nincs definiálva átmenet. Teljessé tételhez bevezetünk egy új „csapda” (elutasító) állapotot, és minden hiányzó átmenetet oda irányítunk.`,
    { label: "teljessé tétel beszúrása", code: fixCode }
  );
}

/* ------------------------------------------------------------------ */
/* ε-mentesítés                                                        */
/* ------------------------------------------------------------------ */

export function removeEpsilon(f: FSM): OpResult<FSM> {
  const a = analyzeFSM(f);
  const steps: AlgoStep[] = [];
  const diags: Diagnostic[] = [];

  if (!a.hasEpsilon) {
    diags.push(info("Az automata már ε-mentes", "Nincs ε-átmenet, a művelet az automatát változatlanul adja vissza."));
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
    title: "1. ε-lezárások kiszámítása",
    detail: "Minden q állapotra: E(q) = a q-ból csak ε-átmenetekkel elérhető állapotok halmaza (q-t is beleértve).",
    table: { headers: ["állapot", "E(q)"], rows: closureRows }
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
          // δ'(q, a) ∋ E(t) elemei — a tankönyvi definícióban δ'(q,a) = E(δ(E(q),a))
          for (const t2 of closures.get(t)!) {
            if (!out.transitions.some((x) => x.from === q && x.symbol === sym && x.to === t2)) {
              addTransition(out, q, sym, t2);
              if (p !== q || t2 !== t)
                newTransRows.push([`δ'(${q}, ${sym}) ∋ ${t2}`, `mert ${p} ∈ E(${q}) és δ(${p},${sym}) ∋ ${t}, ${t2} ∈ E(${t})`]);
            }
          }
        }
      }
    }
  }
  if (newTransRows.length)
    steps.push({
      title: "2. Új átmenetek bevezetése",
      detail: "δ'(q, a) = E(δ(E(q), a)) — az ε-lezáráson keresztül elérhető átmeneteket közvetlenné tesszük.",
      table: { headers: ["új átmenet", "indoklás"], rows: newTransRows.slice(0, 25) }
    });

  const newAccept: string[] = [];
  for (const q of f.states) {
    if ([...closures.get(q)!].some((s) => f.accept.includes(s))) newAccept.push(q);
  }
  const becameAccepting = newAccept.filter((s) => !f.accept.includes(s));
  out.accept = newAccept;
  steps.push({
    title: "3. Elfogadó állapotok bővítése",
    detail:
      becameAccepting.length > 0
        ? `Ha E(q) tartalmaz elfogadó állapotot, q is elfogadó lesz. Új elfogadó állapotok: ${becameAccepting.join(", ")}.`
        : "Egyetlen állapot ε-lezárása sem tartalmaz új elfogadó állapotot, így az elfogadó halmaz változatlan."
  });

  return okResult(out, diags, steps);
}

/* ------------------------------------------------------------------ */
/* Determinizálás (hatványhalmaz-konstrukció)                          */
/* ------------------------------------------------------------------ */

export function determinize(f: FSM): OpResult<FSM> {
  const a = analyzeFSM(f);
  const diags: Diagnostic[] = [];
  const steps: AlgoStep[] = [];

  if (a.hasEpsilon) {
    return failResult([explainEpsilon(f, "determinizálás", `det(epsfree(${f.name}))`)]);
  }

  if (a.isDeterministic) {
    diags.push(
      info(
        "Az automata már determinisztikus",
        "Minden (állapot, szimbólum) párhoz legfeljebb egy átmenet tartozik és nincs ε-átmenet — a hatványhalmaz-konstrukció csak az elérhető egyelemű halmazokat hozza létre."
      )
    );
  }
  if (!a.isComplete) {
    diags.push(
      info(
        "Az automata nem teljes — a ∅ állapot megjelenhet",
        "Ahol nincs átmenet, ott a hatványhalmaz-konstrukcióban az üres halmazba (∅) jutunk, amely csapdaállapotként viselkedik. Ettől az eredmény teljes DFA lesz."
      )
    );
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
    title: "Hatványhalmaz-konstrukció",
    detail:
      "A kezdőállapotból indulva minden elért állapothalmazra és minden szimbólumra kiszámoljuk az elérhető állapotok halmazát. Csak az elérhető halmazokat vesszük fel. Egy halmaz akkor elfogadó, ha tartalmaz eredeti elfogadó állapotot.",
    table: { headers: ["állapothalmaz", ...f.alphabet], rows: tableRows }
  });
  steps.push({
    title: "Eredmény",
    detail: `${out.states.length} állapot keletkezett a lehetséges 2^${f.states.length} = ${
      2 ** f.states.length
    } részhalmazból. Elfogadó: ${out.accept.length ? out.accept.join(", ") : "—"}.`
  });

  return okResult(out, diags, steps);
}

/* ------------------------------------------------------------------ */
/* Teljessé tétel                                                      */
/* ------------------------------------------------------------------ */

export function complete(f: FSM, trapName?: string): OpResult<FSM> {
  const a = analyzeFSM(f);
  const steps: AlgoStep[] = [];
  const diags: Diagnostic[] = [];

  if (a.isComplete) {
    diags.push(info("Az automata már teljes", "Minden (állapot, szimbólum) párhoz van átmenet — nincs teendő."));
    return okResult(cloneFSM(f), diags, steps);
  }

  const out = cloneFSM(f);
  const trap = trapName && trapName.trim() !== "" ? trapName.trim() : freshStateName(f.states, "T");
  if (out.states.includes(trap)) {
    return failResult([
      err(
        `A(z) „${trap}” állapotnév már létezik`,
        "A teljessé tételhez egy új, eddig nem használt csapdaállapot-név kell.",
        { label: "automatikus név használata", code: `complete(${f.name})` }
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
    title: `Csapdaállapot bevezetése: ${trap}`,
    detail: `Az új ${trap} állapot nem elfogadó, és minden szimbólumra önmagába megy — innen már nem lehet elfogadni. A hiányzó átmenetek ide kerülnek.`,
    table: { headers: ["hiányzó átmenet", "új cél"], rows: added }
  });

  return okResult(out, diags, steps);
}

/* ------------------------------------------------------------------ */
/* Elérhető rész                                                       */
/* ------------------------------------------------------------------ */

export function reachable(f: FSM): OpResult<FSM> {
  const reach = reachableStates(f);
  const removed = f.states.filter((s) => !reach.has(s));
  const diags: Diagnostic[] = [];
  const steps: AlgoStep[] = [];

  if (removed.length === 0) {
    diags.push(info("Minden állapot elérhető", "A kezdőállapotból minden állapot elérhető — nincs mit elhagyni."));
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
    title: "Elérhetetlen állapotok elhagyása",
    detail: `A kezdőállapotból szélességi bejárással elérhető állapotok maradnak. Elhagyva: ${removed.join(", ")}.`
  });

  return okResult(out, diags, steps);
}

/* ------------------------------------------------------------------ */
/* Minimalizálás (partíciófinomítás)                                   */
/* ------------------------------------------------------------------ */

export function minimize(f: FSM): OpResult<FSM> {
  const a = analyzeFSM(f);
  const diags: Diagnostic[] = [];

  // Előfeltételek pontos magyarázattal és javítási lánccal
  if (a.hasEpsilon) {
    return failResult([explainEpsilon(f, "minimalizálás", `min(det(epsfree(${f.name})))`)]);
  }
  if (!a.isDeterministic) {
    return failResult([explainNondeterministic(f, "minimalizálás", `min(det(${f.name}))`)]);
  }
  if (!a.isComplete) {
    return failResult([explainIncomplete(f, "minimalizálás", `min(complete(${f.name}))`)]);
  }

  let work = f;
  const steps: AlgoStep[] = [];
  if (a.unreachableStates.length > 0) {
    diags.push(
      warn(
        "Elérhetetlen állapotok",
        `A(z) ${a.unreachableStates.join(", ")} állapot(ok) nem érhető(k) el a kezdőállapotból — a minimalizálás első lépéseként elhagyjuk őket, különben hamis ekvivalenciaosztályok keletkezhetnének.`
      )
    );
    work = reachable(f).value!;
    steps.push({
      title: "0. Elérhetetlen állapotok elhagyása",
      detail: `Elhagyva: ${a.unreachableStates.join(", ")}.`
    });
  }

  const tm = transMap(work);
  const delta = (s: string, c: string) => [...(tm.get(s)?.get(c) ?? [])][0];

  // Kezdő partíció: {elfogadó, nem elfogadó}
  const acceptSet = new Set(work.accept);
  let partition: string[][] = [
    work.states.filter((s) => acceptSet.has(s)),
    work.states.filter((s) => !acceptSet.has(s))
  ].filter((g) => g.length > 0);

  const partName = (p: string[][]) => p.map((g) => setName(g)).join("  ");
  steps.push({
    title: "1. Kezdő partíció",
    detail: `Elfogadó és nem elfogadó állapotok szétválasztása: ${partName(partition)}`
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
      // szignatúra: melyik csoportba visz minden szimbólum
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
        title: `${round}. Finomítás`,
        detail: `Egy csoport szétválik, ha két állapota valamely szimbólumra különböző csoportba vezet. Új partíció: ${partName(next)}`,
        table: { headers: ["állapot", ...work.alphabet.map((c) => `δ(·, ${c})`)], rows }
      });
      round++;
    } else {
      steps.push({
        title: `${round}. Fixpont`,
        detail: `Nincs több szétválás — a partíció stabil: ${partName(partition)}. A csoportok az ekvivalenciaosztályok.`
      });
    }
    partition = next;
  }

  // Új automata az osztályokból
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
    diags.push(info("Az automata már minimális volt", "Minden állapot külön ekvivalenciaosztályba került."));
  } else {
    diags.push(
      info(
        `Minimalizálva: ${work.states.length} → ${out.states.length} állapot`,
        "Az egy osztályba került állapotok nyelvileg megkülönböztethetetlenek: minden szóra ugyanúgy fogadnak el / utasítanak el."
      )
    );
  }

  return okResult(out, diags, steps);
}

/* ------------------------------------------------------------------ */
/* Komplementer                                                        */
/* ------------------------------------------------------------------ */

export function complement(f: FSM): OpResult<FSM> {
  const a = analyzeFSM(f);
  if (a.hasEpsilon) return failResult([explainEpsilon(f, "komplementer", `complement(det(epsfree(${f.name})))`)]);
  if (!a.isDeterministic)
    return failResult([
      explainNondeterministic(f, "komplementer", `complement(det(${f.name}))`),
      info(
        "Miért kell DFA?",
        "NFA-nál az elfogadó állapotok átfordítása NEM a komplementer nyelvet adja: egy szót akkor fogad el az NFA, ha LÉTEZIK elfogadó út — az átfordítás után attól még létezhet elutasító út is elfogadóvá válva."
      )
    ]);
  if (!a.isComplete)
    return failResult([
      explainIncomplete(f, "komplementer", `complement(complete(${f.name}))`),
      info(
        "Miért kell teljesség?",
        "Ha valahol nincs átmenet, az automata „elakad” és elutasít. Ezeket a szavakat a komplementernek el kellene fogadnia — ehhez előbb csapdaállapottal teljessé kell tenni."
      )
    ]);

  const out = cloneFSM(f);
  out.accept = f.states.filter((s) => !f.accept.includes(s));
  return okResult(out, [], [
    {
      title: "Elfogadó állapotok átfordítása",
      detail: `Teljes DFA-ban minden szó pontosan egy úton fut végig, így az elfogadó/elutasító állapotok cseréje pontosan a komplementer nyelvet adja. Új elfogadó halmaz: ${
        out.accept.length ? out.accept.join(", ") : "∅"
      }.`
    }
  ]);
}

/* ------------------------------------------------------------------ */
/* Szorzat-konstrukció: unió / metszet / különbség                     */
/* ------------------------------------------------------------------ */

export type ProductMode = "union" | "intersect" | "difference";

const productModeName: Record<ProductMode, string> = {
  union: "unió",
  intersect: "metszet",
  difference: "különbség"
};

export function product(m1: FSM, m2: FSM, mode: ProductMode): OpResult<FSM> {
  const diags: Diagnostic[] = [];
  const fixes: Diagnostic[] = [];

  for (const [m, label] of [
    [m1, "első"],
    [m2, "második"]
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
          `A(z) ${label} automata ε-átmenetet tartalmaz`,
          `A szorzat-konstrukció (párhuzamos futtatás) determinisztikus, teljes automatákat vár, mert a két automatának szinkronban, szimbólumonként kell lépnie. Az ε-átmenet ezt elrontaná.`,
          { label: "javítási lánc beszúrása", code: chain(`complete(det(epsfree(${m.name})))`) }
        )
      );
    else if (!a.isDeterministic)
      fixes.push(
        err(
          `A(z) ${label} automata nemdeterminisztikus`,
          `A szorzatautomata állapotai (p, q) párok, és δ((p,q),a) = (δ₁(p,a), δ₂(q,a)) — ehhez mindkét δ-nak egyértékűnek kell lennie.`,
          { label: "determinizálás beszúrása", code: chain(`complete(det(${m.name}))`) }
        )
      );
    else if (!a.isComplete)
      fixes.push(
        err(
          `A(z) ${label} automata nem teljes`,
          `Ha az egyik automata elakad, a pár nem tud tovább lépni, pedig a másik még futna — ${
            mode === "union" ? "az unióhoz a másik automata elfogadása is számít" : "az eredmény hibás lenne"
          }. Teljessé tétellel (csapdaállapot) ez megoldható.`,
          { label: "teljessé tétel beszúrása", code: chain(`complete(${m.name})`) }
        )
      );
  }
  if (fixes.length > 0) return failResult(fixes);

  // közös ábécé
  const alphabet = [...new Set([...m1.alphabet, ...m2.alphabet])];
  const missing1 = alphabet.filter((c) => !m1.alphabet.includes(c));
  const missing2 = alphabet.filter((c) => !m2.alphabet.includes(c));
  if (missing1.length || missing2.length) {
    return failResult([
      err(
        "A két automata ábécéje különbözik",
        `${missing1.length ? `Az első automatából hiányzik: ${missing1.join(", ")}. ` : ""}${
          missing2.length ? `A másodikból hiányzik: ${missing2.join(", ")}.` : ""
        } A ${productModeName[mode]} csak közös ábécé fölött értelmes — bővítsd az ábécéket és tedd teljessé az automatákat.`
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

  const acceptDetail =
    mode === "union"
      ? "(p,q) elfogadó, ha p VAGY q elfogadó"
      : mode === "intersect"
        ? "(p,q) elfogadó, ha p ÉS q is elfogadó"
        : "(p,q) elfogadó, ha p elfogadó, de q NEM (L₁ \\ L₂)";

  const steps: AlgoStep[] = [
    {
      title: `Szorzat-konstrukció (${productModeName[mode]})`,
      detail: `A két automatát párhuzamosan futtatjuk: az állapotok (p,q) párok, δ((p,q),a) = (δ₁(p,a), δ₂(q,a)). Elfogadás: ${acceptDetail}. Csak az elérhető párokat építjük fel.`,
      table: { headers: ["állapotpár", ...alphabet], rows }
    }
  ];

  return okResult(out, diags, steps);
}

/** Unió tetszőleges (akár nemdeterminisztikus) automatákra: új kezdőállapot ε-átmenetekkel. */
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
    info(
      "ε-konstrukcióval készült unió",
      "Új kezdőállapotból ε-átmenet vezet mindkét automata kezdőállapotába. Az eredmény ε-NFA — determinizálható a det(epsfree(·)) lánccal. (Teljes DFA-k uniója a szorzat-konstrukcióval is elvégezhető.)"
    )
  ], [
    {
      title: "Unió ε-átmenetekkel",
      detail: `Új ${start} kezdőállapot, ε-átmenetek: ${start} → ${m1.start}, ${start} → ${b.start}. Elfogadó állapotok: a két automata elfogadó állapotainak uniója.`
    }
  ]);
}

/* ------------------------------------------------------------------ */
/* Konkatenáció és lezárás (Thompson-stílus)                           */
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
      title: "Konkatenáció",
      detail: `Az első automata minden elfogadó állapotából ε-átmenet vezet a második kezdőállapotába (${b.start}). Elfogadók: csak a második automata elfogadó állapotai. Az eredmény ε-NFA.`
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
      title: "Kleene-lezárás (csillag)",
      detail: `Új ${start} kezdőállapot (egyben elfogadó — így az üres szó is a nyelvben van), ε-átmenet az eredeti kezdőállapotba, és minden elfogadó állapotból ε-átmenet vissza ${start}-ba az ismétléshez.`
    }
  ]);
}

/* ------------------------------------------------------------------ */
/* Megfordítás                                                         */
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
      title: "Megfordítás",
      detail: `Minden átmenet irányát megfordítjuk, az új kezdőállapotból (${start}) ε-átmenet vezet az eredeti elfogadó állapotokba, és az eredeti kezdőállapot lesz az egyetlen elfogadó. L(Mᴿ) = { wᴿ : w ∈ L(M) }.`
    }
  ]);
}

/* ------------------------------------------------------------------ */
/* Állapotok átnevezése (tisztítás)                                    */
/* ------------------------------------------------------------------ */

export function cleanFSM(f: FSM): OpResult<FSM> {
  const names = new Map<string, string>();
  const alpha = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  // BFS-sorrendben nevezünk át, hogy a kezdőállapot A legyen
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
      title: "Állapotok átnevezése",
      detail: "A kezdőállapotból induló bejárási sorrendben A, B, C… neveket kapnak az állapotok. A nyelv nem változik.",
      table: { headers: ["régi név", "új név"], rows: order.map((s) => [s, names.get(s)!]) }
    }
  ]);
}

/* ------------------------------------------------------------------ */
/* Ekvivalencia-vizsgálat ellenpéldával                                */
/* ------------------------------------------------------------------ */

export interface EquivalenceVerdict {
  kind: "verdict";
  name: string;
  machineA: string;
  machineB: string;
  equal: boolean;
  /** szó, amit az egyik elfogad, a másik nem */
  counterexample?: { word: string; acceptedBy: string; rejectedBy: string };
}

/** Tetszőleges (ε-)NFA-t teljes DFA-vá normalizál. */
function normalizeToCompleteDFA(f: FSM): FSM {
  let m = f;
  const a = analyzeFSM(m);
  if (a.hasEpsilon) m = removeEpsilon(m).value!;
  m = determinize(m).value!; // a determinizálás nálunk teljes DFA-t ad (∅ állapottal)
  return m;
}

export function checkEquivalence(a: FSM, b: FSM): OpResult<EquivalenceVerdict> {
  const alphabet = [...new Set([...a.alphabet, ...b.alphabet])];
  const da = withAlphabet(normalizeToCompleteDFA(a), alphabet);
  const db = withAlphabet(normalizeToCompleteDFA(b), alphabet);

  // szorzat bejárása; keresünk olyan párt, ahol pontosan az egyik fogad el
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
          title: "Ellenpélda keresése a szorzatautomatában",
          detail: `A két (teljessé és determinisztikussá alakított) automatát párhuzamosan futtatjuk, és a legrövidebb olyan szót keressük, amelynél pontosan az egyik fogad el. Találat: „${
            word === "" ? "ε" : word
          }”.`
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
        title: "Ekvivalencia igazolása",
        detail:
          "A szorzatautomata minden elérhető (p,q) állapotpárjában p és q elfogadási státusza megegyezik, tehát nincs megkülönböztető szó — a két automata ugyanazt a nyelvet ismeri fel."
      }
    ]
  );
}

/** Ábécé kibővítése (teljes DFA marad: a hiányzó szimbólumok csapdába mennek). */
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
