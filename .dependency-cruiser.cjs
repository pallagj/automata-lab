/**
 * The architecture, checked on every `npm test`: who may depend on whom.
 *
 *   packages/core       the algorithms, the cell language, the worksheet format — pure, depends on nothing of ours
 *   packages/contract   the API: schemas + routes → generated OpenAPI → generated client; depends on core only
 *   apps/web            the browser app: core, and the contract's generated client
 *   apps/server         hexagonal: domain ← application (use cases, ports) ← adapters ← main.ts (composition root)
 */

const SERVER = "^apps/server/src/";
const ADAPTERS = ["http", "mcp", "persistence", "system"];

/** packages a layer may use from node_modules; anything else is refused */
const npm = (...names) => `^node_modules/(${names.join("|")})/`;

module.exports = {
  forbidden: [
    {
      name: "no-circular",
      severity: "error",
      comment: "A cycle makes two modules one; split out what both need. (A cycle through a type-only import does not exist at run time.)",
      from: {},
      to: { circular: true, viaOnly: { dependencyTypesNot: ["type-only"] } }
    },
    {
      name: "core-is-pure",
      severity: "error",
      comment: "core runs anywhere — browser, server, tests: only its own files and js-yaml (i18next for a type), no Node built-ins.",
      from: { path: "^packages/core/src/", pathNot: "\\.test\\.ts$" },
      to: {
        pathNot: ["^packages/core/src/", npm("js-yaml", "i18next")]
      }
    },
    {
      name: "contract-depends-on-core-only",
      severity: "error",
      from: { path: "^packages/contract/" },
      to: { path: ["^apps/"] }
    },
    {
      name: "apps-do-not-import-each-other",
      severity: "error",
      comment: "What the web app and the server share belongs in packages/.",
      from: { path: "^apps/(web|server)/" },
      to: { path: "^apps/", pathNot: "^apps/$1/" }
    },
    {
      name: "web-uses-the-generated-client",
      severity: "error",
      comment: "The browser talks to the API through the client generated from the OpenAPI document, not the server's schemas.",
      from: { path: "^apps/web/" },
      to: { path: "^packages/contract/", pathNot: "^packages/contract/src/(client|generated/api)\\.ts$" }
    },
    {
      name: "web-state-does-not-know-the-ui",
      severity: "error",
      from: { path: "^apps/web/src/state/" },
      to: { path: "^apps/web/src/ui/" }
    },
    {
      name: "server-domain-is-pure",
      severity: "error",
      comment: "The domain is the rules alone: no use cases, no adapters, no frameworks.",
      from: { path: `${SERVER}domain/`, pathNot: "\\.test\\.ts$" },
      to: { pathNot: [`${SERVER}domain/`, "^packages/core/src/"] }
    },
    {
      name: "server-application-knows-no-adapter",
      severity: "error",
      comment: "Use cases reach the world only through their ports (application/ports.ts).",
      from: { path: `${SERVER}application/`, pathNot: "\\.test\\.ts$" },
      to: { pathNot: [`${SERVER}(application|domain)/`, "^packages/core/src/"] }
    },
    ...ADAPTERS.map((adapter) => ({
      name: `server-adapter-${adapter}-stands-alone`,
      severity: "error",
      comment: "Adapters are wired together in main.ts only.",
      from: { path: `${SERVER}adapters/${adapter}/`, pathNot: "\\.test\\.ts$" },
      to: { path: `${SERVER}adapters/`, pathNot: `${SERVER}adapters/${adapter}/` }
    })),
    {
      name: "only-the-composition-root-builds-the-server",
      severity: "error",
      from: { path: SERVER, pathNot: [`${SERVER}main\\.ts$`, "\\.test\\.ts$"] },
      to: { path: `${SERVER}(main|config)\\.ts$` }
    },
    {
      name: "no-test-code-in-the-product",
      severity: "error",
      from: { pathNot: "\\.test\\.ts$" },
      to: { path: ["\\.test\\.ts$", "^packages/core/src/testing\\.ts$"] }
    }
  ],
  options: {
    doNotFollow: { path: "node_modules" },
    // our own build output; a package's dist/ in node_modules is what an import resolves to, and stays
    exclude: { path: "^(apps|packages)/[^/]+/(dist|dev-dist)/" },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: "tsconfig.base.json" },
    enhancedResolveOptions: {
      exportsFields: ["exports"],
      conditionNames: ["import", "require", "node", "default", "types"],
      extensions: [".ts", ".tsx", ".js", ".mjs", ".json"]
    },
    reporterOptions: { text: { highlightFocused: true } }
  }
};
