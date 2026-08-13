// @ts-check
import eslint from "@eslint/js";
import prettier from "eslint-config-prettier";
import { createTypeScriptImportResolver } from "eslint-import-resolver-typescript";
import boundaries from "eslint-plugin-boundaries";
import functional from "eslint-plugin-functional";
import { importX } from "eslint-plugin-import-x";
import jsdoc from "eslint-plugin-jsdoc";
import sonarjs from "eslint-plugin-sonarjs";
import unicorn from "eslint-plugin-unicorn";
import { defineConfig } from "eslint/config";
import tseslint from "typescript-eslint";

export default defineConfig(
  eslint.configs.recommended,
  tseslint.configs.strictTypeChecked,
  tseslint.configs.stylisticTypeChecked,
  importX.flatConfigs.recommended,
  importX.flatConfigs.typescript,
  // @ts-ignore
  sonarjs.configs.recommended,
  unicorn.configs.recommended,
  jsdoc.configs["flat/recommended-typescript-error"],
  prettier,
  {
    ignores: [
      "**/.output",
      "**/.turbo",
      "**/dist",
      "examples/workflow-discovery/openworkflow.config.js",
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
      "import-x/resolver-next": [
        createTypeScriptImportResolver({
          alwaysTryTypes: true,
        }),
      ],
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
      // "import-x/no-cycle": "error", // doubles eslint time, enable occasionally to check for cycles
      "import-x/no-extraneous-dependencies": "error",
      "import-x/no-useless-path-segments": "error",
      "jsdoc/check-indentation": "error",
      "jsdoc/require-throws": "error",
      "jsdoc/sort-tags": "error",
      "unicorn/no-null": "off",
      "unicorn/prevent-abbreviations": "off",

      // eslint-plugin-unicorn v73, reenable selectively
      "unicorn/consistent-boolean-name": "off",
      "unicorn/consistent-class-member-order": "off",
      "unicorn/consistent-conditional-object-spread": "off",
      "unicorn/max-nested-calls": "off",
      "unicorn/name-replacements": "off",
      "unicorn/no-break-in-nested-loop": "off",
      "unicorn/no-computed-property-existence-check": "off",
      "unicorn/no-declarations-before-early-exit": "off",
      "unicorn/no-error-property-assignment": "off",
      "unicorn/no-non-function-verb-prefix": "off",
      "unicorn/no-return-array-push": "off",
      "unicorn/no-useless-promise-resolve-reject": "off",
      "unicorn/prefer-await": "off",
      "unicorn/prefer-continue": "off",
      "unicorn/prefer-early-return": "off",
      "unicorn/prefer-global-number-constants": "off",
      "unicorn/prefer-iterator-to-array": "off",
      "unicorn/prefer-math-constants": "off",
      "unicorn/prefer-minimal-ternary": "off",
      "unicorn/prefer-number-coercion": "off",
      "unicorn/prefer-number-is-safe-integer": "off",
      "unicorn/prefer-object-destructuring-defaults": "off",
      "unicorn/prefer-promise-with-resolvers": "off",
      "unicorn/prefer-smaller-scope": "off",
      "unicorn/single-line-block-comment-style": "off",
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
      "import-x/no-extraneous-dependencies": "off",
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
      "import-x/no-extraneous-dependencies": [
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
