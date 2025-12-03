// @ts-check
import eslint from "@eslint/js";
import prettier from "eslint-config-prettier";
import functional from "eslint-plugin-functional";
import sonarjs from "eslint-plugin-sonarjs";
import unicorn from "eslint-plugin-unicorn";
import { defineConfig } from "eslint/config";
import tseslint from "typescript-eslint";

export default defineConfig(
  eslint.configs.recommended,
  tseslint.configs.strictTypeChecked,
  tseslint.configs.stylisticTypeChecked,
  sonarjs.configs.recommended,
  unicorn.configs.recommended,
  prettier,
  {
    ignores: ["**/dist", "coverage", "eslint.config.js", "prettier.config.js"],
  },
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    rules: {
      "@typescript-eslint/unified-signatures": "off", // Buggy rule, to be enabled later
      "func-style": ["error", "declaration"],
      "unicorn/no-null": "off",
      "unicorn/prevent-abbreviations": "off",
    },
  },
  {
    files: ["**/*.test.ts"],
    rules: {
      "sonarjs/no-nested-functions": "off",
    },
  },
  {
    files: ["packages/openworkflow/core/**/*.ts"],
    ignores: ["**/*.test.ts"],
    plugins: {
      // @ts-expect-error - eslint-plugin-functional types don't align with eslint's Plugin type
      functional,
    },
    rules: {
      ...functional.configs.externalTypeScriptRecommended.rules,
      ...functional.configs.recommended.rules,
      ...functional.configs.stylistic.rules,
      "functional/prefer-property-signatures": "off",
    },
  },
);
