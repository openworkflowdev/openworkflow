import {
  discoverWorkflowFiles,
  getDashboardSpawnOptions,
  getClientFileName,
  getConfigFileName,
  getExampleWorkflowFileName,
  getRunFileName,
  validateDashboardPort,
} from "./commands.js";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
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

describe("getRunFileName", () => {
  test("uses TypeScript when it is in devDependencies", () => {
    expect(
      getRunFileName({
        devDependencies: { typescript: "^5.0.0" },
      }),
    ).toBe("hello-world.run.ts");
  });

  test("uses TypeScript when it is in dependencies", () => {
    expect(
      getRunFileName({
        dependencies: { typescript: "^5.0.0" },
      }),
    ).toBe("hello-world.run.ts");
  });

  test("falls back to JavaScript when package.json is missing", () => {
    expect(getRunFileName(null)).toBe("hello-world.run.js");
  });

  test("falls back to JavaScript when package.json has no TypeScript", () => {
    expect(getRunFileName({ dependencies: {}, devDependencies: {} })).toBe(
      "hello-world.run.js",
    );
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

describe("discoverWorkflowFiles", () => {
  test("respects ignorePatterns", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ow-ignore-"));
    try {
      const workflowsDir = path.join(tmpDir, "openworkflow");
      fs.mkdirSync(workflowsDir, { recursive: true });

      const keepFile = path.join(workflowsDir, "hello-world.ts");
      const ignoredFile = path.join(workflowsDir, "hello-world.skip.ts");

      fs.writeFileSync(keepFile, "export const hello = true;");
      fs.writeFileSync(ignoredFile, "export const skip = true;");

      const files = discoverWorkflowFiles(["openworkflow"], tmpDir, [
        "**/*.skip.ts",
      ]);

      expect(files).toEqual([keepFile]);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

describe("getDashboardSpawnOptions", () => {
  test("uses default npx command without a custom port env", () => {
    const options = getDashboardSpawnOptions();

    expect(options.command).toBe("npx");
    expect(options.args).toEqual(["@openworkflow/dashboard"]);
    expect(options.spawnOptions.env?.["PORT"]).toBeUndefined();
    expect(options.spawnOptions.stdio).toBe("inherit");
  });

  test("sets PORT env when a custom dashboard port is provided", () => {
    const options = getDashboardSpawnOptions(4321);

    expect(options.command).toBe("npx");
    expect(options.args).toEqual(["@openworkflow/dashboard"]);
    expect(options.spawnOptions.env?.["PORT"]).toBe("4321");
    expect(options.spawnOptions.stdio).toBe("inherit");
  });
});

describe("validateDashboardPort", () => {
  test("returns undefined when no custom port is provided", () => {
    expect(validateDashboardPort()).toBeUndefined();
  });

  test("returns the port when it is within range", () => {
    expect(validateDashboardPort(3001)).toBe(3001);
  });

  test("throws for non-integer ports", () => {
    expect(() => validateDashboardPort(Number.NaN)).toThrow(
      "Invalid dashboard port.",
    );
    expect(() => validateDashboardPort(3000.5)).toThrow(
      "Invalid dashboard port.",
    );
  });

  test("throws for out-of-range ports", () => {
    expect(() => validateDashboardPort(0)).toThrow("Invalid dashboard port.");
    expect(() => validateDashboardPort(65_536)).toThrow(
      "Invalid dashboard port.",
    );
  });
});
