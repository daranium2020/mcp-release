import { defineConfig } from "tsup";
import { readFileSync } from "node:fs";

const { version } = JSON.parse(readFileSync("./package.json", "utf8")) as { version: string };

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["cjs"],
  bundle: true,
  // Bundle all dependencies — installed CLI needs a self-contained dist/index.js
  // with no external workspace packages. Node built-in modules stay external.
  noExternal: [/^(?!node:).+/],
  platform: "node",
  target: "node20",
  outExtension: () => ({ js: ".js" }),
  sourcemap: false,
  clean: true,
  dts: false,
  // Inject version from package.json at build time (avoids import.meta.url in CJS bundle)
  define: {
    __CLI_VERSION__: JSON.stringify(version),
  },
  banner: {
    js: "#!/usr/bin/env node",
  },
});
