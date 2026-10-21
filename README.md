# AutomataLab

An interactive, **offline-first** workshop for formal languages and automata theory: define,
simulate and transform finite automata, pushdown automata, Turing machines and generative
grammars — with detailed explanations that help you learn.

Built as a study companion for the
[*Languages and Automata* (Nyelvek és automaták, VISZMA12)](https://cs.bme.hu/nyau/) course at the
Budapest University of Technology and Economics (BME).

**Try it:** https://automata.78-46-230-35.sslip.io/ — works in the browser and can be installed as
an app; everything runs locally, no account needed.

## Features

- **Finite automata** (DFA / NFA / ε-NFA): step-by-step simulation over state sets, a timeline,
  clickable edges to explore NFA branches, and enumeration of accepted words.
- **Smart operations with explanations:** `det`, `min`, `epsfree`, `complete`, `reachable`,
  `complement`, `union`, `intersect`, `difference`, `concat`, `star`, `reverse`, `regex`, `equal`,
  `toGrammar`, `toRegex`, `toFsm`, `toPda`, and for grammars `epsfree`, `unitfree`, `trim`, `cnf`.
  When a precondition is missing (e.g. minimisation needs a complete
  deterministic automaton), the app **explains why** and inserts the fix chain with one click
  (e.g. `min(det(M))`). Determinisation follows the lecture notes: the subset construction
  handles ε-transitions itself, through ε-closures.
- **"How was it built?" panel:** the recorded steps of each algorithm — powerset table, partition
  refinement rounds, ε-closures, product construction table, the r(p, q, t) tables of the
  automaton → regular expression conversion, the rounds of the grammar transformations.
- **Equivalence check with a counterexample:** `equal(A, B)` returns the shortest distinguishing word.
- **Regular expressions** as values of their own: syntax tree, word test, sample matching words,
  and `toFsm()` built as the lecture notes prove a regular expression regular (3.20): small
  automata for a letter, ε and ∅, then the union, concatenation and closure constructions. The
  way back, `toRegex(M)`, uses the r(p, q, t) dynamic programming of the lecture notes,
  simplifying with identities that always hold.
- **Pushdown automata:** true nondeterministic simulation over configuration sets, stack display,
  acceptance by empty stack or by final state.
- **Turing machines:** tape visualisation, step-by-step execution, nondeterminism detection and
  branch selection. Transitions read as in the lecture notes, `a → b, D` (and `a; Z → AZ` for a
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
  Context-free grammars follow the lecture notes step by step: ε-rule elimination (`epsfree(G)`),
  unit rules (`unitfree(G)`), useless symbols (`trim(G)`) and the Chomsky normal form (`cnf(G)`).
  Their derivability test is an exact decision with the **CYK algorithm**, showing the triangular
  table and the number of derivation trees (more than one proves the grammar ambiguous).
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
- **Visual graph editing:** drag states around (positions are remembered), double-click to add a
  state, drag from a state's port to add a transition, click a label to edit it. Export graphs as
  SVG, PNG or LaTeX (TikZ, in the textbook `automata` style).
- **Directly editable tape:** type the input word right on the visualised tape.
- **Offline-first PWA:** every worksheet is saved in the browser automatically; the app is
  installable and fully functional without a network. Export/import worksheets as JSON.
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
    - (S, a) -> S      # δ(S, a) = S, as in the lecture notes
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

## Development

```bash
npm install
npm run dev       # development server
npm test          # tests for the core algorithms (vitest)
npm run build     # production build + PWA
npm run preview   # try the production build locally
```

## Project structure

```
src/core/      — framework-independent logic (FSM/PDA/TM/grammar + parsers + expression language)
src/state/     — zustand store, localStorage persistence, examples
src/ui/        — React UI (editor, graph, simulations, panels)
src/i18n/      — i18next setup + translations (en/de/hu, "ui" and "core" namespaces)
```

Every operation in `src/core` returns an `OpResult`: a value + diagnostics (explanation, suggested
fix) + recorded algorithm steps. Their text is a translation key + parameters (`I18nText`), not a
finished string — the UI resolves it in the current language with the `tr()` helper
(`src/i18n/translate.ts`), so every explanation is available in all three languages.

## Contributing

Contributions are welcome — bug reports, ideas, new algorithms, examples or translations. Fork the
repository and open a pull request.

- Code, comments and commit messages are in English.
- User-facing text goes through i18n: add new keys to all three locales in `src/i18n/locales/`
  (`en`, `de`, `hu`).
- Run `npm test` and `npm run build` before opening a pull request.

## Acknowledgements

Special thanks to **Katalin Friedl**, lecturer of the
[Languages and Automata](https://cs.bme.hu/nyau/) course at BME and my supervisor on this project,
for the countless reviews, ideas and suggestions along the way — AutomataLab owes a great deal to
this help.

## License

[MIT](LICENSE) © 2026 Jonatán Pallag
