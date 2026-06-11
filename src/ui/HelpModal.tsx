import React from "react";
import { X } from "lucide-react";

export const HelpModal: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  return (
    <div className="modal-back" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", alignItems: "center" }}>
          <h2 style={{ flex: 1, margin: 0 }}>Súgó</h2>
          <button className="icon-btn" onClick={onClose}>
            <X size={15} />
          </button>
        </div>

        <h3>Mi ez?</h3>
        <p>
          Az AutomataLab a <i>Nyelvek és automaták</i> tantárgy interaktív műhelye: véges automaták,
          veremautomaták, Turing-gépek és generatív nyelvtanok definiálhatók, szimulálhatók és
          transzformálhatók. Minden offline működik, a munkalapok automatikusan mentődnek a böngészőbe.
        </p>

        <h3>Gépek — egyetlen modell</h3>
        <p>
          Minden gép ugyanazzal a <code>Machine:</code> kulccsal készül: véges vezérlő + tetszőleges
          tárolók. <b>A fajtáját a konfiguráció dönti el</b> — tároló nélkül véges automata, egy
          veremmel veremautomata, egy szalaggal (amelyre a bemenet kerül) Turing-gép, más
          kombinációval általános gép. A felület felismeri és ennek megfelelően nevezi el.
        </p>
        <pre>{`Machine:               # véges automata: nincs tároló
  name: M1
  charset: a, b
  states: S, A, F
  init: S
  accept: F
  transitions:
    - S . S      # "." = az ábécé minden betűje
    - S a A
    - A b F      # ε-átmenethez: S $ A`}</pre>

        <h3>Kifejezések</h3>
        <p>
          Új cellában <code>név = kifejezés</code> alakban gépekre hivatkozhatsz és műveleteket
          végezhetsz. Ha egy művelet előfeltétele hiányzik (pl. a determinizáláshoz ε-mentesség), az
          alkalmazás elmagyarázza, miért, és egy kattintással beszúrja a javítási láncot.
        </p>
        <table>
          <tbody>
            <tr>
              <td><code>det(M)</code></td>
              <td>determinizálás (hatványhalmaz-konstrukció, lépésekkel)</td>
            </tr>
            <tr>
              <td><code>min(M)</code></td>
              <td>minimalizálás (partíciófinomítás, lépésekkel)</td>
            </tr>
            <tr>
              <td><code>epsfree(M)</code></td>
              <td>ε-mentesítés</td>
            </tr>
            <tr>
              <td><code>complete(M)</code>, <code>reachable(M)</code></td>
              <td>teljessé tétel csapdaállapottal / elérhetetlen állapotok elhagyása</td>
            </tr>
            <tr>
              <td><code>union, intersect, difference</code></td>
              <td>halmazműveletek (szorzat-konstrukció)</td>
            </tr>
            <tr>
              <td><code>concat(A,B)</code>, <code>star(A)</code>, <code>reverse(A)</code>, <code>complement(A)</code></td>
              <td>nyelvműveletek</td>
            </tr>
            <tr>
              <td><code>regex((a|b)*abb)</code></td>
              <td>reguláris kifejezés mint érték — automatává a <code>toFsm()</code> alakítja</td>
            </tr>
            <tr>
              <td><code>equal(A,B)</code></td>
              <td>ekvivalencia-vizsgálat, ellenpéldával</td>
            </tr>
            <tr>
              <td><code>toGrammar(M)</code>, <code>toFsm(G)</code>, <code>toPda(G)</code></td>
              <td>konverziók automata ↔ nyelvtan, nyelvtan → veremautomata</td>
            </tr>
            <tr>
              <td><code>A B</code>, <code>A+B</code>, <code>A*</code></td>
              <td>műveletek nevesített automaták között: összefűzés, unió, lezárás — betű-literálok csak a <code>regex(…)</code> belsejében</td>
            </tr>
          </tbody>
        </table>

        <h3>Tárolók: verem, sor, szalag</h3>
        <pre>{`Machine:               # veremautomata: egy verem
  name: AnBn
  charset: a, b
  states: q0, q1, q2
  init: q0
  accept: q2           # vagy acceptMode: emptyStorages
  storages:
    verem: stack       # a verem alapból Z-vel indul; másképp:
  transitions:         #   verem: { type: stack, init: X }
    - q0 a Z/AZ q0     # a beolvasása: Z helyett AZ a verembe
    - q0 b A/$ q1      # $ = nem ír semmit (ε)
    - q1 $ Z/Z q2      # ε-lépés

Machine:               # Turing-gép: egy szalag, rajta a bemenet
  name: T
  charset: a, b
  states: s, ok
  init: s
  accept: ok
  input: szalag        # a bemenet erre a tárolóra kerül
  storages:
    szalag: tape
  transitions:
    - s a/b > s        # a-t olvas, b-t ír, jobbra lép
    - s _/& = ok       # _ = üres jel, & = ugyanazt írja vissza`}</pre>
        <p>
          Az átmenet-sor: <code>HONNAN [BEMENET] tárolónként-művelet… HOVA</code> — verem/sor egy
          elem (<code>LE/FEL</code>), szalag kettő (<code>olvas/ír mozgás</code>). Akárhány tároló
          kombinálható: két veremmel már Turing-erejű gép építhető (pl. <code>aⁿbⁿcⁿ</code>, ami
          veremautomatával nem lehetséges), sorral (queue) sorautomata. Az automata-műveletek
          (<code>det</code>, <code>min</code>…) csak tárolómentes gépre alkalmazhatók — az
          alkalmazás megmondja, miért.
        </p>

        <h3>Nyelvtan</h3>
        <pre>{`Grammar:
  name: G
  charset: a, b
  variables: S
  init: S
  rules:
    - S -> aSb | $   # $ = ε`}</pre>
        <p>
          A nyelvtan nézet automatikusan megadja a Chomsky-hierarchia szerinti osztályt, és minden
          szinthez megmutatja, <i>melyik szabály miért</i> sérti a feltételt.
        </p>

        <h3>Tippek</h3>
        <ul>
          <li>A gráf húzással mozgatható, görgetéssel nagyítható, dupla kattintásra visszaáll.</li>
          <li>Szimuláció közben a kiemelt élekre kattintva NFA-ágat választhatsz.</li>
          <li>A kifejezés-cellák eredménye a fejléc ikonjával szerkeszthető YAML-lá bontható.</li>
          <li>Az „Elfogadott szavak” chipjeire kattintva azonnal szimulálhatod őket.</li>
        </ul>
      </div>
    </div>
  );
};
