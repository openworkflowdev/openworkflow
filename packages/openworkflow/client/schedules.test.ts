import { defineWorkflowSpec } from "../core/workflow-definition.js";
import { BackendSqlite } from "../sqlite/backend.js";
import { OpenWorkflow } from "./client.js";
import { afterEach, describe, expect, test, vi } from "vitest";
import { z } from "zod";

describe("schedule client and startup declarations", () => {
  const backends: BackendSqlite[] = [];
  function setup() {
    const backend = BackendSqlite.connect(":memory:");
    backends.push(backend);
    return { backend, ow: new OpenWorkflow({ backend }) };
  }
  afterEach(async () => {
    for (const backend of backends.splice(0)) await backend.stop();
  });

  test("validates and transforms once, and both client entry points replace the declaration", async () => {
    const { backend, ow } = setup();
    let validations = 0;
    const schema = z.object({ count: z.string() }).transform(({ count }) => {
      validations++;
      return { count: Number(count) };
    });
    const spec = defineWorkflowSpec({ name: "transform", schema });
    const scheduled = await ow.scheduleWorkflow(
      spec,
      { count: "12" },
      { cron: "* * * * *" },
    );
    expect(scheduled.input).toEqual({ count: 12 });
    expect(validations).toBe(1);
    await backend.enqueueScheduledRuns({
      before: new Date(Date.now() + 86_400_000),
      limit: 100,
    });
    const runPage = await backend.listWorkflowRuns({});
    expect(runPage.data[0]?.input).toEqual({
      count: 12,
    });
    expect(validations).toBe(1);
    const runnable = ow.defineWorkflow<
      z.output<typeof schema>,
      unknown,
      typeof schema
    >(spec, ({ input }) => input);
    const updated = await runnable.schedule(
      { count: "13" },
      { cron: "* * * * *" },
    );
    expect(updated.id).toBe(scheduled.id);
    expect(updated.input).toEqual({ count: 13 });
    await expect(
      ow.scheduleWorkflow(
        spec,
        // @ts-expect-error The public API also validates inputs from JavaScript.
        { count: 12 },
        { cron: "* * * * *" },
      ),
    ).rejects.toThrow();
  });

  test("worker startup registers declarations with the last ID winning and preserves pauses on restart", async () => {
    const { ow } = setup();
    ow.defineWorkflow<{ account: string }, void>(
      {
        name: "first",
        schedules: [
          { id: "shared", cron: "0 8 * * *", input: { account: "first" } },
        ],
      },
      () => {
        /* No operation is needed by this fixture. */
      },
    );
    ow.defineWorkflow<{ account: string }, void>(
      {
        name: "last",
        schedules: [
          { id: "shared", cron: "0 9 * * *", input: { account: "old" } },
          { id: "shared", cron: "0 10 * * *", input: { account: "last" } },
          { cron: "0 11 * * *", input: { account: "default-id" } },
        ],
      },
      () => {
        /* No operation is needed by this fixture. */
      },
    );
    const worker = ow.newWorker();
    try {
      await worker.start();
      expect(await ow.schedules.get("shared")).toMatchObject({
        workflowName: "last",
        input: { account: "last" },
      });
      expect(await ow.schedules.get("last")).toMatchObject({
        input: { account: "default-id" },
      });
      await ow.schedules.pause("shared");
      await worker.stop();
      await worker.start();
      expect(await ow.schedules.get("shared")).toMatchObject({
        nextRunAt: null,
      });
    } finally {
      await worker.stop();
    }
  });

  test("scheduled runs execute and retain their schedule ID after retries and deletion", async () => {
    const { backend, ow } = setup();
    let attempts = 0;
    ow.defineWorkflow(
      {
        name: "metadata",
        retryPolicy: { maximumAttempts: 2, initialInterval: "1ms" },
      },
      () => {
        if (++attempts === 1) throw new Error("retry once");
        return "done";
      },
    );
    await ow.scheduleWorkflow(
      defineWorkflowSpec({ name: "metadata" }),
      undefined,
      { cron: "* * * * * *" },
    );
    backend["db"]
      .prepare("UPDATE workflow_schedules SET next_run_at=?")
      .run(new Date(Date.now() - 5000).toISOString());
    await backend.enqueueScheduledRuns({ before: new Date(), limit: 100 });
    const runPage = await backend.listWorkflowRuns({});
    const [run] = runPage.data;
    expect(run).toBeDefined();
    await ow.schedules.delete("metadata");
    const worker = ow.newWorker();
    await vi.waitFor(async () => {
      await worker.tick();
      const updatedRun = await backend.getWorkflowRun({
        workflowRunId: run?.id ?? "",
      });
      expect(updatedRun).toMatchObject({
        status: "completed",
        workflowScheduleId: "metadata",
        output: "done",
      });
    });
    expect(attempts).toBe(2);
  });
});
