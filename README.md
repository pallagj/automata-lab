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
  `toGrammar`, `toFsm`, `toPda`. When a precondition is missing (e.g. determinisation needs an
  ε-free automaton), the app **explains why** and inserts the fix chain with one click
  (e.g. `min(complete(det(epsfree(M))))`).
- **"How was it built?" panel:** the recorded steps of each algorithm — powerset table, partition
  refinement rounds, ε-closures, product construction table.
- **Equivalence check with a counterexample:** `equal(A, B)` returns the shortest distinguishing word.
- **Regular expressions** as values of their own: syntax tree, word test, sample matching words,
  and `toFsm()` via the Thompson construction.
- **Pushdown automata:** true nondeterministic simulation over configuration sets, stack display,
  acceptance by empty stack or by final state.
- **Turing machines:** tape visualisation, step-by-step execution, nondeterminism detection and
  branch selection.
- **General machine model:** every machine is a restriction of one model — a finite control plus any
  number of configurable storages (`stack` / `queue` / `tape`). Custom machines can be built with
  the `Machine:` key (e.g. a two-stack machine for `aⁿbⁿcⁿ`, a queue automaton), with unified
  simulation and determinism analysis; automaton operations are gated by capability.
- **Grammars:** exact Chomsky classification — for every level it shows *which rule violates the
  condition and why*; word generation with derivations, derivability test, ε-rule elimination,
  RG ↔ NFA and CFG → PDA conversions.
- **Desmos-style worksheets:** a column of cells holding expressions, regexes, machines, grammars
  and `#` notes; drag & drop reordering, an operation menu that checks applicability up front,
  and a form editor or YAML code view for definitions. Type `eps` and it turns into `ε`, Desmos-style
  (`\eps` keeps the letters).
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
  name: M1
  charset: a, b
  states: S, A, F
  init: S
  accept: F
  transitions:
    - S . S      # "." = every symbol
    - S a A
    - A b F
```

and the following cells can transform it with expressions:

```
D = det(M1)
Min = min(D)
E = equal(M1, Min)
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
