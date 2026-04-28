// @ts-check
import eslint from "@eslint/js";
import prettier from "eslint-config-prettier";
import boundaries from "eslint-plugin-boundaries";
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
  prettier,
  {
    ignores: [
      "**/dist",
      "examples/workflow-discovery/openworkflow.config.js",
      "apps/dashboard/.output",
      "apps/dashboard/src/routeTree.gen.ts",
      "commitlint.config.js",
      "coverage",
      "eslint.config.js",
      "prettier.config.js",
    ],
  },
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    settings: {
      "import/resolver": {
        typescript: {
          alwaysTryTypes: true,
        },
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
  {
    rules: {
      "func-style": ["error", "declaration"],
      // "import/no-cycle": "error", // doubles eslint time, enable occasionally to check for cycles
      "import/no-extraneous-dependencies": "error",
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
    files: ["**/*.test.ts", "**/*.testsuite.ts"],
    rules: {
      "sonarjs/no-nested-functions": "off",
    },
  },
  // ===========================================================================
  // cli
  // ===========================================================================
  {
    files: ["apps/cli/templates/**/*.ts"],
    rules: {
      "import/no-extraneous-dependencies": "off",
    },
  },
  // ===========================================================================
  // dashboard
  // ===========================================================================
  {
    files: ["apps/dashboard/**/*.{ts,tsx,js,jsx}"],
    rules: {
      "jsdoc/require-jsdoc": "off",
      "sonarjs/prefer-read-only-props": "off",
    },
  },
  {
    files: ["apps/dashboard/**/*.test.ts", "apps/dashboard/**/*.test.tsx"],
    rules: {
      "import/no-extraneous-dependencies": [
        "error",
        {
          devDependencies: true,
          packageDir: [".", "apps/dashboard"],
        },
      ],
    },
  },
  {
    files: ["apps/dashboard/src/routes/runs/$runId.tsx"],
    rules: {
      "unicorn/filename-case": "off",
    },
  },
  // ===========================================================================
  // openworkflow
  // ===========================================================================
  {
    files: ["packages/openworkflow/**/*.ts"],
    ignores: ["**/*.test.ts"],
    plugins: {
      boundaries,
    },
    settings: {
      "boundaries/elements": [
        {
          type: "core",
          pattern: "packages/openworkflow/core/**",
        },
        {
          type: "app",
          pattern: "packages/openworkflow/{client,worker}/**",
        },
        {
          type: "infra",
          pattern: "packages/openworkflow/{postgres,sqlite,testing}/**",
        },
      ],
    },
    rules: {
      "boundaries/dependencies": [
        "error",
        {
          default: "disallow",
          rules: [
            {
              from: { type: "core" },
              disallow: [{ to: { type: "*" } }],
            },
            {
              from: { type: "app" },
              allow: [{ to: { type: ["app", "core"] } }],
            },
            {
              from: { type: "infra" },
              allow: [{ to: { type: ["app", "core", "infra"] } }],
            },
          ],
        },
      ],
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
      "functional/immutable-data": "off",
      "functional/no-conditional-statements": "off",
      "functional/no-expression-statements": "off",
      "functional/no-loop-statements": "off",
      "functional/no-mixed-types": "off",
      "functional/prefer-property-signatures": "off",
    },
  },
);
