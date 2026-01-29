import {
  getClientFileName,
  getConfigFileName,
  getExampleWorkflowFileName,
} from "./commands.js";
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

describe("getExampleWorkflowFileName", () => {
  test("uses TypeScript when it is in devDependencies", () => {
    expect(
      getExampleWorkflowFileName({
        devDependencies: { typescript: "^5.0.0" },
      }),
    ).toBe("hello-world.ts");
  });

  test("uses TypeScript when it is in dependencies", () => {
    expect(
      getExampleWorkflowFileName({
        dependencies: { typescript: "^5.0.0" },
      }),
    ).toBe("hello-world.ts");
  });

  test("falls back to JavaScript when package.json is missing", () => {
    expect(getExampleWorkflowFileName(null)).toBe("hello-world.js");
  });

  test("falls back to JavaScript when package.json has no TypeScript", () => {
    expect(
      getExampleWorkflowFileName({ dependencies: {}, devDependencies: {} }),
    ).toBe("hello-world.js");
  });
});

describe("getClientFileName", () => {
  test("uses TypeScript when it is in devDependencies", () => {
    expect(
      getClientFileName({
        devDependencies: { typescript: "^5.0.0" },
      }),
    ).toBe("client.ts");
  });

  test("uses TypeScript when it is in dependencies", () => {
    expect(
      getClientFileName({
        dependencies: { typescript: "^5.0.0" },
      }),
    ).toBe("client.ts");
  });

  test("falls back to JavaScript when package.json is missing", () => {
    expect(getClientFileName(null)).toBe("client.js");
  });

  test("falls back to JavaScript when package.json has no TypeScript", () => {
    expect(getClientFileName({ dependencies: {}, devDependencies: {} })).toBe(
      "client.js",
    );
  });
});
