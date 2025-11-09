import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globalSetup: ["packages/backend-postgres/vitest.global-setup.ts"],
    exclude: ["**/dist", "benchmarks", "coverage", "examples", "node_modules"],
    coverage: {
      include: ["packages/*/index.ts", "packages/*/*.ts"],
      reporter: ["html"],
      thresholds: {
        statements: 80,
        branches: 80,
        functions: 80,
        lines: 80,
      },
    },
  },
});
