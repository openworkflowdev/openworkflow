import { OpenWorkflow } from "./client.js";
import type { StepAttempt } from "./core/step.js";
import { createStepExecutionStateFromAttempts } from "./execution.js";
import { BackendPostgres } from "./postgres.js";
import { DEFAULT_POSTGRES_URL } from "./postgres/postgres.js";
import { randomUUID } from "node:crypto";
import { describe, test, expect } from "vitest";

describe("StepExecutor", () => {
  test("executes step and returns result", async () => {
    const backend = await createBackend();
    const client = new OpenWorkflow({ backend });

    const workflow = client.defineWorkflow(
      { name: "executor-basic" },
      async ({ step }) => {
        const result = await step.run({ name: "add" }, () => 5 + 3);
        return result;
      },
    );

    const worker = client.newWorker();
    const handle = await workflow.run();
    await worker.tick();

    const result = await handle.result();
    expect(result).toBe(8);
  });

  test("caches step results for same step name", async () => {
    const backend = await createBackend();
    const client = new OpenWorkflow({ backend });

    let executionCount = 0;
    const workflow = client.defineWorkflow(
      { name: "executor-cached" },
      async ({ step }) => {
        const first = await step.run({ name: "cached-step" }, () => {
          executionCount++;
          return "first-execution";
        });
        const second = await step.run({ name: "cached-step" }, () => {
          executionCount++;
          return "second-execution";
        });
        return { first, second };
      },
    );

    const worker = client.newWorker();
    const handle = await workflow.run();
    await worker.tick();

    const result = await handle.result();
    expect(result).toEqual({
      first: "first-execution",
      second: "first-execution",
    });
    expect(executionCount).toBe(1);
  });

  test("different step names execute independently", async () => {
    const backend = await createBackend();
    const client = new OpenWorkflow({ backend });

    let executionCount = 0;
    const workflow = client.defineWorkflow(
      { name: "executor-different-steps" },
      async ({ step }) => {
        const first = await step.run({ name: "step-1" }, () => {
          executionCount++;
          return "a";
        });
        const second = await step.run({ name: "step-2" }, () => {
          executionCount++;
          return "b";
        });
        return { first, second };
      },
    );

    const worker = client.newWorker();
    const handle = await workflow.run();
    await worker.tick();

    const result = await handle.result();
    expect(result).toEqual({ first: "a", second: "b" });
    expect(executionCount).toBe(2);
  });

  test("propagates step errors with deadline exceeded", async () => {
    const backend = await createBackend();
    const client = new OpenWorkflow({ backend });

    const workflow = client.defineWorkflow(
      { name: "executor-error" },
      async ({ step }) => {
        await step.run({ name: "failing-step" }, () => {
          throw new Error("Step failed intentionally");
        });
        return "should not reach";
      },
    );

    const worker = client.newWorker();
    // Use deadline to force immediate failure without retries
    const handle = await workflow.run({}, { deadlineAt: new Date() });
    await worker.tick();
    await sleep(100);

    await expect(handle.result()).rejects.toThrow(/deadline exceeded/);
  });

  test("sleep puts workflow in sleeping status", async () => {
    const backend = await createBackend();
    const client = new OpenWorkflow({ backend });

    const workflow = client.defineWorkflow(
      { name: "executor-sleep" },
      async ({ step }) => {
        await step.sleep("sleep-1", "5s");
        return "after sleep";
      },
    );

    const handle = await workflow.run();
    const worker = client.newWorker();
    await worker.tick();

    const workflowRun = await backend.getWorkflowRun({
      workflowRunId: handle.workflowRun.id,
    });
    expect(workflowRun?.status).toBe("sleeping");
    expect(workflowRun?.availableAt).not.toBeNull();
  });

  test("workflow resumes after sleep duration", async () => {
    const backend = await createBackend();
    const client = new OpenWorkflow({ backend });

    const workflow = client.defineWorkflow(
      { name: "resume-after-sleep" },
      async ({ step }) => {
        const value = await step.run({ name: "before" }, () => 5);
        await step.sleep("wait", "10ms");
        return value + 10;
      },
    );

    const handle = await workflow.run();
    const worker = client.newWorker();

    // First tick - hits sleep
    await worker.tick();
    await sleep(50); // Wait for tick to complete
    const sleeping = await backend.getWorkflowRun({
      workflowRunId: handle.workflowRun.id,
    });
    expect(sleeping?.status).toBe("sleeping");

    // Wait for sleep to elapse
    await sleep(50);

    // Second tick - completes
    await worker.tick();

    const result = await handle.result();
    expect(result).toBe(15);
  });
});

