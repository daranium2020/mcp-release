import { defineConfig } from "vitest/config";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  esbuild: {
    // Automatic JSX transform for React 17+ components in test files.
    // Only activates for .tsx files; no effect on plain .ts tests.
    jsx: "automatic",
    jsxImportSource: "react",
  },
  resolve: {
    // Resolve internal workspace packages to their TypeScript source so tests
    // run without requiring a prior `pnpm build`. The CLI integration tests
    // (cli-smoke, cli-verify) still need the compiled binary and therefore
    // require `pnpm build` to have run — those are covered by the CI ordering
    // (build step runs before test step).
    alias: {
      "@mcp-launch/core": resolve(__dirname, "packages/core/src/index.ts"),
      "@mcp-launch/reporter": resolve(__dirname, "packages/reporter/src/index.ts"),
    },
  },
  test: {
    globals: true,
    environment: "node",
    include: [
      "packages/*/tests/**/*.test.ts",
      "fixtures/*/tests/**/*.test.ts",
      "apps/*/tests/**/*.test.ts",
      "apps/*/tests/**/*.test.tsx",
    ],
    testTimeout: 15000,
    hookTimeout: 15000,
    pool: "forks",
  },
});
