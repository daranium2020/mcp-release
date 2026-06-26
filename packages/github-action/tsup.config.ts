import { defineConfig } from "tsup";

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
  // Silence "Found duplicate" warnings from bundling workspace packages
  silent: false,
});
