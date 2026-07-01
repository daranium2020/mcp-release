import js from "@eslint/js";
import tsPlugin from "@typescript-eslint/eslint-plugin";
import tsParser from "@typescript-eslint/parser";
import globals from "globals";
import nextPlugin from "@next/eslint-plugin-next";

export default [
  js.configs.recommended,
  {
    files: ["**/*.ts", "**/*.tsx"],
    languageOptions: {
      parser: tsParser,
      globals: {
        // Node.js globals (process, Buffer, __dirname, etc.)
        ...globals.node,
        // Web API globals available in Node.js 20+ (fetch, URL, AbortController, etc.)
        ...globals.browser,
      },
    },
    plugins: {
      "@typescript-eslint": tsPlugin,
    },
    rules: {
      ...tsPlugin.configs.recommended.rules,
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      // Disable base rules superseded by TypeScript-aware equivalents
      "no-unused-vars": "off",
      // TypeScript handles redeclaration checking; this rule doesn't understand
      // the valid pattern of `export const Foo = z.enum(...)` + `export type Foo = ...`
      "no-redeclare": "off",
      // TypeScript handles undef; the @types/node package declares globals
      "no-undef": "off",
    },
  },
  // scripts/*.mjs — plain Node.js ES modules; no TypeScript parser needed.
  {
    files: ["scripts/**/*.mjs"],
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.browser,
      },
    },
  },
  // Register the @next/next plugin globally (no files filter) so Next.js build's
  // plugin-detection passes: it calls calculateConfigForFile on the config file
  // itself, which only sees plugins registered without a files constraint.
  {
    plugins: {
      "@next/next": nextPlugin,
    },
  },
  // Apply Next.js recommended rules scoped to the two Next.js app directories.
  {
    files: [
      "apps/web/**/*.{ts,tsx,js,jsx}",
      "apps/public-mcp-fixture/**/*.{ts,tsx,js,jsx}",
    ],
    rules: {
      ...nextPlugin.configs.recommended.rules,
      // Both apps use App Router — no pages/ directory exists. Next.js itself
      // conditionally omits this Pages Router rule when pagesDir is absent.
      "@next/next/no-html-link-for-pages": "off",
    },
  },
  // opengraph-image.tsx generates a static PNG using next/og's ImageResponse
  // (Satori). next/image cannot be used in that JSX — it is a server-side image
  // rendering context, not a browser page. <img> is correct and intentional.
  {
    files: ["apps/web/src/app/opengraph-image.tsx"],
    rules: {
      "@next/next/no-img-element": "off",
    },
  },
  {
    ignores: [
      "**/dist/**",
      "**/node_modules/**",
      "**/.next/**",
      "vitest.config.ts",
      "**/tsup.config.ts",
      "**/next.config.ts",
      "**/next-env.d.ts",
    ],
  },
];
