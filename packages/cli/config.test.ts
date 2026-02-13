import { defineConfig, loadConfig, loadConfigFromPath } from "./config.js";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Backend } from "openworkflow/internal";
import { beforeEach, afterEach, describe, expect, test } from "vitest";

describe("defineConfig", () => {
  test("returns the same config", () => {
    const backend = {} as Backend; // Mock backend for testing
    const config = { backend };
    const result = defineConfig(config);
    expect(result).toBe(config);
  });
});

interface TestConfig {
  name: string;
}

describe("loadConfig", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ow-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test.each([
    [
      "cjs",
      `module.exports = { name: "cjs" };`,
      "openworkflow.config.cjs",
      "cjs",
    ],
    [
      "ts",
      `const name: string = "ts"; export default { name };`,
      "openworkflow.config.ts",
      "ts",
    ],
    [
      "js",
      `export default { name: "js-default" }`,
      "openworkflow.config.js",
      "js-default",
    ],
    [
      "mjs",
      `export const name = "mjs-named";`,
      "openworkflow.config.mjs",
      "mjs-named",
    ],
  ])("loads %s config", async (_ext, content, filename, expectedName) => {
    const filePath = path.join(tmpDir, filename);
    fs.writeFileSync(filePath, content);

    const { config, configFile } = await loadConfig(tmpDir);
    const cfg = config as unknown as TestConfig; // this'll work until we validate
    expect(cfg.name).toBe(expectedName);
    expect(configFile).toContain(filename);
  });

  test("throws if importing the config file fails", async () => {
    const filePath = path.join(tmpDir, "openworkflow.config.js");
    // simulate failure, throw when imported
    fs.writeFileSync(filePath, `throw new Error("boom")`);

    await expect(loadConfig(tmpDir)).rejects.toThrow(
      /Failed to load config file/,
    );
  });

  test("returns empty config object when no config file is found", async () => {
    const { config, configFile } = await loadConfig(tmpDir);
    expect(config).toEqual({});
    expect(configFile).toBeUndefined();
  });

  test("falls back to module when default export is undefined", async () => {
    const filePath = path.join(tmpDir, "openworkflow.config.js");
    fs.writeFileSync(
      filePath,
      `export default undefined; export const name = "fallback";`,
    );

    const { config } = await loadConfig(tmpDir);
    const cfg = config as unknown as TestConfig;
    expect(cfg.name).toBe("fallback");
  });

  test("uses process.cwd when rootDir is not provided", async () => {
    const originalCwd = process.cwd();
    try {
      const filePath = path.join(tmpDir, "openworkflow.config.js");
      fs.writeFileSync(filePath, `export default { name: "cwd" };`);

      process.chdir(tmpDir);
      const { config, configFile } = await loadConfig();
      const cfg = config as unknown as TestConfig;
      expect(cfg.name).toBe("cwd");
      expect(configFile).toContain("openworkflow.config.js");
    } finally {
      process.chdir(originalCwd);
    }
  });

  test("loads an explicit config path", async () => {
    const filePath = path.join(tmpDir, "src", "openworkflow.config.js");
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, `export default { name: "explicit" };`);

    const { config, configFile } = await loadConfigFromPath(
      "src/openworkflow.config.js",
      tmpDir,
    );
    const cfg = config as unknown as TestConfig;
    expect(cfg.name).toBe("explicit");
    expect(configFile).toBe(filePath);
  });

  test("does not fallback to discovered config when explicit path is missing", async () => {
    const filePath = path.join(tmpDir, "openworkflow.config.js");
    fs.writeFileSync(filePath, `export default { name: "discovered" };`);

    const { config, configFile } = await loadConfigFromPath(
      "src/openworkflow.config.js",
      tmpDir,
    );
    expect(config).toEqual({});
    expect(configFile).toBeUndefined();
  });
});
