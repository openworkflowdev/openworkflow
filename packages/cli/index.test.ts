import { configExists, loadConfig, resolveConfigPath } from "./config.js";
import { CLIError } from "./errors.js";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

describe("config", () => {
  let testDir: string;

  beforeEach(() => {
    testDir = path.join(tmpdir(), `cli-test-${String(Date.now())}`);
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  test("resolveConfigPath returns path to openworkflow.config.ts", () => {
    expect(resolveConfigPath(testDir)).toBe(
      path.join(testDir, "openworkflow.config.ts"),
    );
  });

  test("configExists returns false when missing, true when present", () => {
    expect(configExists(testDir)).toBe(false);
    writeFileSync(path.join(testDir, "openworkflow.config.ts"), "");
    expect(configExists(testDir)).toBe(true);
  });

  test("loadConfig throws when file missing", async () => {
    await expect(loadConfig(testDir)).rejects.toThrow(CLIError);
  });

  test("loadConfig throws when no default export", async () => {
    writeFileSync(
      path.join(testDir, "openworkflow.config.ts"),
      "export const x = 1;",
    );
    await expect(loadConfig(testDir)).rejects.toThrow(/default export|missing 'ow' property/);
  });

  test("loadConfig throws when missing ow property", async () => {
    writeFileSync(
      path.join(testDir, "openworkflow.config.ts"),
      "export default {};",
    );
    await expect(loadConfig(testDir)).rejects.toThrow("ow");
  });

  test("loadConfig returns config with ow property", async () => {
    writeFileSync(
      path.join(testDir, "openworkflow.config.ts"),
      "export default { ow: { newWorker: () => ({}) } };",
    );
    const config = await loadConfig(testDir);
    expect(config.ow).toBeDefined();
  });
});