describe("executeWorkflow", () => {
  describe("successful execution", () => {
    test("executes a simple workflow", async () => {
      const backend = await createBackend();
      const client = new OpenWorkflow({ backend });

      const workflow = client.defineWorkflow(
        { name: "simple-workflow" },
        ({ input }: { input: { a: number; b: number } }) => {
          return input.a + input.b;
        },
      );

      const worker = client.newWorker();
      const handle = await workflow.run({ a: 10, b: 5 });
      await worker.tick();

      const result = await handle.result();
      expect(result).toBe(15);
    });

    test("executes a multi-step workflow", async () => {
      const backend = await createBackend();
      const client = new OpenWorkflow({ backend });

      const workflow = client.defineWorkflow<{ value: number }, number>(
        { name: "multi-step-workflow" },
        async ({ input, step }) => {
          const sum = await step.run({ name: "add" }, () => input.value + 5);
          const product = await step.run({ name: "multiply" }, () => sum * 2);
          return product;
        },
      );

      const worker = client.newWorker();
      const handle = await workflow.run({ value: 10 });
      await worker.tick();

      const result = await handle.result();
      expect(result).toBe(30);
    });

    test("returns null for workflows without return", async () => {
      const backend = await createBackend();
      const client = new OpenWorkflow({ backend });

      const workflow = client.defineWorkflow(
        { name: "void-workflow" },
        () => null,
      );

      const worker = client.newWorker();
      const handle = await workflow.run();
      await worker.tick();

      const result = await handle.result();
      expect(result).toBeNull();
    });

    test("returns null from workflow", async () => {
      const backend = await createBackend();
      const client = new OpenWorkflow({ backend });

      const workflow = client.defineWorkflow(
        { name: "null-workflow" },
        () => null,
      );

      const worker = client.newWorker();
      const handle = await workflow.run();
      await worker.tick();

      const result = await handle.result();
      expect(result).toBeNull();
    });
  });

  describe("error handling", () => {
    test("handles workflow errors with deadline exceeded", async () => {
      const backend = await createBackend();
      const client = new OpenWorkflow({ backend });

      const workflow = client.defineWorkflow(
        { name: "failing-workflow" },
        () => {
          throw new Error("Workflow error");
        },
      );

      const worker = client.newWorker();
      // Use deadline to skip retries - fails with deadline exceeded
      const handle = await workflow.run({}, { deadlineAt: new Date() });
      await worker.tick();
      await sleep(100);

      await expect(handle.result()).rejects.toThrow(/deadline exceeded/);
    });

    test("handles step errors with deadline exceeded", async () => {
      const backend = await createBackend();
      const client = new OpenWorkflow({ backend });

      const workflow = client.defineWorkflow(
        { name: "step-error-workflow" },
        async ({ step }) => {
          await step.run({ name: "failing" }, () => {
            throw new Error("Step error");
          });
          return "unreachable";
        },
      );

      const worker = client.newWorker();
      const handle = await workflow.run({}, { deadlineAt: new Date() });
      await worker.tick();
      await sleep(100);

      await expect(handle.result()).rejects.toThrow(/deadline exceeded/);
    });

    test("serializes non-Error exceptions", async () => {
      const backend = await createBackend();
      const client = new OpenWorkflow({ backend });

      const workflow = client.defineWorkflow(
        { name: "non-error-workflow" },
        async ({ step }) => {
          await step.run({ name: "throw-object" }, () => {
            // eslint-disable-next-line @typescript-eslint/only-throw-error
            throw { custom: "error", code: 500 };
          });
          return "nope";
        },
      );

      const worker = client.newWorker();
      const handle = await workflow.run({}, { deadlineAt: new Date() });
      await worker.tick();
      await sleep(100);

      await expect(handle.result()).rejects.toThrow();
    });
  });

  describe("sleep handling", () => {
    test("workflow enters sleeping status", async () => {
      const backend = await createBackend();
      const client = new OpenWorkflow({ backend });

      const workflow = client.defineWorkflow(
        { name: "sleep-workflow" },
        async ({ step }) => {
          await step.sleep("wait", "5s");
          return "after sleep";
        },
      );

      const handle = await workflow.run();
      const worker = client.newWorker();
      await worker.tick();

      const workflowRun = await backend.getWorkflowRun({
        workflowRunId: handle.workflowRun.id,
      });
      expect(workflowRun?.status).toBe("sleeping");
    });

    test("resumes workflow after sleep duration", async () => {
      const backend = await createBackend();
      const client = new OpenWorkflow({ backend });

      const workflow = client.defineWorkflow<{ value: number }, number>(
        { name: "resume-after-sleep" },
        async ({ input, step }) => {
          const sum = await step.run({ name: "add" }, () => input.value + 1);
          await step.sleep("wait", "10ms");
          return sum + 10;
        },
      );

      const handle = await workflow.run({ value: 5 });
      const worker = client.newWorker();

      // first tick - hits sleep
      await worker.tick();
      await sleep(50);

      const sleeping = await backend.getWorkflowRun({
        workflowRunId: handle.workflowRun.id,
      });
      expect(sleeping?.status).toBe("sleeping");

      // wait for sleep
      await sleep(50);

      await worker.tick();

      const result = await handle.result();
      expect(result).toBe(16);
    });
  });

  describe("workflow with complex data", () => {
    test("handles objects as input and output", async () => {
      const backend = await createBackend();
      const client = new OpenWorkflow({ backend });

      const workflow = client.defineWorkflow(
        { name: "user-workflow" },
        ({ input }: { input: { name: string; age: number } }) => {
          return {
            greeting: `Hello, ${input.name}! You are ${String(input.age)} years old.`,
            processed: true,
          };
        },
      );

      const worker = client.newWorker();
      const handle = await workflow.run({ name: "Alice", age: 30 });
      await worker.tick();

      const result = await handle.result();
      expect(result).toEqual({
        greeting: "Hello, Alice! You are 30 years old.",
        processed: true,
      });
    });

    test("handles arrays in workflow", async () => {
      const backend = await createBackend();
      const client = new OpenWorkflow({ backend });

      const workflow = client.defineWorkflow(
        { name: "array-workflow" },
        ({ input }: { input: { numbers: number[] } }) => {
          return input.numbers.reduce((a, b) => a + b, 0);
        },
      );

      const worker = client.newWorker();
      const handle = await workflow.run({ numbers: [1, 2, 3, 4, 5] });
      await worker.tick();

      const result = await handle.result();
      expect(result).toBe(15);
    });
  });

  describe("result type handling", () => {
    test("returns success with numeric result", async () => {
      const backend = await createBackend();
      const client = new OpenWorkflow({ backend });

      const workflow = client.defineWorkflow(
        { name: "numeric-result" },
        async ({ step }) => {
          return await step.run({ name: "compute" }, () => 100 + 200);
        },
      );

      const worker = client.newWorker();
      const handle = await workflow.run();
      await worker.tick();

      const result = await handle.result();
      expect(result).toBe(300);
    });

    test("returns success with string result", async () => {
      const backend = await createBackend();
      const client = new OpenWorkflow({ backend });

      const workflow = client.defineWorkflow(
        { name: "string-result" },
        ({ input }: { input: { text: string } }) => {
          return input.text.toUpperCase();
        },
      );

      const worker = client.newWorker();
      const handle = await workflow.run({ text: "hello world" });
      await worker.tick();

      const result = await handle.result();
      expect(result).toBe("HELLO WORLD");
    });

    test("returns success with boolean result", async () => {
      const backend = await createBackend();
      const client = new OpenWorkflow({ backend });

      const workflow = client.defineWorkflow(
        { name: "bool-result" },
        ({ input }: { input: { value: number } }) => {
          return input.value > 0;
        },
      );

      const worker = client.newWorker();
      const handle = await workflow.run({ value: 42 });
      await worker.tick();

      const result = await handle.result();
      expect(result).toBe(true);
    });
  });

  describe("step execution order", () => {
    test("executes steps in sequence", async () => {
      const backend = await createBackend();
      const client = new OpenWorkflow({ backend });

      const order: string[] = [];
      const workflow = client.defineWorkflow(
        { name: "sequence-workflow" },
        async ({ step }) => {
          await step.run({ name: "first" }, () => order.push("first"));
          await step.run({ name: "second" }, () => order.push("second"));
          await step.run({ name: "third" }, () => order.push("third"));
          return order;
        },
      );

      const worker = client.newWorker();
      const handle = await workflow.run();
      await worker.tick();

      const result = await handle.result();
      expect(result).toEqual(["first", "second", "third"]);
    });
  });

  describe("version handling", () => {
    test("passes version to workflow function", async () => {
      const backend = await createBackend();
      const client = new OpenWorkflow({ backend });

      const workflow = client.defineWorkflow(
        { name: "version-workflow", version: "1.0.0" },
        ({ version }) => {
          return { receivedVersion: version };
        },
      );

      const worker = client.newWorker();
      const handle = await workflow.run();
      await worker.tick();

      const result = await handle.result();
      expect(result).toEqual({ receivedVersion: "1.0.0" });
    });

    test("passes null version when not specified", async () => {
      const backend = await createBackend();
      const client = new OpenWorkflow({ backend });

      const workflow = client.defineWorkflow(
        { name: "no-version-workflow" },
        ({ version }) => {
          return { receivedVersion: version };
        },
      );

      const worker = client.newWorker();
      const handle = await workflow.run();
      await worker.tick();

      const result = await handle.result();
      expect(result).toEqual({ receivedVersion: null });
    });
  });
});

