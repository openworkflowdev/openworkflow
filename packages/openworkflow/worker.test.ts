import { BackendPostgres } from "../backend-postgres/backend.js";
import { DEFAULT_DATABASE_URL } from "../backend-postgres/postgres.js";
import { OpenWorkflow } from "./client.js";
import { randomUUID } from "node:crypto";
import { describe, expect, test } from "vitest";

describe("Worker", () => {
  test("passes workflow input to handlers (known slow test)", async () => {
    const backend = await createBackend();
    const client = new OpenWorkflow({ backend });

    const workflow = client.defineWorkflow(
      { name: "context" },
      ({ input }) => input,
    );
    const worker = client.newWorker();

    const payload = { value: 10 };
    const handle = await workflow.run(payload);
    await worker.tick();

    const result = await handle.result();
    expect(result).toEqual(payload);
  });

  test("processes workflow runs to completion (known slow test)", async () => {
    const backend = await createBackend();
    const client = new OpenWorkflow({ backend });

    const workflow = client.defineWorkflow(
      { name: "process" },
      ({ input }: { input: { value: number } }) => input.value * 2,
    );
    const worker = client.newWorker();

    const handle = await workflow.run({ value: 21 });
    await worker.tick();

    const result = await handle.result();
    expect(result).toBe(42);
  });

  test("step.run reuses cached results (known slow test)", async () => {
    const backend = await createBackend();
    const client = new OpenWorkflow({ backend });

    let executionCount = 0;
    const workflow = client.defineWorkflow(
      { name: "cached-step" },
      async ({ step }) => {
        const first = await step.run({ name: "once" }, () => {
          executionCount++;
          return "value";
        });
        const second = await step.run({ name: "once" }, () => {
          executionCount++;
          return "should-not-run";
        });
        return { first, second };
      },
    );

    const worker = client.newWorker();

    const handle = await workflow.run();
    await worker.tick();

    const result = await handle.result();
    expect(result).toEqual({ first: "value", second: "value" });
    expect(executionCount).toBe(1);
  });

  test("marks workflow for retry when definition is missing", async () => {
    const backend = await createBackend();
    const client = new OpenWorkflow({ backend });

    const workflowRun = await backend.createWorkflowRun({
      workflowName: "missing",
      version: null,
      idempotencyKey: null,
      config: {},
      context: null,
      input: null,
      availableAt: null,
      deadlineAt: null,
    });

    const worker = client.newWorker();
    await worker.tick();

    const updated = await backend.getWorkflowRun({
      workflowRunId: workflowRun.id,
    });

    expect(updated?.status).toBe("pending");
    expect(updated?.error).toBeDefined();
    expect(updated?.availableAt).not.toBeNull();
  });

  test("retries failed workflows automatically (known slow test)", async () => {
    const backend = await createBackend();
    const client = new OpenWorkflow({ backend });

    let attemptCount = 0;

    const workflow = client.defineWorkflow({ name: "retry-test" }, () => {
      attemptCount++;
      if (attemptCount < 2) {
        throw new Error(`Attempt ${String(attemptCount)} failed`);
      }
      return { success: true, attempts: attemptCount };
    });

    const worker = client.newWorker();

    // run the workflow
    const handle = await workflow.run();

    // first attempt - will fail and reschedule
    await worker.tick();
    await sleep(100); // wait for worker to finish
    expect(attemptCount).toBe(1);

    await sleep(1100); // wait for backoff delay

    // second attempt - will succeed
    await worker.tick();
    await sleep(100); // wait for worker to finish
    expect(attemptCount).toBe(2);

    const result = await handle.result();
    expect(result).toEqual({ success: true, attempts: 2 });
  });

  test("tick is a no-op when no work is available", async () => {
    const backend = await createBackend();
    const client = new OpenWorkflow({ backend });

    client.defineWorkflow({ name: "noop" }, () => null);
    const worker = client.newWorker();
    await worker.tick(); // no runs queued
  });

  test("handles step functions that return undefined (known slow test)", async () => {
    const backend = await createBackend();
    const client = new OpenWorkflow({ backend });

    const workflow = client.defineWorkflow(
      { name: "undefined-steps" },
      async ({ step }) => {
        await step.run({ name: "step-1" }, () => {
          return; // explicit undefined
        });
        await step.run({ name: "step-2" }, () => {
          // implicit undefined
        });
        return { success: true };
      },
    );

    const worker = client.newWorker();

    const handle = await workflow.run();
    await worker.tick();

    const result = await handle.result();
    expect(result).toEqual({ success: true });
  });

  test("executes steps synchronously within workflow (known slow test)", async () => {
    const backend = await createBackend();
    const client = new OpenWorkflow({ backend });

    const executionOrder: string[] = [];
    const workflow = client.defineWorkflow(
      { name: "sync-steps" },
      async ({ step }) => {
        executionOrder.push("start");
        await step.run({ name: "step1" }, () => {
          executionOrder.push("step1");
          return 1;
        });
        executionOrder.push("between");
        await step.run({ name: "step2" }, () => {
          executionOrder.push("step2");
          return 2;
        });
        executionOrder.push("end");
        return executionOrder;
      },
    );

    const worker = client.newWorker();

    const handle = await workflow.run();
    await worker.tick();

    const result = await handle.result();
    expect(result).toEqual(["start", "step1", "between", "step2", "end"]);
  });

  test("executes parallel steps with Promise.all (known slow test)", async () => {
    const backend = await createBackend();
    const client = new OpenWorkflow({ backend });

    const executionTimes: Record<string, number> = {};
    const workflow = client.defineWorkflow(
      { name: "parallel" },
      async ({ step }) => {
        const start = Date.now();
        const [a, b, c] = await Promise.all([
          step.run({ name: "step-a" }, () => {
            executionTimes["step-a"] = Date.now() - start;
            return "a";
          }),
          step.run({ name: "step-b" }, () => {
            executionTimes["step-b"] = Date.now() - start;
            return "b";
          }),
          step.run({ name: "step-c" }, () => {
            executionTimes["step-c"] = Date.now() - start;
            return "c";
          }),
        ]);
        return { a, b, c };
      },
    );

    const worker = client.newWorker();

    const handle = await workflow.run();
    await worker.tick();

    const result = await handle.result();
    expect(result).toEqual({ a: "a", b: "b", c: "c" });

    // steps should execute at roughly the same time (within 100ms)
    const times = Object.values(executionTimes);
    const maxTime = Math.max(...times);
    const minTime = Math.min(...times);
    expect(maxTime - minTime).toBeLessThan(100);
  });

  test("respects worker concurrency limit", async () => {
    const backend = await createBackend();
    const client = new OpenWorkflow({ backend });

    const workflow = client.defineWorkflow({ name: "concurrency-test" }, () => {
      return "done";
    });

    const worker = client.newWorker({ concurrency: 2 });

    // create 5 workflow runs, though only 2 (concurrency limit) should be
    // completed per tick
    const handles = await Promise.all([
      workflow.run(),
      workflow.run(),
      workflow.run(),
      workflow.run(),
      workflow.run(),
    ]);

    await worker.tick();
    await sleep(100);

    let completed = 0;
    for (const handle of handles) {
      const run = await backend.getWorkflowRun({
        workflowRunId: handle.workflowRun.id,
      });
      if (run?.status === "succeeded") completed++;
    }

    expect(completed).toBe(2);
  });

  test("worker starts, processes work, and stops gracefully (known slow test)", async () => {
    const backend = await createBackend();
    const client = new OpenWorkflow({ backend });

    const workflow = client.defineWorkflow({ name: "lifecycle" }, () => {
      return "complete";
    });

    const worker = client.newWorker();

    await worker.start();
    const handle = await workflow.run();
    await sleep(200);
    await worker.stop();

    const result = await handle.result();
    expect(result).toBe("complete");
  });

  test("recovers from crashes during parallel step execution (known slow test)", async () => {
    const backend = await createBackend();
    const client = new OpenWorkflow({ backend });

    let attemptCount = 0;

    const workflow = client.defineWorkflow(
      { name: "crash-recovery" },
      async ({ step }) => {
        attemptCount++;

        const [a, b] = await Promise.all([
          step.run({ name: "step-a" }, () => {
            if (attemptCount > 1) return "x"; // should not happen since "a" will be cached
            return "a";
          }),
          step.run({ name: "step-b" }, () => {
            if (attemptCount === 1) throw new Error("Simulated crash");
            return "b";
          }),
        ]);

        return { a, b, attempts: attemptCount };
      },
    );

    const worker = client.newWorker();

    const handle = await workflow.run();

    // first attempt will fail
    await worker.tick();
    await sleep(100);
    expect(attemptCount).toBe(1);

    // wait for backoff
    await sleep(1100);

    // second attempt should succeed
    await worker.tick();
    await sleep(100);

    const result = await handle.result();
    expect(result).toEqual({ a: "a", b: "b", attempts: 2 });
    expect(attemptCount).toBe(2);
  });

  test("reclaims workflow run when heartbeat stops (known slow test)", async () => {
    const backend = await createBackend();
    const client = new OpenWorkflow({ backend });

    const workflow = client.defineWorkflow(
      { name: "heartbeat-test" },
      () => "done",
    );

    const handle = await workflow.run();
    const workerId = randomUUID();

    const claimed = await backend.claimWorkflowRun({
      workerId,
      leaseDurationMs: 50,
    });
    expect(claimed).not.toBeNull();

    // let lease expire before starting worker
    await sleep(100);

    // worker should be able to reclaim
    const worker = client.newWorker();
    await worker.tick();

    const result = await handle.result();
    expect(result).toBe("done");
  });

  test("tick() returns count of claimed workflows", async () => {
    const backend = await createBackend();
    const client = new OpenWorkflow({ backend });

    const workflow = client.defineWorkflow(
      { name: "count-test" },
      () => "result",
    );

    // enqueue 3 workflows
    await workflow.run();
    await workflow.run();
    await workflow.run();

    const worker = client.newWorker({ concurrency: 5 });

    // first tick should claim 3 workflows (all available)
    const claimed = await worker.tick();
    expect(claimed).toBe(3);

    // second tick should claim 0 (all already claimed)
    const claimedAgain = await worker.tick();
    expect(claimedAgain).toBe(0);

    await worker.stop();
  });

  test("tick() respects concurrency limit", async () => {
    const backend = await createBackend();
    const client = new OpenWorkflow({ backend });

    const workflow = client.defineWorkflow(
      { name: "concurrency-test" },
      async () => {
        await sleep(100);
        return "done";
      },
    );

    // enqueue 10 workflows
    for (let i = 0; i < 10; i++) {
      await workflow.run();
    }

    const worker = client.newWorker({ concurrency: 3 });

    // first tick should claim exactly 3 (concurrency limit)
    const claimed = await worker.tick();
    expect(claimed).toBe(3);

    // second tick should claim 0 (all slots occupied)
    const claimedAgain = await worker.tick();
    expect(claimedAgain).toBe(0);

    await worker.stop();
  });

  test("worker only sleeps between claims when no work is available (known slow test)", async () => {
    const backend = await createBackend();
    const client = new OpenWorkflow({ backend });

    const workflow = client.defineWorkflow(
      { name: "adaptive-test" },
      async ({ step }) => {
        await step.run({ name: "step-1" }, () => "done");
        return "complete";
      },
    );

    // enqueue many workflows
    const handles = [];
    for (let i = 0; i < 20; i++) {
      handles.push(await workflow.run());
    }

    const worker = client.newWorker({ concurrency: 5 });

    const startTime = Date.now();
    await worker.start();

    // wait for all workflows to complete
    await Promise.all(handles.map((h) => h.result()));
    await worker.stop();

    const duration = Date.now() - startTime;

    // with this conditional sleep, all workflows should complete quickly
    // without it (with 100ms sleep between ticks), it would take much longer
    expect(duration).toBeLessThan(3000); // should complete in under 3 seconds
  });

  test("only failed steps re-execute on retry (known slow test)", async () => {
    const backend = await createBackend();
    const client = new OpenWorkflow({ backend });

    const executionCounts = {
      stepA: 0,
      stepB: 0,
      stepC: 0,
    };

    const workflow = client.defineWorkflow(
      { name: "mixed-retry" },
      async ({ step }) => {
        const a = await step.run({ name: "step-a" }, () => {
          executionCounts.stepA++;
          return "a-result";
        });

        const b = await step.run({ name: "step-b" }, () => {
          executionCounts.stepB++;
          if (executionCounts.stepB === 1) {
            throw new Error("Step B fails on first attempt");
          }
          return "b-result";
        });

        const c = await step.run({ name: "step-c" }, () => {
          executionCounts.stepC++;
          return "c-result";
        });

        return { a, b, c };
      },
    );

    const worker = client.newWorker();
    const handle = await workflow.run();

    // first workflow attempt
    // - step-a succeeds
    // - step-b fails
    // - step-c never runs (workflow fails at step-b)
    await worker.tick();
    await sleep(100);
    expect(executionCounts.stepA).toBe(1);
    expect(executionCounts.stepB).toBe(1);
    expect(executionCounts.stepC).toBe(0);

    // wait for backoff
    await sleep(1100);

    // second workflow attempt
    // - step-a should be cached (not re-executed)
    // - step-b should be re-executed (failed previously)
    // - step-c should execute for first time
    await worker.tick();
    await sleep(100);
    expect(executionCounts.stepA).toBe(1); // still 1, was cached
    expect(executionCounts.stepB).toBe(2); // incremented, was retried
    expect(executionCounts.stepC).toBe(1); // incremented, first execution

    const result = await handle.result();
    expect(result).toEqual({
      a: "a-result",
      b: "b-result",
      c: "c-result",
    });
  });

  test("step.sleep postpones workflow execution (known slow test)", async () => {
    const backend = await createBackend();
    const client = new OpenWorkflow({ backend });

    let stepCount = 0;
    const workflow = client.defineWorkflow(
      { name: "sleep-test" },
      async ({ step }) => {
        const before = await step.run({ name: "before-sleep" }, () => {
          stepCount++;
          return "before";
        });

        await step.sleep("pause", "100ms");

        const after = await step.run({ name: "after-sleep" }, () => {
          stepCount++;
          return "after";
        });

        return { before, after };
      },
    );

    const worker = client.newWorker();
    const handle = await workflow.run();

    // first execution - runs before-sleep, then sleeps
    await worker.tick();
    await sleep(50); // wait for processing
    expect(stepCount).toBe(1);

    // verify workflow was postponed with sleeping status
    const slept = await backend.getWorkflowRun({
      workflowRunId: handle.workflowRun.id,
    });
    expect(slept?.status).toBe("sleeping");
    expect(slept?.workerId).toBeNull(); // released during sleep
    expect(slept?.availableAt).not.toBeNull();
    if (!slept?.availableAt) throw new Error("availableAt should be set");
    const delayMs = slept.availableAt.getTime() - Date.now();
    expect(delayMs).toBeGreaterThan(0);
    expect(delayMs).toBeLessThan(150); // should be ~100ms

    // verify sleep step is in "running" state during sleep
    const attempts = await backend.listStepAttempts({
      workflowRunId: handle.workflowRun.id,
    });
    const sleepStep = attempts.find((a) => a.stepName === "pause");
    expect(sleepStep?.status).toBe("running");

    // wait for sleep duration
    await sleep(150);

    // second execution (after sleep)
    await worker.tick();
    await sleep(50); // wait for processing
    expect(stepCount).toBe(2);

    // verify sleep step is now "succeeded"
    const refreshedAttempts = await backend.listStepAttempts({
      workflowRunId: handle.workflowRun.id,
    });
    const completedSleepStep = refreshedAttempts.find(
      (a) => a.stepName === "pause",
    );
    expect(completedSleepStep?.status).toBe("succeeded");

    const result = await handle.result();
    expect(result).toEqual({ before: "before", after: "after" });
  });

  test("step.sleep is cached on replay", async () => {
    const backend = await createBackend();
    const client = new OpenWorkflow({ backend });

    let step1Count = 0;
    let step2Count = 0;
    const workflow = client.defineWorkflow(
      { name: "sleep-cache-test" },
      async ({ step }) => {
        await step.run({ name: "step-1" }, () => {
          step1Count++;
          return "one";
        });

        // this should only postpone once
        await step.sleep("wait", "50ms");

        await step.run({ name: "step-2" }, () => {
          step2Count++;
          return "two";
        });

        return "done";
      },
    );

    const worker = client.newWorker();
    const handle = await workflow.run();

    // first attempt: execute step-1, then sleep (step-2 not executed)
    await worker.tick();
    await sleep(50);
    expect(step1Count).toBe(1);
    expect(step2Count).toBe(0);

    await sleep(100); // wait for sleep to complete

    // second attempt: step-1 is cached (not re-executed), sleep is cached, step-2 executes
    await worker.tick();
    await sleep(50);
    expect(step1Count).toBe(1); // still 1, was cached
    expect(step2Count).toBe(1); // now 1, executed after sleep

    const result = await handle.result();
    expect(result).toBe("done");
  });

  test("step.sleep throws error for invalid duration format", async () => {
    const backend = await createBackend();
    const client = new OpenWorkflow({ backend });

    const workflow = client.defineWorkflow(
      { name: "invalid-duration" },
      async ({ step }) => {
        await step.sleep("bad", "invalid");
        return "should-not-reach";
      },
    );

    const worker = client.newWorker();
    const handle = await workflow.run();

    await worker.tick();
    await sleep(100);

    const failed = await backend.getWorkflowRun({
      workflowRunId: handle.workflowRun.id,
    });

    expect(failed?.status).toBe("pending"); // should be retrying
    expect(failed?.error).toBeDefined();
    // @ts-expect-error - test suite
    expect(failed?.error?.message).toContain("Invalid duration format");
  });

  test("step.sleep handles multiple sequential sleeps (known slow test)", async () => {
    const backend = await createBackend();
    const client = new OpenWorkflow({ backend });

    let executionCount = 0;
    const workflow = client.defineWorkflow(
      { name: "sequential-sleeps" },
      async ({ step }) => {
        executionCount++;

        await step.run({ name: "step-1" }, () => "one");
        await step.sleep("sleep-1", "50ms");
        await step.run({ name: "step-2" }, () => "two");
        await step.sleep("sleep-2", "50ms");
        await step.run({ name: "step-3" }, () => "three");

        return "done";
      },
    );

    const worker = client.newWorker();
    const handle = await workflow.run();

    // first execution: step-1, then sleep-1
    await worker.tick();
    await sleep(50);
    expect(executionCount).toBe(1);

    // verify first sleep is running
    const attempts1 = await backend.listStepAttempts({
      workflowRunId: handle.workflowRun.id,
    });
    expect(attempts1.find((a) => a.stepName === "sleep-1")?.status).toBe(
      "running",
    );

    // wait for first sleep
    await sleep(100);

    // second execution: sleep-1 succeeded, step-2, then sleep-2
    await worker.tick();
    await sleep(50);
    expect(executionCount).toBe(2);

    // verify second sleep is running
    const attempts2 = await backend.listStepAttempts({
      workflowRunId: handle.workflowRun.id,
    });
    expect(attempts2.find((a) => a.stepName === "sleep-1")?.status).toBe(
      "succeeded",
    );
    expect(attempts2.find((a) => a.stepName === "sleep-2")?.status).toBe(
      "running",
    );

    // wait for second sleep
    await sleep(100);

    // third execution: sleep-2 succeeded, step-3, complete
    await worker.tick();
    await sleep(50);
    expect(executionCount).toBe(3);

    const result = await handle.result();
    expect(result).toBe("done");

    // verify all steps succeeded
    const finalAttempts = await backend.listStepAttempts({
      workflowRunId: handle.workflowRun.id,
    });
    expect(finalAttempts.length).toBe(5); // 3 regular steps + 2 sleeps
    expect(finalAttempts.every((a) => a.status === "succeeded")).toBe(true);
  });

  test("sleeping workflows can be claimed after availableAt", async () => {
    const backend = await createBackend();
    const client = new OpenWorkflow({ backend });

    const workflow = client.defineWorkflow(
      { name: "sleeping-claim-test" },
      async ({ step }) => {
        await step.run({ name: "before" }, () => "before");
        await step.sleep("wait", "100ms");
        await step.run({ name: "after" }, () => "after");
        return "done";
      },
    );

    const worker = client.newWorker();
    const handle = await workflow.run();

    // first execution - sleep
    await worker.tick();
    await sleep(50);

    // verify workflow is in sleeping state
    const sleeping = await backend.getWorkflowRun({
      workflowRunId: handle.workflowRun.id,
    });
    expect(sleeping?.status).toBe("sleeping");
    expect(sleeping?.workerId).toBeNull();

    // wait for sleep duration
    await sleep(100);

    // verify workflow can be claimed again
    const claimed = await backend.claimWorkflowRun({
      workerId: "test-worker",
      leaseDurationMs: 30_000,
    });
    expect(claimed?.id).toBe(handle.workflowRun.id);
    expect(claimed?.status).toBe("running");
    expect(claimed?.workerId).toBe("test-worker");
  });

  test("sleep is not skipped when worker crashes after creating sleep step but before marking workflow as sleeping (known slow test)", async () => {
    const backend = await createBackend();
    const client = new OpenWorkflow({ backend });

    let executionCount = 0;
    let beforeSleepCount = 0;
    let afterSleepCount = 0;

    const workflow = client.defineWorkflow(
      { name: "crash-during-sleep" },
      async ({ step }) => {
        executionCount++;

        await step.run({ name: "before-sleep" }, () => {
          beforeSleepCount++;
          return "before";
        });

        // this sleep should NOT be skipped even if crash happens
        await step.sleep("critical-pause", "200ms");

        await step.run({ name: "after-sleep" }, () => {
          afterSleepCount++;
          return "after";
        });

        return { executionCount, beforeSleepCount, afterSleepCount };
      },
    );

    const handle = await workflow.run();

    // first worker processes the workflow until sleep
    const worker1 = client.newWorker();
    await worker1.tick();
    await sleep(100);

    const workflowAfterFirst = await backend.getWorkflowRun({
      workflowRunId: handle.workflowRun.id,
    });

    expect(workflowAfterFirst?.status).toBe("sleeping");

    const attemptsAfterFirst = await backend.listStepAttempts({
      workflowRunId: handle.workflowRun.id,
    });
    const sleepStep = attemptsAfterFirst.find(
      (a) => a.stepName === "critical-pause",
    );
    expect(sleepStep).toBeDefined();
    expect(sleepStep?.kind).toBe("sleep");
    expect(sleepStep?.status).toBe("running");

    await sleep(50); // only 50ms of the 200ms sleep

    // if there's a running sleep step, the workflow should be properly
    // transitioned to sleeping
    const worker2 = client.newWorker();
    await worker2.tick();

    // after-sleep step should NOT have executed yet
    expect(afterSleepCount).toBe(0);

    // wait for the full sleep duration to elapse then check to make sure
    // workflow is claimable and resume
    await sleep(200);
    await worker2.tick();
    await sleep(100);
    expect(afterSleepCount).toBe(1);
    const result = await handle.result();
    expect(result.afterSleepCount).toBe(1);
  });

  test("version enables conditional code paths (known slow test)", async () => {
    const backend = await createBackend();
    const client = new OpenWorkflow({ backend });

    const workflow = client.defineWorkflow(
      { name: "conditional-workflow", version: "v2" },
      async ({ version, step }) => {
        return version === "v1"
          ? await step.run({ name: "old-step" }, () => "old-logic")
          : await step.run({ name: "new-step" }, () => "new-logic");
      },
    );
    const worker = client.newWorker();

    const handle = await workflow.run();
    await worker.tick();

    const result = await handle.result();
    expect(result).toBe("new-logic");
  });

  test("workflow version is null when not specified", async () => {
    const backend = await createBackend();
    const client = new OpenWorkflow({ backend });

    const workflow = client.defineWorkflow(
      { name: "unversioned-workflow" },
      async ({ version, step }) => {
        const result = await step.run({ name: "check-version" }, () => {
          return { version };
        });
        return result;
      },
    );
    const worker = client.newWorker();

    const handle = await workflow.run();
    await worker.tick();

    const result = await handle.result();
    expect(result.version).toBeNull();
  });

  test("cancels a pending workflow", async () => {
    const backend = await createBackend();
    const client = new OpenWorkflow({ backend });

    const workflow = client.defineWorkflow(
      { name: "cancel-pending" },
      async ({ step }) => {
        await step.run({ name: "step-1" }, () => "result");
        return { completed: true };
      },
    );

    const handle = await workflow.run();

    // cancel before worker processes it
    await handle.cancel();

    const workflowRun = await backend.getWorkflowRun({
      workflowRunId: handle.workflowRun.id,
    });
    expect(workflowRun?.status).toBe("canceled");
    expect(workflowRun?.finishedAt).not.toBeNull();
    expect(workflowRun?.availableAt).toBeNull();
    expect(workflowRun?.workerId).toBeNull();
  });

  test("cancels a sleeping workflow", async () => {
    const backend = await createBackend();
    const client = new OpenWorkflow({ backend });

    const workflow = client.defineWorkflow(
      { name: "cancel-sleeping" },
      async ({ step }) => {
        await step.sleep("sleep-1", "1h");
        return { completed: true };
      },
    );
    const worker = client.newWorker();

    const handle = await workflow.run();
    await worker.tick();

    // cancel while sleeping
    await handle.cancel();

    const canceled = await backend.getWorkflowRun({
      workflowRunId: handle.workflowRun.id,
    });
    expect(canceled?.status).toBe("canceled");
    expect(canceled?.finishedAt).not.toBeNull();
    expect(canceled?.availableAt).toBeNull();
    expect(canceled?.workerId).toBeNull();
  });

  test("cannot cancel a succeeded workflow", async () => {
    const backend = await createBackend();
    const client = new OpenWorkflow({ backend });

    const workflow = client.defineWorkflow(
      { name: "cancel-succeeded" },
      () => ({ completed: true }),
    );
    const worker = client.newWorker();

    const handle = await workflow.run();
    await worker.tick();

    const result = await handle.result();
    expect(result.completed).toBe(true);

    // try to cancel after success
    await expect(handle.cancel()).rejects.toThrow(
      /Cannot cancel workflow run .* with status succeeded/,
    );
  });

  test("cannot cancel a failed workflow", async () => {
    const backend = await createBackend();
    const client = new OpenWorkflow({ backend });

    const workflow = client.defineWorkflow({ name: "cancel-failed" }, () => {
      throw new Error("intentional failure");
    });
    const worker = client.newWorker();

    const handle = await workflow.run({ value: 1 }, { deadlineAt: new Date() });
    await worker.tick();

    // wait for it to fail due to deadline
    await sleep(100);

    const failed = await backend.getWorkflowRun({
      workflowRunId: handle.workflowRun.id,
    });
    expect(failed?.status).toBe("failed");

    // try to cancel after failure
    await expect(handle.cancel()).rejects.toThrow(
      /Cannot cancel workflow run .* with status failed/,
    );
  });

  test("cannot cancel non-existent workflow", async () => {
    const backend = await createBackend();

    await expect(
      backend.cancelWorkflowRun({
        workflowRunId: "non-existent-id",
      }),
    ).rejects.toThrow(/Workflow run non-existent-id does not exist/);
  });

  test("worker handles when canceled workflow during execution", async () => {
    const backend = await createBackend();
    const client = new OpenWorkflow({ backend });

    let stepExecuted = false;
    const workflow = client.defineWorkflow(
      { name: "cancel-during-execution" },
      async ({ step }) => {
        await step.run({ name: "step-1" }, async () => {
          stepExecuted = true;
          // simulate some work
          await sleep(50);
          return "result";
        });
        return { completed: true };
      },
    );
    const worker = client.newWorker();

    const handle = await workflow.run();

    // start processing in the background
    const tickPromise = worker.tick();
    await sleep(25);

    // cancel while step is executing
    await handle.cancel();

    // wait for tick to complete
    await tickPromise;

    // step should have been executed but workflow should be canceled
    expect(stepExecuted).toBe(true);
    const canceled = await backend.getWorkflowRun({
      workflowRunId: handle.workflowRun.id,
    });
    expect(canceled?.status).toBe("canceled");
  });

  test("result() rejects for canceled workflows", async () => {
    const backend = await createBackend();
    const client = new OpenWorkflow({ backend });

    const workflow = client.defineWorkflow(
      { name: "cancel-result" },
      async ({ step }) => {
        await step.sleep("sleep-1", "1h");
        return { completed: true };
      },
    );

    const handle = await workflow.run();
    await handle.cancel();

    await expect(handle.result()).rejects.toThrow(
      /Workflow cancel-result was canceled/,
    );
  });

  test("throws NonDeterministicError when step order changes on replay", async () => {
    const backend = await createBackend();
    const client = new OpenWorkflow({ backend });

    let useAlternateOrder = false;
    const workflow = client.defineWorkflow(
      { name: "non-deterministic-order" },
      async ({ step }) => {
        if (useAlternateOrder) {
          // different order on replay - should fail
          await step.run({ name: "step-2" }, () => "two");
          await step.run({ name: "step-1" }, () => "one");
        } else {
          await step.run({ name: "step-1" }, () => "one");
          // sleep to ensure workflow continues on next tick
          await step.sleep("wait", "50ms");
          await step.run({ name: "step-2" }, () => "two");
        }
        return "done";
      },
    );

    const worker = client.newWorker();
    const handle = await workflow.run();

    // first execution: step-1, then sleep
    await worker.tick();
    await sleep(50);

    // check that step-1 and sleep were recorded
    const attempts = await backend.listStepAttempts({
      workflowRunId: handle.workflowRun.id,
    });
    expect(attempts).toHaveLength(2);
    expect(attempts[0]?.stepName).toBe("step-1");
    expect(attempts[1]?.stepName).toBe("wait");

    // now change order for replay
    useAlternateOrder = true;

    await sleep(100); // wait for sleep to complete

    // replay should detect non-determinism and fail
    await worker.tick();
    await sleep(50);

    const failed = await backend.getWorkflowRun({
      workflowRunId: handle.workflowRun.id,
    });

    expect(failed?.status).toBe("pending"); // should be retrying
    expect(failed?.error).toBeDefined();
    // @ts-expect-error - test suite
    expect(failed?.error?.name).toBe("NonDeterministicError");
    // @ts-expect-error - test suite
    expect(failed?.error?.message).toContain("Step order mismatch");
    // @ts-expect-error - test suite
    expect(failed?.error?.message).toContain('expected step "step-1"');
    // @ts-expect-error - test suite
    expect(failed?.error?.message).toContain('but got "step-2"');
  });

  test("throws NonDeterministicError when step name changes on replay", async () => {
    const backend = await createBackend();
    const client = new OpenWorkflow({ backend });

    let useAlternateName = false;
    const workflow = client.defineWorkflow(
      { name: "non-deterministic-name" },
      async ({ step }) => {
        const name = useAlternateName ? "different-step" : "original-step";
        await step.run({ name }, () => "value");
        // sleep to ensure workflow continues on next tick
        await step.sleep("wait", "50ms");
        return "done";
      },
    );

    const worker = client.newWorker();
    const handle = await workflow.run();

    // first execution with original name
    await worker.tick();
    await sleep(50);

    await sleep(100); // wait for sleep to complete

    // now change name for replay
    useAlternateName = true;

    // replay should detect non-determinism and fail
    await worker.tick();
    await sleep(50);

    const failed = await backend.getWorkflowRun({
      workflowRunId: handle.workflowRun.id,
    });

    expect(failed?.status).toBe("pending"); // should be retrying
    expect(failed?.error).toBeDefined();
    // @ts-expect-error - test suite
    expect(failed?.error?.name).toBe("NonDeterministicError");
    // @ts-expect-error - test suite
    expect(failed?.error?.message).toContain("Step order mismatch");
    // @ts-expect-error - test suite
    expect(failed?.error?.message).toContain('expected step "original-step"');
    // @ts-expect-error - test suite
    expect(failed?.error?.message).toContain('but got "different-step"');
  });

  test("allows adding new steps after replay (deterministic growth)", async () => {
    const backend = await createBackend();
    const client = new OpenWorkflow({ backend });

    let addExtraStep = false;
    const workflow = client.defineWorkflow(
      { name: "deterministic-growth" },
      async ({ step }) => {
        await step.run({ name: "step-1" }, () => "one");
        // sleep to ensure workflow continues on next tick
        await step.sleep("wait", "50ms");
        if (addExtraStep) {
          await step.run({ name: "step-2" }, () => "two");
        }
        return "done";
      },
    );

    const worker = client.newWorker();
    const handle = await workflow.run();

    // first execution: only step-1, then sleep
    await worker.tick();
    await sleep(50);

    // now add extra step for replay
    addExtraStep = true;

    await sleep(100); // wait for sleep to complete

    // replay should complete step-1 from cache, skip sleep, then add step-2
    await worker.tick();
    await sleep(50);

    const result = await handle.result();
    expect(result).toBe("done");

    // verify all steps were recorded
    const attempts = await backend.listStepAttempts({
      workflowRunId: handle.workflowRun.id,
    });
    expect(attempts).toHaveLength(3);
    expect(attempts[0]?.stepName).toBe("step-1");
    expect(attempts[1]?.stepName).toBe("wait");
    expect(attempts[2]?.stepName).toBe("step-2");
  });

  test("throws NonDeterministicError when sleep order changes", async () => {
    const backend = await createBackend();
    const client = new OpenWorkflow({ backend });

    let swapSleeps = false;
    const workflow = client.defineWorkflow(
      { name: "non-deterministic-sleep" },
      async ({ step }) => {
        if (swapSleeps) {
          await step.sleep("sleep-2", "50ms");
          await step.sleep("sleep-1", "50ms");
        } else {
          await step.sleep("sleep-1", "50ms");
          await step.sleep("sleep-2", "50ms");
        }
        return "done";
      },
    );

    const worker = client.newWorker();
    const handle = await workflow.run();

    // first execution: sleep-1 recorded
    await worker.tick();
    await sleep(100);

    // verify first sleep was recorded
    const attempts1 = await backend.listStepAttempts({
      workflowRunId: handle.workflowRun.id,
    });
    expect(attempts1).toHaveLength(1);
    expect(attempts1[0]?.stepName).toBe("sleep-1");

    // now swap order for replay
    swapSleeps = true;

    // replay should detect non-determinism
    await worker.tick();
    await sleep(50);

    const failed = await backend.getWorkflowRun({
      workflowRunId: handle.workflowRun.id,
    });

    expect(failed?.status).toBe("pending"); // should be retrying
    expect(failed?.error).toBeDefined();
    // @ts-expect-error - test suite
    expect(failed?.error?.name).toBe("NonDeterministicError");
    // @ts-expect-error - test suite
    expect(failed?.error?.message).toContain("Step order mismatch");
    // @ts-expect-error - test suite
    expect(failed?.error?.message).toContain('expected step "sleep-1"');
    // @ts-expect-error - test suite
    expect(failed?.error?.message).toContain('but got "sleep-2"');
  });

  test("allows deterministic workflows with conditional steps", async () => {
    const backend = await createBackend();
    const client = new OpenWorkflow({ backend });

    const workflow = client.defineWorkflow<{ runBranch: boolean }, string>(
      { name: "deterministic-conditional" },
      async ({ step, input }) => {
        const result = await step.run({ name: "check" }, () => input.runBranch);

        return result
          ? await step.run({ name: "branch-a" }, () => "a")
          : await step.run({ name: "branch-b" }, () => "b");
      },
    );

    const worker = client.newWorker();

    // test branch A
    const handleA = await workflow.run({ runBranch: true });
    await worker.tick();
    await sleep(50);
    const resultA = await handleA.result();
    expect(resultA).toBe("a");

    // verify only check and branch-a were executed
    const attemptsA = await backend.listStepAttempts({
      workflowRunId: handleA.workflowRun.id,
    });
    expect(attemptsA).toHaveLength(2);
    expect(attemptsA[0]?.stepName).toBe("check");
    expect(attemptsA[1]?.stepName).toBe("branch-a");

    // test branch B
    const handleB = await workflow.run({ runBranch: false });
    await worker.tick();
    await sleep(50);
    const resultB = await handleB.result();
    expect(resultB).toBe("b");

    // verify only check and branch-b were executed
    const attemptsB = await backend.listStepAttempts({
      workflowRunId: handleB.workflowRun.id,
    });
    expect(attemptsB).toHaveLength(2);
    expect(attemptsB[0]?.stepName).toBe("check");
    expect(attemptsB[1]?.stepName).toBe("branch-b");
  });

  test("enforces deterministic order even within Promise.all", async () => {
    const backend = await createBackend();
    const client = new OpenWorkflow({ backend });

    let swapOrder = false;
    const workflow = client.defineWorkflow(
      { name: "parallel-determinism" },
      async ({ step }) => {
        // eslint-disable-next-line unicorn/prefer-ternary
        if (swapOrder) {
          await Promise.all([
            step.run({ name: "B" }, () => "b"),
            step.run({ name: "A" }, () => "a"),
          ]);
        } else {
          await Promise.all([
            step.run({ name: "A" }, () => "a"),
            step.run({ name: "B" }, () => "b"),
          ]);
        }
        // sleep to force workflow to pause and resume
        await step.sleep("wait", "50ms");
        return "done";
      },
    );

    const worker = client.newWorker();
    const handle = await workflow.run();

    // 1. [A, B] order, then sleeps
    await worker.tick();
    await sleep(50);

    // verify A and B were recorded in correct order
    const attempts = await backend.listStepAttempts({
      workflowRunId: handle.workflowRun.id,
    });
    expect(attempts).toHaveLength(3);
    expect(attempts[0]?.stepName).toBe("A");
    expect(attempts[1]?.stepName).toBe("B");
    expect(attempts[2]?.stepName).toBe("wait");

    // 2. Swap to [B, A] and replay
    swapOrder = true;
    await sleep(100); // wait for sleep to complete

    await worker.tick();
    await sleep(50);

    const failed = await backend.getWorkflowRun({
      workflowRunId: handle.workflowRun.id,
    });

    expect(failed?.status).toBe("pending"); // should be retrying
    expect(failed?.error).toBeDefined();
    // @ts-expect-error - test suite
    expect(failed?.error?.name).toBe("NonDeterministicError");
    // @ts-expect-error - test suite
    expect(failed?.error?.message).toContain("Step order mismatch");
    // @ts-expect-error - test suite
    expect(failed?.error?.message).toContain('expected step "A"');
    // @ts-expect-error - test suite
    expect(failed?.error?.message).toContain('but got "B"');
  });
});

async function createBackend(): Promise<BackendPostgres> {
  return await BackendPostgres.connect(DEFAULT_DATABASE_URL, {
    namespaceId: randomUUID(), // unique namespace per test
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
