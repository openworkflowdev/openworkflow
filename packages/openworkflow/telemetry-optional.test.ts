import { OpenWorkflow } from "./client/client.js";
import { BackendSqlite } from "./sqlite/backend.js";
import { getOtelApi, SPAN_NAMES, traceOperation } from "./telemetry.js";
import { describe, expect, test, vi } from "vitest";

vi.mock(import("@opentelemetry/api"), () => {
  throw new Error("Cannot find package '@opentelemetry/api'");
});

describe("optional OpenTelemetry API", () => {
  test("runs workflows, waits, and signals without the optional API", async () => {
    const backend = BackendSqlite.connect(":memory:");
    const ow = new OpenWorkflow({ backend });
    const callback = vi.fn(() => 42);
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
      expect(await getOtelApi()).toBeUndefined();
      const canceled = await workflow.run();
      await canceled.cancel();
      await expect(canceled.result()).rejects.toThrow("was canceled");
      const handle = await workflow.run();
      expect(handle.workflowRun.context).toBeNull();
      await worker.start();
      expect(await handle.result({ timeoutMs: 10_000 })).toBe(42);
      expect(callback).toHaveBeenCalledTimes(1);
      expect(await ow.sendSignal({ signal: "unmatched" })).toEqual({
        workflowRunIds: [],
      });

      const error = new Error("original failure");
      const failure = vi.fn<() => Promise<never>>().mockRejectedValue(error);
      await expect(
        traceOperation(SPAN_NAMES.STEP_ATTEMPT_EXECUTE, {}, failure),
      ).rejects.toBe(error);
      expect(failure).toHaveBeenCalledTimes(1);
    } finally {
      await worker.stop();
      await backend.stop();
    }
  });
});
