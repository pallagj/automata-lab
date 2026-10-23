// Bundles the server into dist/main.js: the shared workspace packages (TypeScript sources)
// go into the bundle, every other package stays in node_modules.
import { build } from "esbuild";

await build({
  entryPoints: ["src/main.ts"],
  outfile: "dist/main.js",
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  sourcemap: true,
  logLevel: "info",
  plugins: [
    {
      name: "external-packages",
      setup(b) {
        b.onResolve({ filter: /^[^./]/ }, (args) =>
          args.path.startsWith("@automatalab/") ? undefined : { path: args.path, external: true }
        );
      }
    }
  ]
});
