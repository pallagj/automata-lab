/** A kifejezésnyelv műveletei a cella-súgóhoz: leírás + paraméterszám. */
export interface OpInfo {
  name: string;
  desc: string;
  args: 1 | 2;
}

export const OPS: OpInfo[] = [
  { name: "det", desc: "determinizálás (hatványhalmaz-konstrukció)", args: 1 },
  { name: "min", desc: "minimalizálás (partíciófinomítás)", args: 1 },
  { name: "epsfree", desc: "ε-mentesítés", args: 1 },
  { name: "complete", desc: "teljessé tétel csapdaállapottal", args: 1 },
  { name: "reachable", desc: "elérhetetlen állapotok elhagyása", args: 1 },
  { name: "complement", desc: "komplementer nyelv", args: 1 },
  { name: "union", desc: "unió (két automata)", args: 2 },
  { name: "intersect", desc: "metszet (két automata)", args: 2 },
  { name: "difference", desc: "különbség (két automata)", args: 2 },
  { name: "concat", desc: "összefűzés (két automata)", args: 2 },
  { name: "star", desc: "lezárás (Kleene-csillag)", args: 1 },
  { name: "reverse", desc: "megfordítás", args: 1 },
  { name: "clean", desc: "állapotok átnevezése (A, B, C…)", args: 1 },
  { name: "toGrammar", desc: "automata → reguláris nyelvtan", args: 1 },
  { name: "toFsm", desc: "nyelvtan → véges automata", args: 1 },
  { name: "toPda", desc: "nyelvtan → veremautomata", args: 1 },
  { name: "equal", desc: "ekvivalencia-vizsgálat ellenpéldával", args: 2 },
  { name: "regex", desc: "reguláris kifejezés → ε-NFA", args: 1 }
];
