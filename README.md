# AutomataLab

An interactive, **offline-first** workshop for formal languages and automata theory: define,
simulate and transform finite automata, pushdown automata, Turing machines and generative
grammars — with detailed explanations that help you learn.

Built as a study companion for the
[*Languages and Automata* (Nyelvek és automaták, VISZMA12)](https://cs.bme.hu/nyau/) course at the
Budapest University of Technology and Economics (BME).

**Try it:** https://automatalab.app/ — works in the browser and can be installed as
an app; everything runs locally, no account needed. A worksheet can be shared by a short link.

## Features

- **Finite automata** (DFA / NFA / ε-NFA): step-by-step simulation over state sets (played
  letter by letter), a timeline, and the accepted words in shortlex order — with whether
  the language is empty, finite (and how many words it has) or infinite, decided exactly.
- **Smart operations with explanations:** `det`, `min`, `epsfree`, `complete`, `reachable`,
  `complement`, `union`, `intersect`, `difference`, `concat`, `star`, `reverse`, `regex`, `equal`,
  `toGrammar`, `toRegex`, `toFsm`, `toPda`, for grammars `epsfree`, `unitfree`, `trim`, `cnf`, and
  for pushdown automata `toEmptyStack`, `toFinalState` and `toGrammar`: the
  grammar of the [qAp] variables. A pushdown automaton's word test is exact — CYK on that
  grammar — where a search over its configurations could only give up.
  When a precondition is missing (e.g. minimisation needs a complete
  deterministic automaton), the app **explains why** and inserts the fix chain with one click
  (e.g. `min(det(M))`). In determinisation the subset construction
  handles ε-transitions itself, through ε-closures.
- **"How was it built?" panel:** the recorded steps of each algorithm — powerset table, partition
  refinement rounds, ε-closures, product construction table, the r(p, q, t) tables of the
  automaton → regular expression conversion, the rounds of the grammar transformations. The
  panels over the graph can be enlarged to the whole canvas for a long table.
- **Algorithms played frame by frame:** the subset construction filling in, the product built pair
  by pair, the minimization's classes splitting round by round, a regular expression's automaton
  built inside out (the subexpressions' automata side by side, each in its colour with its own
  start and accepting states, until they are joined), ε-removal state by state (each closure, then
  the transitions it makes direct, drawn over the ε-NFA), the r(p, q, t) rounds (each changed
  entry computed beside the automaton), the CYK table filling in cell by cell and a derivation
  tree growing along its leftmost derivation — with a caption
  per frame, step and scrub controls and speed.
- **Equivalence check with a counterexample:** `equal(A, B)` returns the shortest distinguishing word.
- **Decision questions, decided exactly and explained:** `empty(L)` gives a shortest word or shows
  that no accepting state is reachable; `finite(L)` works on the minimal automaton (infinite exactly
  when there is a word of length n…2n, and that word is pumped) or, for a context-free grammar or a
  pushdown automaton, looks for a variable that can repeat in a derivation tree — a finite language
  gets all its words listed; `disjoint(A, B)` searches the product automaton for a common word.
- **Regular expressions** as values of their own: syntax tree, word test, sample matching words,
  and `toFsm()` built inside out: small
  automata for a letter, ε and ∅, then the union, concatenation and closure constructions. The
  way back, `toRegex(M)`, uses the r(p, q, t) dynamic programming,
  simplifying with identities that always hold.
- **Pushdown automata:** true nondeterministic simulation over configuration sets (played step by
  step: every branch at once), stack display,
  acceptance by empty stack or by final state.
- **Turing machines:** tape visualisation, step-by-step execution (or played), nondeterminism
  detection, every branch followed at once. Transitions read `a → b, D` (and `a; Z → AZ` for a
  pushdown automaton); the head moves are `R`, `L`, `S` in the YAML and shown in the interface's
  language (J, B, H in Hungarian).
- **General machine model:** every machine is a restriction of one model — a finite control plus any
  number of configurable storages (`stack` / `queue` / `tape`), each with its own alphabet Γ
  (`charset`; left out, it is the symbols the storage holds — for a tape Σ and the blank).
  Custom machines can be built with the `Machine:` key (e.g. a two-stack machine for `aⁿbⁿcⁿ`, a
  queue automaton), with unified simulation and determinism analysis; automaton operations are
  gated by capability.
- **Grammars:** exact Chomsky classification — for every level it shows *which rule violates the
  condition and why*; word generation with derivations, RG ↔ NFA and CFG → PDA conversions.
  Context-free grammars are simplified step by step: ε-rule elimination (`epsfree(G)`),
  unit rules (`unitfree(G)`), useless symbols (`trim(G)`) and the Chomsky normal form (`cnf(G)`).
  Their derivability test is an exact decision with the **CYK algorithm**, showing the triangular
  table. A derivable word gets its **derivation trees**, on the grammar as written (ε-rules and
  unit rules too): how many there are (more than one proves the grammar ambiguous; a variable
  deriving itself over the same subword makes infinitely many), each one drawn and paged through
  without listing the others, its leftmost derivation, and the tree growing along it, played.
- **Worksheets of cells:** a column of cells holding expressions, regexes, machines, grammars
  and `#` notes; drag & drop reordering, an operation menu that checks applicability up front,
  and a form editor or YAML code view for definitions. Names are optional: `det(M_1)` or
  `regex(a+b)` on their own are shown right away; name a cell only to reference it elsewhere. Type `eps` and it turns into `ε`
  (`\eps` keeps the letters).
- **Mathematical names:** a name is a single letter with an optional subscript — `M`, `M_1`, `X_a`,
  `M_{even}` — for cells, grammar variables and stack symbols alike, shown with real subscripts.
  Typing builds the subscripts as you go: `_` opens a subscript and → leaves it, digits right after a letter go
  there by themselves (`M1` becomes M₁), and `AB` in an expression is A concatenated with B. State
  names stay free labels (`AB`, `00`, `{A,B}`); automaton → grammar gives them `A_q` variables.
- **Worksheet browser:** all your worksheets as cards with live graph previews (or a sortable list),
  search, sort and filter by what they contain, folders, multi-select, drag & drop into folders,
  duplicate/rename/move/delete with undo, and a gallery of ready-made example worksheets.
- **Undo and redo:** every edit of a worksheet's cells — typing, the form, adding, moving and
  deleting cells — can be undone and redone with the buttons over the cells or Ctrl+Z /
  Ctrl+Shift+Z (Ctrl+Y). Each worksheet keeps its own history for the session.
- **Visual graph editing:** drag states around (positions are remembered), double-click to add a
  state, drag from a state's port to add a transition, click a label to edit it. Export graphs as
  SVG, PNG or LaTeX (TikZ, in the textbook `automata` style).
- **Directly editable tape:** type the input word right on the visualised tape.
- **Offline-first PWA:** every worksheet is saved in the browser automatically; the app is
  installable and fully functional without a network. Export/import worksheets as JSON.
- **Share by link:** the Share button stores the worksheet as it is now and gives a short link
  (`https://automatalab.app/w/k3x9pq2mzt`); whoever opens it gets a copy of their own, with the
  graph positions as they were pinned. Later edits do not reach the link.
- **API and MCP:** the same sharing is open to programs through a REST API described by OpenAPI
  and to AI assistants through an MCP server (see below).
- **Modern UI:** custom SVG graph renderer (dagre layout, pan/zoom, animated active states),
  dark/light theme, full mobile layout.
- **Multilingual:** English, German and Hungarian, detected from the browser language
  (`i18next` + `i18next-browser-languagedetector`) with a switcher in the header. All UI text and
  every algorithm explanation (diagnostics, "How was it built?" steps) is translated.

## A quick taste

A cell can define a machine in YAML:

```yaml
Machine:
  name: M_1
  charset: a, b
  states: S, A, F
  init: S
  accept: F
  transitions:
    - (S, a) -> S      # δ(S, a) = S
    - (S, b) -> S
    - (S, a) -> A
    - (A, b) -> F
```

and the following cells can transform it with expressions:

```
D = det(M_1)
N = min(D)
E = equal(M_1, N)
```

Adding `storages:` turns the same `Machine` into a pushdown automaton, a Turing machine or a custom
machine — see the built-in example worksheets (the worksheet menu ▾ next to the title → Examples)
for each kind.

## API and MCP

- **REST:** `POST /api/snapshots` shares a worksheet, `GET /api/snapshots/{id}` opens one. The
  OpenAPI 3.1 document is at https://automatalab.app/api/openapi.json, a browsable reference at
  https://automatalab.app/api/docs.
- **MCP** (Streamable HTTP) at `https://automatalab.app/mcp`: the tools `share_worksheet` and
  `open_shared_worksheet`, and every example worksheet as a resource to learn the notation from.
  In Claude Code: `claude mcp add --transport http automatalab https://automatalab.app/mcp`.

## Development

```bash
npm install
npm run dev          # the web app (Vite); /api and /mcp are proxied to the server below
npm run dev:server   # the API server on :8787, with a local SQLite file
npm test             # every test, the type checks and the architecture rules
npm run gen          # regenerate: OpenAPI document + typed client, database migrations
npm run build        # production build: the PWA (apps/web/dist) and the server (apps/server/dist)
npm run preview      # try the production build locally
```

## Project structure

An npm workspace of four packages:

```
packages/core/       — the algorithms (FSM/PDA/TM/grammar), parsers, the cell language, the worksheet
                       format and its migrations, the "core" translations — pure TypeScript, runs anywhere
packages/contract/   — the API contract: Zod schemas and routes → openapi.json → the typed client
apps/web/            — the React PWA: state (zustand, localStorage), UI, i18n
apps/server/         — the API: Hono + SQLite (Drizzle), REST and MCP over the same use cases
deploy/              — the systemd unit and the Caddy site of the production server
```

Every operation in `packages/core` returns an `OpResult`: a value + diagnostics (explanation,
suggested fix) + recorded algorithm steps. Their text is a translation key + parameters
(`I18nText`), not a finished string — the UI resolves it in the current language with the `tr()`
helper (`packages/core/src/i18n/translate.ts`), so every explanation is available in all three
languages.

**The API is written once.** The routes and schemas in `packages/contract` are the source: the
server implements them (type-checked), `npm run gen` generates `openapi.json` from them and the
client's types from that, and a test fails when a generated file is out of date. Database
migrations are generated the same way from the Drizzle schema.

**The server is hexagonal:** `domain/` (the rules) ← `application/` (use cases and the ports they
need) ← `adapters/` (HTTP, MCP, SQLite, system) ← `main.ts`, the only place that wires adapters
to use cases. REST and MCP are two adapters over the same use cases.

**The architecture is checked**, by [dependency-cruiser](https://github.com/sverweij/dependency-cruiser)
on every `npm test` (`.dependency-cruiser.cjs`): `core` depends on nothing of ours, the contract
only on `core`, the apps never on each other, the web app talks to the API only through the
generated client, the domain and the use cases import no framework, adapters do not import each
other, and there are no import cycles.

## Contributing

Contributions are welcome — bug reports, ideas, new algorithms, examples or translations. Found a
bug or have an idea? [Open an issue](https://github.com/pallagj/automata-lab/issues/new) (the
GitHub icon in the app's header leads there too). For code, fork the repository and open a pull
request.

- Code, comments and commit messages are in English.
- User-facing text goes through i18n: add new keys to all three locales — the UI's in
  `apps/web/src/i18n/locales/`, the algorithms' in `packages/core/src/i18n/` (`en`, `de`, `hu`). It
  stands on its own — no references to course material or its section numbers
  (`apps/web/src/i18n/terminology.test.ts` checks this).
- Run `npm test` and `npm run build` before opening a pull request.

## Acknowledgements

Special thanks to **Katalin Friedl**, lecturer of the
[Languages and Automata](https://cs.bme.hu/nyau/) course at BME and my supervisor on this project,
for the countless reviews, ideas and suggestions along the way — AutomataLab owes a great deal to
this help.

## License

[MIT](LICENSE) © 2026 Jonatán Pallag
