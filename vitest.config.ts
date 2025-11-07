import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    exclude: ["**/dist", "coverage", "node_modules"],
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
