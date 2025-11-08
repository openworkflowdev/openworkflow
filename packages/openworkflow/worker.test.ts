import { BackendPostgres } from "../backend-postgres/backend.js";
import { DEFAULT_DATABASE_URL } from "../backend-postgres/postgres.js";
import { OpenWorkflow } from "./client.js";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

describe("Worker", () => {
  let backend: BackendPostgres;

  beforeAll(async () => {
    backend = await BackendPostgres.connect(DEFAULT_DATABASE_URL);
  });

  afterAll(async () => {
    await backend.end();
  });

  test("passes workflow input to handlers (known slow test - awaits result)", async () => {
    const namespaceId = randomUUID();
    const client = new OpenWorkflow({ backend, namespaceId });

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

  test("processes workflow runs to completion (known slow test - awaits result)", async () => {
    const namespaceId = randomUUID();
    const client = new OpenWorkflow({ backend, namespaceId });

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

  test("step.run reuses cached results (known slow test - awaits result)", async () => {
    const namespaceId = randomUUID();
    const client = new OpenWorkflow({ backend, namespaceId });

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
    const namespaceId = randomUUID();
    const client = new OpenWorkflow({ backend, namespaceId });

    const workflowRun = await backend.createWorkflowRun({
      namespaceId,
      workflowName: "missing",
      version: null,
      idempotencyKey: null,
      config: {},
      context: null,
      input: null,
      availableAt: null,
    });

    const worker = client.newWorker();
    await worker.tick();

    const updated = await backend.getWorkflowRun({
      namespaceId,
      workflowRunId: workflowRun.id,
    });

    expect(updated?.status).toBe("pending");
    expect(updated?.error).toBeDefined();
    expect(updated?.availableAt).not.toBeNull();
  });

  test("retries failed workflows automatically (known slow test - awaits result)", async () => {
    const namespaceId = randomUUID();
    const client = new OpenWorkflow({ backend, namespaceId });

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
    const namespaceId = randomUUID();
    const client = new OpenWorkflow({ backend, namespaceId });

    client.defineWorkflow({ name: "noop" }, () => null);
    const worker = client.newWorker();
    await worker.tick(); // no runs queued
  });

  test("handles step functions that return undefined (known slow test - awaits result)", async () => {
    const namespaceId = randomUUID();
    const client = new OpenWorkflow({ backend, namespaceId });

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

  test("executes steps synchronously within workflow (known slow test - awaits result)", async () => {
    const namespaceId = randomUUID();
    const client = new OpenWorkflow({ backend, namespaceId });

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

  test("executes parallel steps with Promise.all (known slow test - awaits result)", async () => {
    const namespaceId = randomUUID();
    const client = new OpenWorkflow({ backend, namespaceId });

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
    const namespaceId = randomUUID();
    const client = new OpenWorkflow({ backend, namespaceId });

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
        namespaceId,
        workflowRunId: handle.workflowRun.id,
      });
      if (run?.status === "succeeded") completed++;
    }

    expect(completed).toBe(2);
  });

  test("worker starts, processes work, and stops gracefully (known slow test - awaits result)", async () => {
    const namespaceId = randomUUID();
    const client = new OpenWorkflow({ backend, namespaceId });

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

  test("recovers from crashes during parallel step execution (known slow test - awaits result)", async () => {
    const namespaceId = randomUUID();
    const client = new OpenWorkflow({ backend, namespaceId });

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

  test("reclaims workflow run when heartbeat stops (known slow test - awaits result)", async () => {
    const namespaceId = randomUUID();
    const client = new OpenWorkflow({ backend, namespaceId });

    const workflow = client.defineWorkflow(
      { name: "heartbeat-test" },
      () => "done",
    );

    const handle = await workflow.run();
    const workerId = randomUUID();

    const claimed = await backend.claimWorkflowRun({
      namespaceId,
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
    const namespaceId = randomUUID();
    const client = new OpenWorkflow({ backend, namespaceId });

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
    const namespaceId = randomUUID();
    const client = new OpenWorkflow({ backend, namespaceId });

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

  test("worker only sleeps between claims when no work is available (known slow test - awaits result)", async () => {
    const namespaceId = randomUUID();
    const client = new OpenWorkflow({ backend, namespaceId });

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
});

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
