//  @ts-check
import { tanstackConfig } from "@tanstack/eslint-config";

export default [
  {
    ignores: ["eslint.config.js", "prettier.config.js", "vite.config.ts"],
  },
  ...tanstackConfig,
  {
    rules: {
      // Disable any conflicting import ordering rules from TanStack config
      "import/order": "off",
      "sort-imports": "off",
      "@typescript-eslint/consistent-type-imports": [
        "error",
        {
          prefer: "type-imports",
          fixStyle: "separate-type-imports",
        },
      ],
    },
  },
];
