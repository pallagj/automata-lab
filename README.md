# AutomataLab

Interaktív, **offline-first** műhely a *Nyelvek és automaták* tantárgyhoz: véges automaták,
veremautomaták, Turing-gépek és generatív nyelvtanok definiálása, szimulálása és transzformálása —
részletes, tanulást segítő magyarázatokkal.

## Fő képességek

- **Véges automaták** (DFA / NFA / ε-NFA): lépésenkénti, állapothalmazos szimuláció, idővonal,
  kattintható élek az NFA-ágak felfedezéséhez, elfogadott szavak felsorolása.
- **Okos műveletek magyarázattal:** `det`, `min`, `epsfree`, `complete`, `reachable`, `complement`,
  `union`, `intersect`, `difference`, `concat`, `star`, `reverse`, `regex`, `equal`, `toGrammar`,
  `toFsm`, `toPda`. Ha egy előfeltétel hiányzik (pl. determinizáláshoz ε-mentesség), az alkalmazás
  **elmagyarázza, miért**, és egy kattintással beszúrja a javítási láncot
  (pl. `min(complete(det(epsfree(M))))`).
- **„Hogyan készült?” panel:** az algoritmusok rögzített lépései — hatványhalmaz-tábla,
  partíciófinomítási körök, ε-lezárások, szorzat-konstrukció táblázata.
- **Ekvivalencia-vizsgálat ellenpéldával:** `equal(A, B)` megadja a legrövidebb megkülönböztető szót.
- **Veremautomata:** valódi nemdeterminisztikus szimuláció konfigurációhalmazzal, verem-megjelenítés,
  elfogadás üres veremmel vagy elfogadó állapottal.
- **Turing-gép:** szalag-vizualizáció, lépésenkénti futtatás, nemdeterminizmus jelzése és ágválasztás.
- **Általános gépmodell:** minden gép egy közös modell megszorítása — véges vezérlő + tetszőleges
  számú, konfigurálható tároló (`stack` / `queue` / `tape`). A `Machine:` kulccsal egyedi gépek
  építhetők (pl. kétvermes gép az `aⁿbⁿcⁿ`-hez, sorautomata), egységes szimulációval és
  determinizmus-analízissel; az automata-műveletek képesség-alapon kapuzottak.
- **Közvetlenül szerkeszthető szalag:** a bemenet magán a vizualizált szalagon írható.
- **Nyelvtanok:** pontos Chomsky-osztályozás — minden szinthez megmutatja, *melyik szabály miért*
  sérti a feltételt; szógenerálás levezetésekkel, szó-levezethetőség teszt, ε-mentesítés,
  RG ↔ NFA és CFG → PDA konverziók.
- **Offline-first PWA:** minden munkalap automatikusan a böngészőbe mentődik, az alkalmazás
  telepíthető és hálózat nélkül is teljes értékű. Export/import JSON-fájlba.
- **Modern felület:** saját SVG-gráfrenderelő (dagre layout, pan/zoom, animált aktív állapotok),
  sötét/világos téma, teljes értékű mobilnézet.
- **Többnyelvű (i18n):** magyar, angol és német nyelven, a böngésző nyelvét automatikusan
  felismerve (`i18next` + `i18next-browser-languagedetector`), kézi váltóval a fejlécben. Minden
  felületi szöveg és minden algoritmus-magyarázat (diagnosztika, „Hogyan készült?” lépések)
  lefordítva — l. `src/i18n/`.

## Fejlesztés

```bash
npm install
npm run dev       # fejlesztői szerver
npm test          # core algoritmusok tesztjei (vitest)
npm run build     # produkciós build + PWA
npm run preview   # build helyi kipróbálása
```

## Felépítés

```
src/core/      — keretrendszer-független logika (FSM/PDA/TM/Grammar + parserek + kifejezésnyelv)
src/state/     — zustand store, localStorage-perzisztencia, példák
src/ui/        — React-felület (szerkesztő, gráf, szimulációk, panelek)
src/i18n/      — i18next-beállítás + fordítások (en/de/hu, "ui" és "core" namespace)
```

A `src/core` minden művelete `OpResult`-ot ad vissza: érték + diagnosztika (magyarázat, javítási
javaslat) + rögzített algoritmus-lépések. Ezek szövege fordítási kulcs + paraméterek
(`I18nText`), nem kész string — a felület a `tr()` segédfüggvénnyel (`src/i18n/translate.ts`)
oldja fel az aktuális nyelven, így minden magyarázat mindhárom nyelven megjelenik.
