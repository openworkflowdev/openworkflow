import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globalSetup: ["packages/openworkflow/postgres/vitest.global-setup.ts"],
    exclude: ["**/dist", "benchmarks", "coverage", "examples", "node_modules"],
    coverage: {
      include: ["apps/**/*.ts", "packages/**/*.ts"],
      exclude: [
        "**/*.testsuite.ts",
        "**/dist/**",
        "**/scripts/*.ts",
        "vitest.global-setup.ts",
        "apps/cli/**",
        "apps/dashboard/**",
      ],
      thresholds: {
        statements: 90,
        branches: 80,
        functions: 90,
        lines: 90,
        "packages/openworkflow/core/**": {
          statements: 100,
          branches: 100,
          functions: 100,
          lines: 100,
        },
      },
    },
    // fix ESM resolution issues when running tests with Bun
    server: {
      deps: {
        inline: ["arktype", "valibot", "yup", "zod"],
      },
    },
  },
});
