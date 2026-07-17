import { defineConfig } from "tsup";
import { readFileSync } from "node:fs";

const { version } = JSON.parse(readFileSync("./package.json", "utf8")) as { version: string };

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["cjs"],
  bundle: true,
  // Bundle all dependencies — GitHub Actions need a single dist/index.js file
  // with no external node_modules. Node built-in modules stay external.
  noExternal: [/^(?!node:).+/],
  platform: "node",
  target: "node20",
  outDir: "dist",
  clean: true,
  // GitHub Actions requires dist/index.js — force .js extension for CJS output
  outExtension: () => ({ js: ".js" }),
  sourcemap: false,
  minify: false,
  dts: false,
  // Inject version from package.json at build time
  define: {
    __ACTION_VERSION__: JSON.stringify(version),
  },
  // Silence "Found duplicate" warnings from bundling workspace packages
  silent: false,
});
