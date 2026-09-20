import { isTerminalStatus } from "../core/workflow-run.js";
import { BackendPostgres } from "../postgres/backend.js";
import { createTestBackend } from "../postgres/test-backend.testsuite.js";
import { BackendSqlite } from "../sqlite/backend.js";
import { OpenWorkflow } from "./client.js";
import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

describe.each(["sqlite", "postgres"])("reruns (%s)", (database) => {
  let backend: BackendSqlite | BackendPostgres;
  let client: OpenWorkflow;
  beforeEach(async () => {
    backend =
      database === "sqlite"
        ? BackendSqlite.connect(":memory:")
        : await createTestBackend();
    client = new OpenWorkflow({ backend });
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    if (database === "sqlite") await backend.stop();
  });

  async function finish(workflowRunId: string) {
    const worker = client.newWorker();
    for (let tick = 0; tick < 100; tick++) {
      await worker.tick();
      const run = await backend.getWorkflowRun({ workflowRunId });
      if (run && isTerminalStatus(run.status)) return run;
      await new Promise((resolve) => {
        setTimeout(resolve, 5);
      });
    }
    throw new Error("Run did not finish");
  }

  async function history(workflowRunId: string) {
    const result = await backend.listStepAttempts({
      workflowRunId,
      limit: 1000,
    });
    return result.data;
  }

  test("copies successful results before execution, preserves the source, and gives fresh retries", async () => {
    const calls = { read: 0, write: 0 };
    let broken = true;
    const workflow = client.defineWorkflow<{ value: number }, number>(
      { name: "recover", version: "v1" },
      async ({ step, input }) => {
        const value = await step.run({ name: "read" }, async () => {
          calls.read++;
          await new Promise((resolve) => {
            setTimeout(resolve, 2);
          });
          return input.value;
        });
        return await step.run(
          {
            name: "write",
            retryPolicy: { maximumAttempts: 2, initialInterval: "1ms" },
          },
          () => {
            calls.write++;
            if (broken) throw new Error("offline");
            return value;
          },
        );
      },
    );
    const original = await workflow.run(
      { value: 42 },
      { idempotencyKey: "request" },
    );
    const source = await finish(original.workflowRun.id);
    expect(source.status).toBe("failed");
    const sourceHistory = await history(source.id);
    const rerun = await client.rerunWorkflowRun(source.id, {
      fromStep: "write",
    });
    expect(rerun).toMatchObject({
      input: { value: 42 },
      version: "v1",
      status: "pending",
      attempts: 0,
      error: null,
      context: null,
      idempotencyKey: null,
      deadlineAt: null,
      parentStepAttemptNamespaceId: null,
      parentStepAttemptId: null,
    });
    const copied = await history(rerun.id);
    expect(copied).toHaveLength(1);
    expect(copied[0]).toEqual({
      ...sourceHistory[0],
      id: copied[0]?.id,
      workflowRunId: rerun.id,
    });
    expect(copied[0]?.id).not.toBe(sourceHistory[0]?.id);
    await expect(finish(rerun.id)).resolves.toMatchObject({ status: "failed" });
    expect(calls).toEqual({ read: 1, write: 4 });

    broken = false;
    const recovered = await client.rerunWorkflowRun(rerun.id, {
      fromStep: "write",
    });
    await expect(finish(recovered.id)).resolves.toMatchObject({ output: 42 });
    expect(calls).toEqual({ read: 1, write: 5 });
    const fresh = await client.rerunWorkflowRun(recovered.id);
    expect(await history(fresh.id)).toEqual([]);
    await expect(finish(fresh.id)).resolves.toMatchObject({ output: 42 });
    expect(calls).toEqual({ read: 2, write: 6 });
    expect(await backend.getWorkflowRun({ workflowRunId: source.id })).toEqual(
      source,
    );
    expect(await history(source.id)).toEqual(sourceHistory);
  });

  test("copies only successful attempts before the target's first attempt in timestamp and ID order", async () => {
    const source = await backend.createWorkflowRun({
      workflowName: "snapshot",
      version: null,
      input: null,
      config: {},
      context: null,
      idempotencyKey: null,
      parentStepAttemptNamespaceId: null,
      parentStepAttemptId: null,
      availableAt: null,
      deadlineAt: null,
    });
    const workerId = "seed";
    await backend.claimWorkflowRun({ workerId, leaseDurationMs: 60_000 });
    async function attempt(
      stepName: string,
      status: "completed" | "failed" | "running",
    ) {
      const step = await backend.createStepAttempt({
        workflowRunId: source.id,
        workerId,
        stepName,
        kind: "function",
        config: {},
        context: null,
      });
      if (status === "completed")
        await backend.completeStepAttempt({
          workflowRunId: source.id,
          workerId,
          stepAttemptId: step.id,
          output: stepName,
        });
      if (status === "failed")
        await backend.failStepAttempt({
          workflowRunId: source.id,
          workerId,
          stepAttemptId: step.id,
          error: { message: "failed" },
        });
      return step;
    }
    const failed = await attempt("caught", "failed");
    const running = await attempt("unfinished", "running");
    const first = await attempt("first", "completed");
    const second = await attempt("second", "completed");
    const third = await attempt("third", "completed");
    const target = await attempt("target", "failed");
    await attempt("later", "completed");
    await attempt("target", "completed");
    // Fix timestamps to exercise the ID tie-breaker on both databases.
    const early = new Date("2026-01-01T00:00:00Z");
    const late = new Date("2026-01-02T00:00:00Z");
    if (backend instanceof BackendSqlite) {
      backend["db"]
        .prepare(
          'UPDATE "step_attempts" SET "created_at" = ? WHERE "workflow_run_id" = ?',
        )
        .run(late.toISOString(), source.id);
      for (const id of [
        failed.id,
        running.id,
        first.id,
        second.id,
        third.id,
        target.id,
      ]) {
        backend["db"]
          .prepare('UPDATE "step_attempts" SET "created_at" = ? WHERE "id" = ?')
          .run(early.toISOString(), id);
      }
      backend["db"]
        .prepare(
          'UPDATE "step_attempts" SET "created_at" = ?, "status" = \'succeeded\' WHERE "id" = ?',
        )
        .run(new Date(early.getTime() - 1).toISOString(), first.id);
      backend["db"]
        .prepare('UPDATE "step_attempts" SET "created_at" = ? WHERE "id" = ?')
        .run(new Date(early.getTime() + 1).toISOString(), target.id);
    } else {
      const pg = backend["pg"];
      const table = backend["stepAttemptsTable"]();
      await pg`UPDATE ${table} SET "created_at" = ${late} WHERE "workflow_run_id" = ${source.id}`;
      await pg`UPDATE ${table} SET "created_at" = ${early} WHERE "id" IN ${pg([failed.id, running.id, first.id, second.id, third.id])}`;
      await pg`UPDATE ${table} SET "created_at" = ${new Date(early.getTime() - 1)}, "status" = 'succeeded' WHERE "id" = ${first.id}`;
      await pg`UPDATE ${table} SET "created_at" = ${new Date(early.getTime() + 1)} WHERE "id" = ${target.id}`;
    }
    await backend.cancelWorkflowRun({ workflowRunId: source.id });
    const sourceHistory = await history(source.id);
    const saved = sourceHistory.filter(
      (step) =>
        step.id === first.id || step.id === second.id || step.id === third.id,
    );
    const rerun = await client.rerunWorkflowRun(source.id, {
      fromStep: "target",
    });
    const copies = await history(rerun.id);
    expect(copies.map((step) => step.stepName).toSorted()).toEqual(
      saved.map((step) => step.stepName).toSorted(),
    );
    for (const step of copies) {
      const original = saved.find((entry) => entry.stepName === step.stepName);
      assert.ok(original);
      expect(step.id).not.toBe(original.id);
      expect(step.id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
      );
      expect(step).toEqual({
        ...original,
        id: step.id,
        workflowRunId: rerun.id,
      });
    }
    await client.cancelWorkflowRun(rerun.id);
    const selected = copies[2];
    assert.ok(selected);
    const chained = await client.rerunWorkflowRun(rerun.id, {
      fromStep: selected.stepName,
    });
    const chainedHistory = await history(chained.id);
    expect(chainedHistory.map((step) => step.stepName).toSorted()).toEqual(
      copies
        .slice(0, 2)
        .map((step) => step.stepName)
        .toSorted(),
    );
  });

  test("runs caught failures again before the selected step", async () => {
    let failures = 0;
    const workflow = client.defineWorkflow(
      { name: "caught" },
      async ({ step }) => {
        await step
          .run({ name: "error", retryPolicy: { maximumAttempts: 1 } }, () => {
            failures++;
            throw new Error("caught");
          })
          .catch(() => null);
        return await step.run({ name: "target" }, () => "ok");
      },
    );
    const source = await workflow.run();
    await finish(source.workflowRun.id);
    const rerun = await client.rerunWorkflowRun(source.workflowRun.id, {
      fromStep: "target",
    });
    expect(await history(rerun.id)).toEqual([]);
    await expect(finish(rerun.id)).resolves.toMatchObject({ output: "ok" });
    expect(failures).toBe(2);
  });

  test("replays saved signal results without deliveries or the source run", async () => {
    const workflow = client.defineWorkflow(
      { name: "signal" },
      async ({ step }) => {
        const result = await step.waitForSignal<{ value: number }>({
          signal: "reply",
        });
        await new Promise((resolve) => {
          setTimeout(resolve, 2);
        });
        return await step.run({ name: "target" }, () => result);
      },
    );
    const original = await workflow.run();
    await client.newWorker().tick();
    await client.sendSignal({
      signal: "reply",
      data: { value: 42 },
      idempotencyKey: "delivery",
    });
    await finish(original.workflowRun.id);
    const rerun = await client.rerunWorkflowRun(original.workflowRun.id, {
      fromStep: "target",
    });
    const copied = await history(rerun.id);
    expect(copied).toHaveLength(1);
    const savedWait = copied[0];
    assert.ok(savedWait);
    await expect(
      backend.getSignalDelivery({ stepAttemptId: savedWait.id }),
    ).resolves.toBeUndefined();
    if (backend instanceof BackendSqlite) {
      backend["db"]
        .prepare('DELETE FROM "workflow_signals" WHERE "workflow_run_id" = ?')
        .run(original.workflowRun.id);
      backend["db"]
        .prepare('DELETE FROM "workflow_runs" WHERE "id" = ?')
        .run(original.workflowRun.id);
    } else {
      const pg = backend["pg"];
      await pg`DELETE FROM ${backend["workflowSignalsTable"]()} WHERE "workflow_run_id" = ${original.workflowRun.id}`;
      await pg`DELETE FROM ${backend["workflowRunsTable"]()} WHERE "id" = ${original.workflowRun.id}`;
    }
    const deliveries = vi.spyOn(backend, "getSignalDelivery");
    await expect(finish(rerun.id)).resolves.toMatchObject({
      status: "completed",
      output: { data: { value: 42 } },
    });
    expect(deliveries).not.toHaveBeenCalled();
  });

  test("rolls back if rerun creation fails after inserting the new run", async () => {
    const workflow = client.defineWorkflow(
      { name: "atomic" },
      async ({ step }) => {
        await step.run({ name: "prefix" }, async () => {
          await new Promise((resolve) => {
            setTimeout(resolve, 2);
          });
          return "saved";
        });
        await step.run({ name: "target" }, () => null);
      },
    );
    const original = await workflow.run();
    await finish(original.workflowRun.id);
    const before = await backend.listWorkflowRuns({});
    let restore: () => void;
    if (backend instanceof BackendSqlite) {
      const sqlite = backend;
      const insert = sqlite["insertWorkflowRun"];
      sqlite["insertWorkflowRun"] = (params) => {
        insert.call(sqlite, params);
        throw new Error("copy failed");
      };
      restore = () => {
        sqlite["insertWorkflowRun"] = insert;
      };
    } else {
      const postgres = backend;
      const insert = postgres["insertWorkflowRun"];
      postgres["insertWorkflowRun"] = async (tx, params) => {
        await insert.call(postgres, tx, params);
        throw new Error("copy failed");
      };
      restore = () => {
        postgres["insertWorkflowRun"] = insert;
      };
    }
    try {
      await expect(
        client.rerunWorkflowRun(original.workflowRun.id, {
          fromStep: "target",
        }),
      ).rejects.toThrow("copy failed");
    } finally {
      restore();
    }
    expect(await backend.listWorkflowRuns({})).toEqual(before);
    const rerun = await client.rerunWorkflowRun(original.workflowRun.id, {
      fromStep: "target",
    });
    expect(await history(rerun.id)).toHaveLength(1);
  });

  test("starts fresh children at the restart point and reuses completed children before it", async () => {
    let childCalls = 0;
    let broken = true;
    client.defineWorkflow({ name: "child" }, async ({ step }) => {
      await step.run({ name: "earlier-child-work" }, () => ++childCalls);
      return await step.run(
        { name: "child-failure", retryPolicy: { maximumAttempts: 1 } },
        () => {
          if (broken) throw new Error("child failed");
          return "child result";
        },
      );
    });
    const parent = client.defineWorkflow(
      { name: "parent" },
      async ({ step }) => {
        const result = await step.runWorkflow({ name: "child" });
        return await step.run({ name: "after-child" }, () => result);
      },
    );
    const original = await parent.run();
    const failed = await finish(original.workflowRun.id);
    expect(failed.status).toBe("failed");
    broken = false;
    const rerun = await client.rerunWorkflowRun(failed.id, {
      fromStep: "child",
    });
    await expect(finish(rerun.id)).resolves.toMatchObject({
      output: "child result",
    });
    expect(childCalls).toBe(2);
    const priorSteps = await backend.listStepAttempts({
      workflowRunId: rerun.id,
    });
    const later = await client.rerunWorkflowRun(rerun.id, {
      fromStep: "after-child",
    });
    await expect(finish(later.id)).resolves.toMatchObject({
      output: "child result",
    });
    expect(childCalls).toBe(2);
    const laterSteps = await backend.listStepAttempts({
      workflowRunId: later.id,
    });
    expect(
      laterSteps.data.find((step) => step.kind === "workflow")
        ?.childWorkflowRunId,
    ).toBe(
      priorSteps.data.find((step) => step.kind === "workflow")
        ?.childWorkflowRunId,
    );
    expect(await backend.getWorkflowRun({ workflowRunId: failed.id })).toEqual(
      failed,
    );
  });

  test("reuses waits and signal sends before the boundary and restarts them at the boundary", async () => {
    const send = vi.spyOn(backend, "sendSignal");
    const workflow = client.defineWorkflow(
      { name: "waits" },
      async ({ step }) => {
        await step.sendSignal({ signal: "notice" });
        await step.sleep("sleep", "1ms");
        const value = await step.waitForSignal({ signal: "reply", timeout: 0 });
        return await step.run({ name: "last" }, () => value);
      },
    );
    const original = await workflow.run();
    await expect(finish(original.workflowRun.id)).resolves.toMatchObject({
      status: "completed",
    });
    const rerun = await client.rerunWorkflowRun(original.workflowRun.id, {
      fromStep: "last",
    });
    await expect(finish(rerun.id)).resolves.toMatchObject({ output: null });
    expect(send).toHaveBeenCalledTimes(1);
    const again = await client.rerunWorkflowRun(rerun.id, {
      fromStep: "notice",
    });
    await expect(finish(again.id)).resolves.toMatchObject({
      status: "completed",
    });
    expect(send).toHaveBeenCalledTimes(2);
  });

  test("rejects active runs, unknown runs and unknown steps, but accepts canceled runs", async () => {
    const workflow = client.defineWorkflow({ name: "canceled" }, ({ step }) =>
      step.sleep("wait", "1h"),
    );
    const original = await workflow.run();
    await expect(
      client.rerunWorkflowRun(original.workflowRun.id),
    ).rejects.toThrow("Only finished");
    await client.newWorker().tick();
    await expect(
      client.rerunWorkflowRun(original.workflowRun.id),
    ).rejects.toThrow("Only finished");
    await client.cancelWorkflowRun(original.workflowRun.id);
    await expect(
      client.rerunWorkflowRun(original.workflowRun.id, { fromStep: "missing" }),
    ).rejects.toThrow("does not exist");
    await expect(client.rerunWorkflowRun("missing")).rejects.toThrow(
      "does not exist",
    );
    const rerun = await client.rerunWorkflowRun(original.workflowRun.id, {
      fromStep: "wait",
    });
    expect(rerun.status).toBe("pending");
  });
});