describe("createStepExecutionStateFromAttempts", () => {
  test("builds successful cache and failed-count map from mixed history", () => {
    const completed = createMockStepAttempt({
      id: "completed-a",
      stepName: "step-a",
      status: "completed",
      output: "a",
    });
    const failedA1 = createMockStepAttempt({
      id: "failed-a-1",
      stepName: "step-a",
      status: "failed",
    });
    const failedA2 = createMockStepAttempt({
      id: "failed-a-2",
      stepName: "step-a",
      status: "failed",
    });
    const failedB = createMockStepAttempt({
      id: "failed-b",
      stepName: "step-b",
      status: "failed",
    });
    const running = createMockStepAttempt({
      id: "running-c",
      stepName: "step-c",
      status: "running",
    });

    const state = createStepExecutionStateFromAttempts([
      completed,
      failedA1,
      failedA2,
      failedB,
      running,
    ]);

    expect(state.cache.size).toBe(1);
    expect(state.cache.get("step-a")).toBe(completed);
    expect(state.cache.has("step-b")).toBe(false);
    expect(state.cache.has("step-c")).toBe(false);

    expect(state.failedCountsByStepName.get("step-a")).toBe(2);
    expect(state.failedCountsByStepName.get("step-b")).toBe(1);
    expect(state.failedCountsByStepName.has("step-c")).toBe(false);
  });

  test("returns empty cache and counts for empty history", () => {
    const state = createStepExecutionStateFromAttempts([]);

    expect(state.cache.size).toBe(0);
    expect(state.failedCountsByStepName.size).toBe(0);
  });
});

async function createBackend(): Promise<BackendPostgres> {
  return await BackendPostgres.connect(DEFAULT_POSTGRES_URL, {
    namespaceId: randomUUID(),
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function createMockStepAttempt(
  overrides: Partial<StepAttempt> = {},
): StepAttempt {
  return {
    namespaceId: "default",
    id: "step-attempt-id",
    workflowRunId: "workflow-run-id",
    stepName: "step",
    kind: "function",
    status: "completed",
    config: {},
    context: null,
    output: null,
    error: null,
    childWorkflowRunNamespaceId: null,
    childWorkflowRunId: null,
    startedAt: new Date("2026-01-01T00:00:00.000Z"),
    finishedAt: new Date("2026-01-01T00:00:01.000Z"),
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:01.000Z"),
    ...overrides,
  };
}
