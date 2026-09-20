import { execFile } from "node:child_process";
import { cp, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { describe, expect, test } from "vitest";

const execFileAsync = promisify(execFile);

describe("optional OpenTelemetry API", () => {
  test("runs workflows, waits, and signals without the optional API", async () => {
    const directory = await mkdtemp(
      path.join(tmpdir(), "openworkflow-no-otel-"),
    );
    try {
      await cp(new URL("dist/", import.meta.url), directory, {
        recursive: true,
      });
      await writeFile(
        path.join(directory, "package.json"),
        '{"type":"module"}',
      );
      // Prevent Bun from auto-installing the optional peer in this fixture.
      await mkdir(path.join(directory, "node_modules"));
      await expect(
        execFileAsync(
          process.execPath,
          ["testing/telemetry-optional.testsuite.js"],
          { cwd: directory, timeout: 15_000 },
        ),
      ).resolves.toHaveProperty("stdout", "");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }, 20_000);
});
