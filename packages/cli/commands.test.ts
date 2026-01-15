import { getConfigFileName } from "./commands.js";
import { describe, expect, test } from "vitest";

describe("getConfigFileName", () => {
  test("prefers TypeScript when it is in devDependencies", () => {
    expect(
      getConfigFileName({ devDependencies: { typescript: "^5.0.0" } }),
    ).toBe("openworkflow.config.ts");
  });

  test("prefers TypeScript when it is in dependencies", () => {
    expect(getConfigFileName({ dependencies: { typescript: "^5.0.0" } })).toBe(
      "openworkflow.config.ts",
    );
  });

  test("falls back to JavaScript when TypeScript is missing", () => {
    expect(getConfigFileName(null)).toBe("openworkflow.config.js");
  });

  test("falls back to JavaScript when package.json has no TypeScript", () => {
    expect(getConfigFileName({ dependencies: {}, devDependencies: {} })).toBe(
      "openworkflow.config.js",
    );
  });
});
