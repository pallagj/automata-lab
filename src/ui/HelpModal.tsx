import React from "react";
import { rich } from "./Rich";
import { useTranslation } from "react-i18next";
import { X } from "lucide-react";
import { NEW_ISSUE_URL } from "./GitHubMenu";

const STORAGE_POINTS = ["inputTape", "edge", "tape", "combine", "ops"] as const;

export const HelpModal: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const { t } = useTranslation();
  return (
    <div className="modal-back" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", alignItems: "center" }}>
          <h2 style={{ flex: 1, margin: 0 }}>{t("help.title")}</h2>
          <button className="icon-btn" onClick={onClose}>
            <X size={15} />
          </button>
        </div>

        <h3>{t("help.whatIsThis.heading")}</h3>
        <p>
          {t("help.whatIsThis.body1")} <i>{t("help.whatIsThis.subject")}</i>
          {t("help.whatIsThis.body2")}
        </p>

        <h3>{t("help.machines.heading")}</h3>
        <p>
          {t("help.machines.body1")} <code>Machine:</code>
          {t("help.machines.body2")} <b>{t("help.machines.emphasis")}</b>
          {t("help.machines.body3")}
        </p>
        <pre>{t("help.machines.example")}</pre>

        <h3>{t("help.names.heading")}</h3>
        <p>{rich(t("help.names.body"))}</p>

        <h3>{t("help.expressions.heading")}</h3>
        <p>
          {t("help.expressions.body1")} <code>[name =] expression</code>
          {t("help.expressions.body2")} {t("help.expressions.optionalName")}
        </p>
        <table>
          <tbody>
            <tr>
              <td><code>det(M)</code></td>
              <td>{t("help.expressions.ops.det")}</td>
            </tr>
            <tr>
              <td><code>min(M)</code></td>
              <td>{t("help.expressions.ops.min")}</td>
            </tr>
            <tr>
              <td><code>epsfree(M)</code>, <code>epsfree(G)</code></td>
              <td>{t("help.expressions.ops.epsfree")}</td>
            </tr>
            <tr>
              <td><code>unitfree(G)</code>, <code>trim(G)</code>, <code>cnf(G)</code></td>
              <td>{t("help.expressions.ops.grammarOps")}</td>
            </tr>
            <tr>
              <td><code>complete(M)</code>, <code>reachable(M)</code></td>
              <td>{t("help.expressions.ops.completeReachable")}</td>
            </tr>
            <tr>
              <td><code>union, intersect, difference</code></td>
              <td>{t("help.expressions.ops.setOps")}</td>
            </tr>
            <tr>
              <td><code>concat(A,B)</code>, <code>star(A)</code>, <code>reverse(A)</code>, <code>complement(A)</code></td>
              <td>{t("help.expressions.ops.langOps")}</td>
            </tr>
            <tr>
              <td><code>regex((a|b)*abb)</code></td>
              <td>{t("help.expressions.ops.regex")}</td>
            </tr>
            <tr>
              <td><code>equal(A,B)</code></td>
              <td>{t("help.expressions.ops.equal")}</td>
            </tr>
            <tr>
              <td><code>toGrammar(M)</code>, <code>toRegex(M)</code>, <code>toFsm(G)</code>, <code>toPda(G)</code></td>
              <td>{t("help.expressions.ops.conversions")}</td>
            </tr>
            <tr>
              <td><code>toEmptyStack(P)</code>, <code>toFinalState(P)</code></td>
              <td>{t("help.expressions.ops.pdaAcceptance")}</td>
            </tr>
            <tr>
              <td><code>A B</code>, <code>A+B</code>, <code>A*</code></td>
              <td>{t("help.expressions.ops.namedOps")}</td>
            </tr>
          </tbody>
        </table>

        <h3>{t("help.storages.heading")}</h3>
        <pre>{t("help.storages.example")}</pre>
        <p>
          {t("help.storages.body1")} <code>{t("help.storages.transitionSyntax")}</code>
          {t("help.storages.body2")}
        </p>
        <ul>
          {STORAGE_POINTS.map((p) => (
            <li key={p}>{t(`help.storages.points.${p}`)}</li>
          ))}
        </ul>

        <h3>{t("help.grammar.heading")}</h3>
        <pre>{t("help.grammar.example")}</pre>
        <p>{t("help.grammar.body")}</p>

        <h3>{t("help.tips.heading")}</h3>
        <ul>
          <li>{t("help.tips.drag")}</li>
          <li>{t("help.tips.nfaBranch")}</li>
          <li>{t("help.tips.yaml")}</li>
          <li>{t("help.tips.acceptedWords")}</li>
        </ul>

        <p className="help-feedback">
          {t("help.feedback.body")}{" "}
          <a href={NEW_ISSUE_URL} target="_blank" rel="noopener noreferrer">
            {t("help.feedback.link")}
          </a>
        </p>
      </div>
    </div>
  );
};
