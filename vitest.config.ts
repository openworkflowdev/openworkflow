import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globalSetup: ["packages/openworkflow/postgres/vitest.global-setup.ts"],
    exclude: ["**/dist", "benchmarks", "coverage", "examples", "node_modules"],
    coverage: {
      include: ["packages/**/*.ts"],
      exclude: [
        "**/*.testsuite.ts",
        "**/dist/**",
        "**/scripts/*.ts",
        "vitest.global-setup.ts",
        "packages/cli/**",
        "packages/dashboard/**",
      ],
      thresholds: {
        statements: 90,
        branches: 80,
        functions: 90,
        lines: 90,
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
