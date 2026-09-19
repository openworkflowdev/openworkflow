import { execFile } from "node:child_process";
import { cp, mkdtemp, rm, writeFile } from "node:fs/promises";
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
      await expect(
        execFileAsync(
          process.execPath,
          [
            "--input-type=module",
            "--eval",
            `
    import assert from "node:assert/strict";
    import { OpenWorkflow } from "./index.js";
    import { BackendSqlite } from "./sqlite.js";
    import { getOtelApi, SPAN_NAMES, traceOperation } from "./telemetry.js";
    const backend = BackendSqlite.connect(":memory:");
    const ow = new OpenWorkflow({ backend });
    let calls = 0;
    const callback = () => { calls++; return 42; };
    const workflow = ow.defineWorkflow(
      { name: "no-otel" },
      async ({ step }) => {
        const value = await step.run({ name: "work" }, callback);
        await step.sleep("pause", "0ms");
        await step.sendSignal({ signal: "unmatched" });
        await step.waitForSignal({ signal: "approval", timeout: "0ms" });
        return value;
      },
    );
    const worker = ow.newWorker();
    try {
      assert.equal(await getOtelApi(), undefined);
      const canceled = await workflow.run();
      await canceled.cancel();
      await assert.rejects(canceled.result(), /was canceled/);
      const handle = await workflow.run();
      assert.equal(handle.workflowRun.context, null);
      await worker.start();
      assert.equal(await handle.result({ timeoutMs: 10_000 }), 42);
      assert.equal(calls, 1);
      assert.deepEqual(await ow.sendSignal({ signal: "unmatched" }), {
        workflowRunIds: [],
      });

      const error = new Error("original failure");
      let failures = 0;
      const failure = () => { failures++; return Promise.reject(error); };
      await assert.rejects(
        traceOperation(SPAN_NAMES.STEP_ATTEMPT_EXECUTE, {}, failure),
        caught => caught === error,
      );
      assert.equal(failures, 1);
    } finally {
      await worker.stop();
      await backend.stop();
    }
    `,
          ],
          { cwd: directory, timeout: 15_000 },
        ),
      ).resolves.toHaveProperty("stdout", "");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }, 20_000);
});
