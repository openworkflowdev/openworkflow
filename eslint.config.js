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
  // @ts-ignore
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
      "packages/dashboard/src/routeTree.gen.ts",
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
  {
    files: ["**/*.mjs"],
    ...tseslint.configs.disableTypeChecked,
    languageOptions: {
      parserOptions: {
        projectService: false,
        project: false,
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
    files: [
      "**/*.test.ts",
      "packages/openworkflow/backend.testsuite.ts",
      "packages/openworkflow/postgres/**/*.ts",
      "packages/openworkflow/sqlite/**/*.ts",
    ],
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
    rules: {
      "import/no-relative-parent-imports": "off",
      "jsdoc/require-jsdoc": "off",
      "sonarjs/prefer-read-only-props": "off",
    },
  },
  {
    files: [
      "packages/dashboard/**/*.test.ts",
      "packages/dashboard/**/*.test.tsx",
    ],
    rules: {
      "import/no-extraneous-dependencies": [
        "error",
        {
          devDependencies: true,
          packageDir: [".", "packages/dashboard"],
        },
      ],
    },
  },
  {
    files: ["packages/dashboard/src/routes/runs/$runId.tsx"],
    rules: {
      "unicorn/filename-case": "off",
    },
  },
);
