// @ts-check
import cspell from "@cspell/eslint-plugin/configs";
import eslint from "@eslint/js";
import prettier from "eslint-config-prettier";
import functional from "eslint-plugin-functional";
import importPlugin from "eslint-plugin-import";
import jsdoc from "eslint-plugin-jsdoc";
import sonarjs from "eslint-plugin-sonarjs";
import unicorn from "eslint-plugin-unicorn";
import { defineConfig } from "eslint/config";
import tseslint from "typescript-eslint";

export default defineConfig(
  eslint.configs.recommended,
  tseslint.configs.strictTypeChecked,
  tseslint.configs.stylisticTypeChecked,
  importPlugin.flatConfigs.recommended,
  importPlugin.flatConfigs.typescript,
  sonarjs.configs.recommended,
  unicorn.configs.recommended,
  jsdoc.configs["flat/recommended-typescript-error"],
  cspell.recommended,
  prettier,
  {
    ignores: [
      "**/dist",
      "coverage",
      "eslint.config.js",
      "prettier.config.js",
      "examples/workflow-discovery/openworkflow.config.js",
      "packages/dashboard/.output",
    ],
  },
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  // ---------------------------------------------------------------------------
  {
    settings: {
      "import/resolver": {
        typescript: {
          alwaysTryTypes: true,
        },
      },
    },
  },
  // ---------------------------------------------------------------------------
  {
    rules: {
      "@cspell/spellchecker": [
        "error",
        {
          cspell: {
            flagWords: ["cancellation", "cancelled"], // prefer en-US spelling for consistency
            ignoreWords: [
              "arktype",
              "heartbeating",
              "idempotently",
              "openworkflow",
              "sonarjs",
              "timestamptz",
            ],
          },
        },
      ],
      "@typescript-eslint/unified-signatures": "off", // Buggy rule, to be enabled later
      "func-style": ["error", "declaration"],
      // "import/no-cycle": "error", // doubles eslint time, enable occasionally to check for cycles
      "import/no-extraneous-dependencies": "error",
      "import/no-relative-parent-imports": "error",
      "import/no-useless-path-segments": "error",
      "jsdoc/check-indentation": "error",
      "jsdoc/require-throws": "error",
      "jsdoc/sort-tags": "error",
      "unicorn/no-null": "off",
      "unicorn/prevent-abbreviations": "off",
    },
  },
  {
    files: ["**/*.test.ts", "benchmarks/**/*.ts", "examples/**/*.ts"],
    rules: {
      "jsdoc/require-jsdoc": "off",
    },
  },
  {
    files: ["**/*.test.ts", "packages/backend-postgres/scripts/**/*.ts"],
    rules: {
      "import/no-relative-parent-imports": "off",
    },
  },
  {
    files: ["**/*.test.ts", "**/*.testsuite.ts"],
    rules: {
      "sonarjs/no-nested-functions": "off",
    },
  },
  {
    files: ["packages/cli/templates/**/*.ts"],
    rules: {
      "import/no-extraneous-dependencies": "off",
    },
  },
  {
    files: ["packages/openworkflow/core/**/*.ts"],
    ignores: ["**/*.test.ts", "**/*.testsuite.ts"],
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
  {
    files: ["packages/dashboard/**/*.{ts,tsx,js,jsx}"],
    ignores: [
      "packages/dashboard/eslint.config.js",
      "packages/dashboard/prettier.config.js",
      "packages/dashboard/vite.config.ts",
    ],
    // massive, but temporary, will need to come back and enable these a few at
    // a time
    rules: {
      "@cspell/spellchecker": "off",
      "@typescript-eslint/array-type": "off",
      "@typescript-eslint/consistent-type-definitions": "off",
      "@typescript-eslint/explicit-function-return-type": "off",
      "@typescript-eslint/no-confusing-void-expression": "off",
      "@typescript-eslint/no-deprecated": "off",
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-floating-promises": "off",
      "@typescript-eslint/no-unnecessary-boolean-literal-compare": "off",
      "@typescript-eslint/no-unnecessary-condition": "off",
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
      "@typescript-eslint/no-unsafe-return": "off",
      "@typescript-eslint/no-unused-vars": "off",
      "@typescript-eslint/prefer-nullish-coalescing": "off",
      "@typescript-eslint/restrict-template-expressions": "off",
      "@typescript-eslint/unified-signatures": "off",
      "func-style": "off",
      "functional/prefer-property-signatures": "off",
      "import/no-cycle": "off",
      "import/no-extraneous-dependencies": "off",
      "import/no-relative-parent-imports": "off",
      "import/no-unresolved": "off",
      "import/no-useless-path-segments": "off",
      "import/order": "off",
      "jsdoc/check-indentation": "off",
      "jsdoc/require-jsdoc": "off",
      "jsdoc/require-throws": "off",
      "jsdoc/sort-tags": "off",
      "no-unused-vars": "off",
      "no-void": "off",
      "sonarjs/cognitive-complexity": "off",
      "sonarjs/deprecation": "off",
      "sonarjs/function-return-type": "off",
      "sonarjs/no-nested-conditional": "off",
      "sonarjs/prefer-read-only-props": "off",
      "sonarjs/pseudo-random": "off",
      "sonarjs/unused-import": "off",
      "unicorn/filename-case": "off",
      "unicorn/no-abusive-eslint-disable": "off",
      "unicorn/no-null": "off",
      "unicorn/prevent-abbreviations": "off",
      "unicorn/text-encoding-identifier-case": "off",
    },
  },
);
