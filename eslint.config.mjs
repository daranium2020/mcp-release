import js from "@eslint/js";
import tsPlugin from "@typescript-eslint/eslint-plugin";
import tsParser from "@typescript-eslint/parser";
import globals from "globals";

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
