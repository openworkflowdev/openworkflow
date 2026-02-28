import { OpenWorkflow } from "../client/client.js";
import type { Backend } from "../core/backend.js";
import type { DurationString } from "../core/duration.js";
import type { StepAttempt } from "../core/step-attempt.js";
import { DEFAULT_WORKFLOW_RETRY_POLICY } from "../core/workflow-definition.js";
import type { WorkflowFunctionParams } from "../core/workflow-function.js";
import type { WorkflowRun } from "../core/workflow-run.js";
import { BackendPostgres } from "../postgres.js";
import { DEFAULT_POSTGRES_URL } from "../postgres/postgres.js";
import {
  WORKFLOW_STEP_LIMIT,
  STEP_LIMIT_EXCEEDED_ERROR_CODE,
  createStepExecutionStateFromAttempts,
  executeWorkflow,
} from "./execution.js";
import { randomUUID } from "node:crypto";
import { afterEach, describe, test, expect, vi } from "vitest";
import { z } from "zod";

const backendsToStop: BackendPostgres[] = [];

afterEach(async () => {
  await Promise.all(
    backendsToStop.splice(0).map(async (backend) => backend.stop()),
  );
});

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

  test("auto-indexes duplicate step.run names", async () => {
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
      second: "second-execution",
    });
    expect(executionCount).toBe(2);

    const steps = await backend.listStepAttempts({
      workflowRunId: handle.workflowRun.id,
      limit: 100,
    });
    const stepNames = steps.data
      .map((stepAttempt) => stepAttempt.stepName)
      .toSorted((a, b) => a.localeCompare(b));
    expect(stepNames).toEqual(["cached-step", "cached-step:1"]);
  });

  test("avoids step-name collisions with explicit numeric suffixes", async () => {
    const backend = await createBackend();
    const client = new OpenWorkflow({ backend });

    let thirdStepExecutions = 0;
    const workflow = client.defineWorkflow(
      { name: `executor-collision-suffix-${randomUUID()}` },
      async ({ step }) => {
        const first = await step.run({ name: "foo" }, () => "A");
        const second = await step.run({ name: "foo:1" }, () => "B");
        const third = await step.run({ name: "foo" }, () => {
          thirdStepExecutions += 1;
          return "C";
        });
        return { first, second, third };
      },
    );

    const worker = client.newWorker();
    const handle = await workflow.run();
    await worker.tick();

    await expect(handle.result()).resolves.toEqual({
      first: "A",
      second: "B",
      third: "C",
    });
    expect(thirdStepExecutions).toBe(1);

    const steps = await backend.listStepAttempts({
      workflowRunId: handle.workflowRun.id,
      limit: 100,
    });
    const stepNames = steps.data
      .map((stepAttempt) => stepAttempt.stepName)
      .toSorted((a, b) => a.localeCompare(b));
    expect(stepNames).toEqual(["foo", "foo:1", "foo:2"]);
  });

  test("handles chaotic explicit numeric suffix naming without collisions", async () => {
    const backend = await createBackend();
    const client = new OpenWorkflow({ backend });

    let executionCount = 0;
    const workflow = client.defineWorkflow(
      { name: `executor-collision-chaos-${randomUUID()}` },
      async ({ step }) => {
        async function runStep(name: string, value: string) {
          return await step.run({ name }, () => {
            executionCount += 1;
            return value;
          });
        }

        return [
          await runStep("foo", "a"),
          await runStep("foo:2", "b"),
          await runStep("foo", "c"),
          await runStep("foo:1", "d"),
          await runStep("foo", "e"),
          await runStep("foo:2", "f"),
          await runStep("foo", "g"),
          await runStep("foo:1", "h"),
          await runStep("foo:3", "i"),
          await runStep("foo", "j"),
        ];
      },
    );

    const worker = client.newWorker();
    const handle = await workflow.run();
    await worker.tick();

    await expect(handle.result()).resolves.toEqual([
      "a",
      "b",
      "c",
      "d",
      "e",
      "f",
      "g",
      "h",
      "i",
      "j",
    ]);
    expect(executionCount).toBe(10);

    const steps = await backend.listStepAttempts({
      workflowRunId: handle.workflowRun.id,
      limit: 100,
    });

    expect(steps.data).toHaveLength(10);
    expect(
      new Set(steps.data.map((stepAttempt) => stepAttempt.stepName)).size,
    ).toBe(10);

    const stepNameByOutput = Object.fromEntries(
      steps.data.map((stepAttempt): readonly [string, string] => {
        if (typeof stepAttempt.output !== "string") {
          throw new TypeError("Expected string output for chaos naming test");
        }
        return [stepAttempt.output, stepAttempt.stepName];
      }),
    );

    expect(stepNameByOutput).toEqual({
      a: "foo",
      b: "foo:2",
      c: "foo:1",
      d: "foo:1:1",
      e: "foo:3",
      f: "foo:2:1",
      g: "foo:4",
      h: "foo:1:2",
      i: "foo:3:1",
      j: "foo:5",
    });
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

  test("sleep parks workflow in running status", async () => {
    const backend = await createBackend();
    const client = new OpenWorkflow({ backend });

    const workflow = client.defineWorkflow(
      { name: "executor-sleep" },
      async ({ step }) => {
        await step.sleep("sleep-1", "500ms");
        return "after sleep";
      },
    );

    const handle = await workflow.run();
    const worker = client.newWorker();
    const parkedRun = await tickUntilParked(
      backend,
      worker,
      handle.workflowRun.id,
      200,
      10,
    );

    expect(parkedRun.status).toBe("running");
    expect(parkedRun.workerId).toBeNull();
    expect(parkedRun.availableAt).not.toBeNull();
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
    const parked = await backend.getWorkflowRun({
      workflowRunId: handle.workflowRun.id,
    });
    expect(parked?.status).toBe("running");
    expect(parked?.workerId).toBeNull();

    // Wait for sleep to elapse
    await sleep(50);

    // Second tick - completes
    await worker.tick();

    const result = await handle.result();
    expect(result).toBe(15);
  });

  test("auto-indexes duplicate sleep names", async () => {
    const backend = await createBackend();
    const client = new OpenWorkflow({ backend });

    const workflow = client.defineWorkflow(
      { name: `sleep-duplicate-names-${randomUUID()}` },
      async ({ step }) => {
        await step.sleep("pause", "10ms");
        await step.sleep("pause", "10ms");
        return "done";
      },
    );

    const handle = await workflow.run();
    const worker = client.newWorker();
    const status = await tickUntilTerminal(
      backend,
      worker,
      handle.workflowRun.id,
      250,
      10,
    );

    expect(status).toBe("completed");
    await expect(handle.result()).resolves.toBe("done");

    const steps = await backend.listStepAttempts({
      workflowRunId: handle.workflowRun.id,
      limit: 100,
    });
    const sleepStepNames = steps.data
      .filter((stepAttempt) => stepAttempt.kind === "sleep")
      .map((stepAttempt) => stepAttempt.stepName)
      .toSorted((a, b) => a.localeCompare(b));
    expect(sleepStepNames).toEqual(["pause", "pause:1"]);
  });

  test("runs a child workflow and returns child output", async () => {
    const backend = await createBackend();
    const client = new OpenWorkflow({ backend });

    const child = client.defineWorkflow(
      { name: `workflow-child-success-${randomUUID()}` },
      ({ input }: { input: { value: number } }) => {
        return input.value + 1;
      },
    );

    const parent = client.defineWorkflow<{ value: number }, number>(
      { name: `workflow-parent-success-${randomUUID()}` },
      async ({ input, step }) => {
        const childResult = await step.runWorkflow(child.workflow.spec, {
          value: input.value,
        });
        return childResult * 2;
      },
    );

    const worker = client.newWorker({ concurrency: 2 });
    const handle = await parent.run({ value: 5 });
    const status = await tickUntilTerminal(
      backend,
      worker,
      handle.workflowRun.id,
      250,
      10,
    );

    expect(status).toBe("completed");
    await expect(handle.result()).resolves.toBe(12);
    const attempts = await backend.listStepAttempts({
      workflowRunId: handle.workflowRun.id,
      limit: 100,
    });
    const workflowAttempt = attempts.data.find(
      (stepAttempt) => stepAttempt.kind === "workflow",
    );
    expect(workflowAttempt?.stepName).toBe(child.workflow.spec.name);
  });

  test("wakes parent runWorkflow wait when child completes before parent parks", async () => {
    const backend = await createBackend();
    const client = new OpenWorkflow({ backend });

    const child = client.defineWorkflow(
      { name: `workflow-child-race-${randomUUID()}` },
      () => {
        return { ok: true };
      },
    );

    const parent = client.defineWorkflow(
      { name: `workflow-parent-race-${randomUUID()}` },
      async ({ step }) => {
        return await step.runWorkflow(child.workflow.spec);
      },
    );

    const originalSleepWorkflowRun = backend.sleepWorkflowRun.bind(backend);
    const sleepWorkflowRunSpy = vi
      .spyOn(backend, "sleepWorkflowRun")
      .mockImplementation(async (params) => {
        // Delay parent parking to force the child completion race window.
        await sleep(120);
        return await originalSleepWorkflowRun(params);
      });

    try {
      const worker = client.newWorker({ concurrency: 2 });
      const handle = await parent.run();
      const status = await tickUntilTerminal(
        backend,
        worker,
        handle.workflowRun.id,
        250,
        10,
      );

      expect(status).toBe("completed");
      await expect(handle.result()).resolves.toEqual({ ok: true });
    } finally {
      sleepWorkflowRunSpy.mockRestore();
    }
  });

  test("completes parent immediately when child workflow already finished", async () => {
    const backend = await createBackend();
    const client = new OpenWorkflow({ backend });

    const child = client.defineWorkflow(
      { name: `workflow-child-early-finish-${randomUUID()}` },
      () => {
        return { ignored: true };
      },
    );

    const parent = client.defineWorkflow(
      { name: `workflow-parent-early-finish-${randomUUID()}` },
      async ({ step }) => {
        return await step.runWorkflow(child.workflow.spec);
      },
    );

    const handle = await parent.run();
    const claimedParent = await backend.claimWorkflowRun({
      workerId: randomUUID(),
      leaseDurationMs: 5000,
    });
    if (!claimedParent) {
      throw new Error("Expected parent workflow run to be claimed");
    }
    expect(claimedParent.id).toBe(handle.workflowRun.id);

    const originalCreateWorkflowRun = backend.createWorkflowRun.bind(backend);
    const createWorkflowRunSpy = vi
      .spyOn(backend, "createWorkflowRun")
      .mockImplementation(async (params) => {
        const created = await originalCreateWorkflowRun(params);

        if (
          params.parentStepAttemptNamespaceId !== null &&
          params.parentStepAttemptId !== null
        ) {
          const claimedChild = await backend.claimWorkflowRun({
            workerId: randomUUID(),
            leaseDurationMs: 5000,
          });
          if (!claimedChild) {
            throw new Error("Expected child workflow run to be claimed");
          }
          expect(claimedChild.id).toBe(created.id);

          await backend.completeWorkflowRun({
            workflowRunId: claimedChild.id,
            workerId: claimedChild.workerId ?? "",
            output: { fast: true },
          });
        }

        return created;
      });

    try {
      await executeWorkflow({
        backend,
        workflowRun: claimedParent,
        workflowFn: parent.workflow.fn,
        workflowVersion: parent.workflow.spec.version ?? null,
        workerId: claimedParent.workerId ?? "",
        retryPolicy: DEFAULT_WORKFLOW_RETRY_POLICY,
      });
    } finally {
      createWorkflowRunSpy.mockRestore();
    }

    const parentAfter = await backend.getWorkflowRun({
      workflowRunId: handle.workflowRun.id,
    });
    expect(parentAfter?.status).toBe("completed");
    expect(parentAfter?.availableAt).toBeNull();
    await expect(handle.result()).resolves.toEqual({ fast: true });
  });

  test("supports explicit runWorkflow options.name override", async () => {
    const backend = await createBackend();
    const client = new OpenWorkflow({ backend });

    const child = client.defineWorkflow(
      { name: `workflow-child-step-shape-${randomUUID()}` },
      ({ input }: { input: { value: number } }) => {
        return input.value + 1;
      },
    );

    const parent = client.defineWorkflow(
      { name: `workflow-parent-step-shape-${randomUUID()}` },
      async ({ step }) => {
        return await step.runWorkflow(
          child.workflow.spec,
          { value: 9 },
          { name: "workflow-child" },
        );
      },
    );

    const worker = client.newWorker({ concurrency: 2 });
    const handle = await parent.run();
    const status = await tickUntilTerminal(
      backend,
      worker,
      handle.workflowRun.id,
      250,
      10,
    );

    expect(status).toBe("completed");
    await expect(handle.result()).resolves.toBe(10);
  });

  test("applies collision indexing across step.run and step.runWorkflow", async () => {
    const backend = await createBackend();
    const client = new OpenWorkflow({ backend });

    const child = client.defineWorkflow(
      { name: `workflow-child-cross-type-${randomUUID()}` },
      ({ input }: { input: { value: number } }) => {
        return input.value + 1;
      },
    );

    const parent = client.defineWorkflow(
      { name: `workflow-parent-cross-type-${randomUUID()}` },
      async ({ step }) => {
        const local = await step.run({ name: "shared-name" }, () => 41);
        const childWorkflowResult = await step.runWorkflow(
          child.workflow.spec,
          { value: 1 },
          { name: "shared-name" },
        );
        return { local, childWorkflowResult };
      },
    );

    const worker = client.newWorker({ concurrency: 2 });
    const handle = await parent.run();
    const status = await tickUntilTerminal(
      backend,
      worker,
      handle.workflowRun.id,
      250,
      10,
    );

    expect(status).toBe("completed");
    await expect(handle.result()).resolves.toEqual({
      local: 41,
      childWorkflowResult: 2,
    });

    const steps = await backend.listStepAttempts({
      workflowRunId: handle.workflowRun.id,
      limit: 100,
    });
    const sharedSteps = steps.data.filter((stepAttempt) =>
      stepAttempt.stepName.startsWith("shared-name"),
    );
    expect(sharedSteps).toHaveLength(2);
    const kindByStepName = new Map(
      sharedSteps.map((stepAttempt): readonly [string, string] => [
        stepAttempt.stepName,
        stepAttempt.kind,
      ]),
    );
    expect(
      [...kindByStepName.keys()].toSorted((a, b) => a.localeCompare(b)),
    ).toEqual(["shared-name", "shared-name:1"]);
    expect(kindByStepName.get("shared-name")).toBe("function");
    expect(kindByStepName.get("shared-name:1")).toBe("workflow");
  });

  test("supports workflow spec targets, date/number timeouts, and auto-indexed duplicate workflow names", async () => {
    const backend = await createBackend();
    const client = new OpenWorkflow({ backend });

    const child = client.defineWorkflow(
      { name: `workflow-child-timeout-shapes-${randomUUID()}` },
      ({ input }: { input: { value: number } }) => {
        return input.value + 1;
      },
    );

    const parent = client.defineWorkflow(
      { name: `workflow-parent-timeout-shapes-${randomUUID()}` },
      async ({ step }) => {
        const first = await step.runWorkflow(
          child.workflow.spec,
          { value: 4 },
          { timeout: new Date(Date.now() + 60_000) },
        );
        const second = await step.runWorkflow(
          child.workflow.spec,
          { value: 99 },
          { timeout: 60_000 },
        );
        const numeric = await step.runWorkflow(
          child.workflow.spec,
          { value: 8 },
          { timeout: 60_000 },
        );
        const spec = await step.runWorkflow(
          { name: child.workflow.spec.name },
          { value: 1 },
          { timeout: 60_000 },
        );
        return { first, second, numeric, spec };
      },
    );

    const worker = client.newWorker({ concurrency: 2 });
    const handle = await parent.run();
    const status = await tickUntilTerminal(
      backend,
      worker,
      handle.workflowRun.id,
      500,
      20,
    );

    expect(status).toBe("completed");
    await expect(handle.result()).resolves.toEqual({
      first: 5,
      second: 100,
      numeric: 9,
      spec: 2,
    });

    const steps = await backend.listStepAttempts({
      workflowRunId: handle.workflowRun.id,
      limit: 100,
    });
    const workflowStepNames = steps.data
      .filter((stepAttempt) => stepAttempt.kind === "workflow")
      .map((stepAttempt) => stepAttempt.stepName)
      .toSorted((a, b) => a.localeCompare(b));
    expect(workflowStepNames).toEqual([
      child.workflow.spec.name,
      `${child.workflow.spec.name}:1`,
      `${child.workflow.spec.name}:2`,
      `${child.workflow.spec.name}:3`,
    ]);
  });

  test("fails workflow when timeout number is invalid", async () => {
    const backend = await createBackend();
    const client = new OpenWorkflow({ backend });

    const parent = client.defineWorkflow(
      { name: `workflow-parent-invalid-timeout-number-${randomUUID()}` },
      async ({ step }) => {
        await step.runWorkflow(
          { name: `workflow-child-invalid-timeout-number-${randomUUID()}` },
          undefined,
          { timeout: -1 },
        );
        return "never";
      },
    );

    const worker = client.newWorker();
    const handle = await parent.run();
    const status = await tickUntilTerminal(
      backend,
      worker,
      handle.workflowRun.id,
      150,
      10,
    );

    expect(status).toBe("failed");
    await expect(handle.result()).rejects.toThrow(
      /Workflow timeout must be a non-negative number/,
    );
  });

  test("fails workflow when timeout duration string is invalid", async () => {
    const backend = await createBackend();
    const client = new OpenWorkflow({ backend });

    const parent = client.defineWorkflow(
      { name: `workflow-parent-invalid-timeout-duration-${randomUUID()}` },
      async ({ step }) => {
        await step.runWorkflow(
          { name: `workflow-child-invalid-timeout-duration-${randomUUID()}` },
          undefined,
          {
            timeout: "not-a-duration" as DurationString,
          },
        );
        return "never";
      },
    );

    const worker = client.newWorker();
    const handle = await parent.run();
    const status = await tickUntilTerminal(
      backend,
      worker,
      handle.workflowRun.id,
      150,
      10,
    );

    expect(status).toBe("failed");
    await expect(handle.result()).rejects.toThrow(/not-a-duration/);
  });

  test("validates child input before creating child run", async () => {
    const backend = await createBackend();
    const client = new OpenWorkflow({ backend });

    const child = client.defineWorkflow(
      {
        name: `workflow-child-schema-${randomUUID()}`,
        schema: z.object({ email: z.email() }),
      },
      ({ input }: { input: { email: string } }) => {
        return input.email;
      },
    );

    const parent = client.defineWorkflow(
      { name: `workflow-parent-schema-${randomUUID()}` },
      async ({ step }) => {
        await step.runWorkflow(child.workflow.spec, {
          email: "not-an-email",
        });
        return "never";
      },
    );

    const worker = client.newWorker();
    const handle = await parent.run();
    const status = await tickUntilTerminal(
      backend,
      worker,
      handle.workflowRun.id,
      150,
      10,
    );

    expect(status).toBe("failed");
    await expect(handle.result()).rejects.toThrow();

    const runs = await backend.listWorkflowRuns({ limit: 100 });
    const childRuns = runs.data.filter(
      (run) => run.parentStepAttemptId !== null,
    );
    expect(childRuns).toHaveLength(0);
  });

  test("handles runWorkflow replay with non-workflow context shape", async () => {
    const backend = await createBackend();
    const client = new OpenWorkflow({ backend });

    const child = client.defineWorkflow(
      { name: `workflow-child-context-null-${randomUUID()}` },
      () => {
        return { ok: true };
      },
    );

    const parent = client.defineWorkflow(
      { name: `workflow-parent-context-null-${randomUUID()}` },
      async ({ step }) => {
        return await step.runWorkflow(child.workflow.spec);
      },
    );

    const originalSetStepAttemptChildWorkflowRun =
      backend.setStepAttemptChildWorkflowRun.bind(backend);
    const setStepAttemptChildWorkflowRunSpy = vi
      .spyOn(backend, "setStepAttemptChildWorkflowRun")
      .mockImplementation(async (params) => {
        const linked = await originalSetStepAttemptChildWorkflowRun(params);
        return {
          ...linked,
          context: null,
        };
      });

    try {
      const worker = client.newWorker({ concurrency: 2 });
      const handle = await parent.run();
      const status = await tickUntilTerminal(
        backend,
        worker,
        handle.workflowRun.id,
        250,
        10,
      );

      expect(status).toBe("completed");
      await expect(handle.result()).resolves.toEqual({ ok: true });
    } finally {
      setStepAttemptChildWorkflowRunSpy.mockRestore();
    }
  });

  test("handles runWorkflow replay with legacy null timeout context", async () => {
    const backend = await createBackend();
    const client = new OpenWorkflow({ backend });

    const child = client.defineWorkflow(
      { name: `workflow-child-legacy-timeout-${randomUUID()}` },
      () => {
        return { ok: true };
      },
    );

    const parent = client.defineWorkflow(
      { name: `workflow-parent-legacy-timeout-${randomUUID()}` },
      async ({ step }) => {
        return await step.runWorkflow(child.workflow.spec);
      },
    );

    const originalSetStepAttemptChildWorkflowRun =
      backend.setStepAttemptChildWorkflowRun.bind(backend);
    const setStepAttemptChildWorkflowRunSpy = vi
      .spyOn(backend, "setStepAttemptChildWorkflowRun")
      .mockImplementation(async (params) => {
        const linked = await originalSetStepAttemptChildWorkflowRun(params);
        return {
          ...linked,
          context: { kind: "workflow", timeoutAt: null },
        };
      });

    try {
      const worker = client.newWorker({ concurrency: 2 });
      const handle = await parent.run();
      const status = await tickUntilTerminal(
        backend,
        worker,
        handle.workflowRun.id,
        250,
        10,
      );

      expect(status).toBe("completed");
      await expect(handle.result()).resolves.toEqual({ ok: true });
    } finally {
      setStepAttemptChildWorkflowRunSpy.mockRestore();
    }
  });

  test("handles runWorkflow replay with invalid timeout timestamp context", async () => {
    const backend = await createBackend();
    const client = new OpenWorkflow({ backend });

    const child = client.defineWorkflow(
      { name: `workflow-child-invalid-timeout-context-${randomUUID()}` },
      () => {
        return { ok: true };
      },
    );

    const parent = client.defineWorkflow(
      { name: `workflow-parent-invalid-timeout-context-${randomUUID()}` },
      async ({ step }) => {
        return await step.runWorkflow(child.workflow.spec);
      },
    );

    let childRunId: string | null = null;
    const originalSetStepAttemptChildWorkflowRun =
      backend.setStepAttemptChildWorkflowRun.bind(backend);
    const setStepAttemptChildWorkflowRunSpy = vi
      .spyOn(backend, "setStepAttemptChildWorkflowRun")
      .mockImplementation(async (params) => {
        childRunId = params.childWorkflowRunId;
        const linked = await originalSetStepAttemptChildWorkflowRun(params);
        return {
          ...linked,
          context: { kind: "workflow", timeoutAt: "not-a-date" },
        };
      });

    const originalGetWorkflowRun = backend.getWorkflowRun.bind(backend);
    const getWorkflowRunSpy = vi
      .spyOn(backend, "getWorkflowRun")
      .mockImplementation(async (params) => {
        const run = await originalGetWorkflowRun(params);
        if (!run || !childRunId || params.workflowRunId !== childRunId) {
          return run;
        }

        return {
          ...run,
          status: "completed",
          output: { ok: true },
          finishedAt: new Date(),
          workerId: null,
          availableAt: null,
        };
      });

    try {
      const handle = await parent.run();
      const claimedParent = await backend.claimWorkflowRun({
        workerId: randomUUID(),
        leaseDurationMs: 5000,
      });
      if (!claimedParent) {
        throw new Error("Expected parent workflow run to be claimed");
      }
      expect(claimedParent.id).toBe(handle.workflowRun.id);

      await executeWorkflow({
        backend,
        workflowRun: claimedParent,
        workflowFn: parent.workflow.fn,
        workflowVersion: parent.workflow.spec.version ?? null,
        workerId: claimedParent.workerId ?? "",
        retryPolicy: DEFAULT_WORKFLOW_RETRY_POLICY,
      });

      const parentAfter = await backend.getWorkflowRun({
        workflowRunId: handle.workflowRun.id,
      });
      expect(parentAfter?.status).toBe("completed");
      await expect(handle.result()).resolves.toEqual({ ok: true });
    } finally {
      getWorkflowRunSpy.mockRestore();
      setStepAttemptChildWorkflowRunSpy.mockRestore();
    }
  });

  test("fails workflow when child linkage is missing run id", async () => {
    const backend = await createBackend();
    const client = new OpenWorkflow({ backend });

    const child = client.defineWorkflow(
      { name: `workflow-child-link-missing-id-${randomUUID()}` },
      () => {
        return { ok: true };
      },
    );

    const parent = client.defineWorkflow(
      { name: `workflow-parent-link-missing-id-${randomUUID()}` },
      async ({ step }) => {
        return await step.runWorkflow(child.workflow.spec);
      },
    );

    const originalSetStepAttemptChildWorkflowRun =
      backend.setStepAttemptChildWorkflowRun.bind(backend);
    const setStepAttemptChildWorkflowRunSpy = vi
      .spyOn(backend, "setStepAttemptChildWorkflowRun")
      .mockImplementation(async (params) => {
        const linked = await originalSetStepAttemptChildWorkflowRun(params);
        return {
          ...linked,
          childWorkflowRunNamespaceId: null,
          childWorkflowRunId: null,
        };
      });

    try {
      const handle = await parent.run();
      const claimedParent = await backend.claimWorkflowRun({
        workerId: randomUUID(),
        leaseDurationMs: 5000,
      });
      if (!claimedParent) {
        throw new Error("Expected parent workflow run to be claimed");
      }
      expect(claimedParent.id).toBe(handle.workflowRun.id);

      await executeWorkflow({
        backend,
        workflowRun: claimedParent,
        workflowFn: parent.workflow.fn,
        workflowVersion: parent.workflow.spec.version ?? null,
        workerId: claimedParent.workerId ?? "",
        retryPolicy: DEFAULT_WORKFLOW_RETRY_POLICY,
      });

      const parentAfter = await backend.getWorkflowRun({
        workflowRunId: handle.workflowRun.id,
      });
      expect(parentAfter?.status).toBe("failed");
      await expect(handle.result()).rejects.toThrow(
        /could not find linked child workflow run/,
      );
    } finally {
      setStepAttemptChildWorkflowRunSpy.mockRestore();
    }
  });

  test("fails workflow when linked child run cannot be loaded", async () => {
    const backend = await createBackend();
    const client = new OpenWorkflow({ backend });

    const child = client.defineWorkflow(
      { name: `workflow-child-not-found-${randomUUID()}` },
      () => {
        return { ok: true };
      },
    );

    const parent = client.defineWorkflow(
      { name: `workflow-parent-child-not-found-${randomUUID()}` },
      async ({ step }) => {
        return await step.runWorkflow(child.workflow.spec);
      },
    );

    let childRunId: string | null = null;
    const originalSetStepAttemptChildWorkflowRun =
      backend.setStepAttemptChildWorkflowRun.bind(backend);
    const setStepAttemptChildWorkflowRunSpy = vi
      .spyOn(backend, "setStepAttemptChildWorkflowRun")
      .mockImplementation(async (params) => {
        childRunId = params.childWorkflowRunId;
        return await originalSetStepAttemptChildWorkflowRun(params);
      });

    const originalGetWorkflowRun = backend.getWorkflowRun.bind(backend);
    const getWorkflowRunSpy = vi
      .spyOn(backend, "getWorkflowRun")
      .mockImplementation(async (params) => {
        if (childRunId && params.workflowRunId === childRunId) {
          return null;
        }
        return await originalGetWorkflowRun(params);
      });

    try {
      const handle = await parent.run();
      const claimedParent = await backend.claimWorkflowRun({
        workerId: randomUUID(),
        leaseDurationMs: 5000,
      });
      if (!claimedParent) {
        throw new Error("Expected parent workflow run to be claimed");
      }
      expect(claimedParent.id).toBe(handle.workflowRun.id);

      await executeWorkflow({
        backend,
        workflowRun: claimedParent,
        workflowFn: parent.workflow.fn,
        workflowVersion: parent.workflow.spec.version ?? null,
        workerId: claimedParent.workerId ?? "",
        retryPolicy: DEFAULT_WORKFLOW_RETRY_POLICY,
      });

      const parentAfter = await backend.getWorkflowRun({
        workflowRunId: handle.workflowRun.id,
      });
      expect(parentAfter?.status).toBe("failed");
      await expect(handle.result()).rejects.toThrow(
        /could not find linked child workflow run/,
      );
    } finally {
      getWorkflowRunSpy.mockRestore();
      setStepAttemptChildWorkflowRunSpy.mockRestore();
    }
  });

  test("uses fallback child error when failed child run has no error payload", async () => {
    const backend = await createBackend();
    const client = new OpenWorkflow({ backend });

    const child = client.defineWorkflow(
      { name: `workflow-child-failed-null-error-${randomUUID()}` },
      () => {
        return { ok: true };
      },
    );

    const parent = client.defineWorkflow(
      { name: `workflow-parent-failed-null-error-${randomUUID()}` },
      async ({ step }) => {
        return await step.runWorkflow(child.workflow.spec);
      },
    );

    let childRunId: string | null = null;
    const originalSetStepAttemptChildWorkflowRun =
      backend.setStepAttemptChildWorkflowRun.bind(backend);
    const setStepAttemptChildWorkflowRunSpy = vi
      .spyOn(backend, "setStepAttemptChildWorkflowRun")
      .mockImplementation(async (params) => {
        childRunId = params.childWorkflowRunId;
        return await originalSetStepAttemptChildWorkflowRun(params);
      });

    const originalGetWorkflowRun = backend.getWorkflowRun.bind(backend);
    const getWorkflowRunSpy = vi
      .spyOn(backend, "getWorkflowRun")
      .mockImplementation(async (params) => {
        const run = await originalGetWorkflowRun(params);
        if (!run || !childRunId || params.workflowRunId !== childRunId) {
          return run;
        }

        return {
          ...run,
          status: "failed",
          error: null,
          finishedAt: new Date(),
        };
      });

    try {
      const handle = await parent.run();
      const claimedParent = await backend.claimWorkflowRun({
        workerId: randomUUID(),
        leaseDurationMs: 5000,
      });
      if (!claimedParent) {
        throw new Error("Expected parent workflow run to be claimed");
      }
      expect(claimedParent.id).toBe(handle.workflowRun.id);

      await executeWorkflow({
        backend,
        workflowRun: claimedParent,
        workflowFn: parent.workflow.fn,
        workflowVersion: parent.workflow.spec.version ?? null,
        workerId: claimedParent.workerId ?? "",
        retryPolicy: DEFAULT_WORKFLOW_RETRY_POLICY,
      });

      const parentAfter = await backend.getWorkflowRun({
        workflowRunId: handle.workflowRun.id,
      });
      expect(parentAfter?.status).toBe("failed");
      await expect(handle.result()).rejects.toThrow(
        /Child workflow run .* failed/,
      );
    } finally {
      getWorkflowRunSpy.mockRestore();
      setStepAttemptChildWorkflowRunSpy.mockRestore();
    }
  });

  test("surfaces canceled child workflow through parent workflow step", async () => {
    const backend = await createBackend();
    const client = new OpenWorkflow({ backend });

    const child = client.defineWorkflow(
      { name: `workflow-child-canceled-${randomUUID()}` },
      async ({ step }) => {
        await step.sleep("wait", "500ms");
        return { ok: true };
      },
    );

    const parent = client.defineWorkflow(
      { name: `workflow-parent-canceled-${randomUUID()}` },
      async ({ step }) => {
        return await step.runWorkflow(child.workflow.spec);
      },
    );

    const handle = await parent.run();
    const claimedParentFirstPass = await backend.claimWorkflowRun({
      workerId: randomUUID(),
      leaseDurationMs: 5000,
    });
    if (!claimedParentFirstPass) {
      throw new Error("Expected parent workflow run to be claimed");
    }
    expect(claimedParentFirstPass.id).toBe(handle.workflowRun.id);

    await executeWorkflow({
      backend,
      workflowRun: claimedParentFirstPass,
      workflowFn: parent.workflow.fn,
      workflowVersion: parent.workflow.spec.version ?? null,
      workerId: claimedParentFirstPass.workerId ?? "",
      retryPolicy: DEFAULT_WORKFLOW_RETRY_POLICY,
    });

    const parentAfterFirstPass = await backend.getWorkflowRun({
      workflowRunId: handle.workflowRun.id,
    });
    expect(parentAfterFirstPass?.status).toBe("running");
    expect(parentAfterFirstPass?.workerId).toBeNull();

    const attempts = await backend.listStepAttempts({
      workflowRunId: handle.workflowRun.id,
      limit: 100,
    });
    const workflowAttempt = attempts.data.find(
      (stepAttempt) => stepAttempt.stepName === child.workflow.spec.name,
    );
    const childRunId = workflowAttempt?.childWorkflowRunId;
    if (!childRunId) {
      throw new Error("Expected workflow attempt child workflow run id");
    }

    await backend.cancelWorkflowRun({
      workflowRunId: childRunId,
    });

    const claimedParentReplay = await backend.claimWorkflowRun({
      workerId: randomUUID(),
      leaseDurationMs: 5000,
    });
    if (!claimedParentReplay) {
      throw new Error("Expected parent replay workflow run to be claimed");
    }
    expect(claimedParentReplay.id).toBe(handle.workflowRun.id);

    await executeWorkflow({
      backend,
      workflowRun: claimedParentReplay,
      workflowFn: parent.workflow.fn,
      workflowVersion: parent.workflow.spec.version ?? null,
      workerId: claimedParentReplay.workerId ?? "",
      retryPolicy: DEFAULT_WORKFLOW_RETRY_POLICY,
    });

    const parentAfterReplay = await backend.getWorkflowRun({
      workflowRunId: handle.workflowRun.id,
    });
    expect(parentAfterReplay?.status).toBe("failed");
    await expect(handle.result()).rejects.toThrow(/was canceled/);
  });

  test("surfaces child failure through parent workflow step", async () => {
    const backend = await createBackend();
    const client = new OpenWorkflow({ backend });

    const child = client.defineWorkflow(
      { name: `workflow-child-failure-${randomUUID()}` },
      async ({ step }) => {
        await step.run(
          { name: "fail", retryPolicy: { maximumAttempts: 1 } },
          () => {
            throw new Error("child boom");
          },
        );
        return "never";
      },
    );

    const parent = client.defineWorkflow(
      { name: `workflow-parent-failure-${randomUUID()}` },
      async ({ step }) => {
        await step.runWorkflow(child.workflow.spec, null);
        return "never";
      },
    );

    const worker = client.newWorker({ concurrency: 2 });
    const handle = await parent.run();
    const status = await tickUntilTerminal(
      backend,
      worker,
      handle.workflowRun.id,
      150,
      10,
    );

    expect(status).toBe("failed");
    await expect(handle.result()).rejects.toThrow(/child boom/);
  });

  test("workflow timeout fails parent wait but child continues and completes", async () => {
    const backend = await createBackend();
    const client = new OpenWorkflow({ backend });

    const child = client.defineWorkflow(
      { name: `workflow-child-timeout-${randomUUID()}` },
      async ({ step }) => {
        await step.sleep("wait", "600ms");
        return { ok: true };
      },
    );

    const parent = client.defineWorkflow(
      { name: `workflow-parent-timeout-${randomUUID()}` },
      async ({ step }) => {
        return await step.runWorkflow(child.workflow.spec, undefined, {
          timeout: "100ms",
        });
      },
    );

    const worker = client.newWorker({ concurrency: 2 });
    const handle = await parent.run();
    const parentStatus = await tickUntilTerminal(
      backend,
      worker,
      handle.workflowRun.id,
      250,
      10,
    );
    expect(parentStatus).toBe("failed");
    await expect(handle.result()).rejects.toThrow(
      /Timed out waiting for child workflow to complete/,
    );

    const steps = await backend.listStepAttempts({
      workflowRunId: handle.workflowRun.id,
      limit: 100,
    });
    const workflowAttempt = steps.data.find(
      (step) => step.stepName === child.workflow.spec.name,
    );
    expect(workflowAttempt?.childWorkflowRunId).not.toBeNull();
    expect(workflowAttempt?.childWorkflowRunId).toHaveLength(36);

    const childRunId = workflowAttempt?.childWorkflowRunId;
    if (!childRunId) {
      throw new Error("Expected workflow attempt child workflow run id");
    }

    const runs = await backend.listWorkflowRuns({ limit: 100 });
    const childrenForWorkflowAttempt = runs.data.filter(
      (run) => run.parentStepAttemptId === workflowAttempt.id,
    );
    expect(childrenForWorkflowAttempt).toHaveLength(1);

    const childStatus = await tickUntilStatus(
      backend,
      worker,
      childRunId,
      "completed",
      250,
      10,
    );
    expect(childStatus).toBe("completed");
  });

  test("workflow timeout still fails when child finishes after timeout before parent replay", async () => {
    const backend = await createBackend();
    const client = new OpenWorkflow({ backend });

    const child = client.defineWorkflow(
      { name: `workflow-child-timeout-order-${randomUUID()}` },
      async ({ step }) => {
        await step.sleep("wait", "600ms");
        return { ok: true };
      },
    );

    const parent = client.defineWorkflow(
      { name: `workflow-parent-timeout-order-${randomUUID()}` },
      async ({ step }) => {
        return await step.runWorkflow(child.workflow.spec, undefined, {
          timeout: "100ms",
        });
      },
    );

    const handle = await parent.run();
    const initialWorkerId = randomUUID();
    const claimedParentFirstPass = await backend.claimWorkflowRun({
      workerId: initialWorkerId,
      leaseDurationMs: 5000,
    });
    if (!claimedParentFirstPass) {
      throw new Error("Expected parent workflow run to be claimed");
    }
    expect(claimedParentFirstPass.id).toBe(handle.workflowRun.id);

    await executeWorkflow({
      backend,
      workflowRun: claimedParentFirstPass,
      workflowFn: parent.workflow.fn,
      workflowVersion: parent.workflow.spec.version ?? null,
      workerId: claimedParentFirstPass.workerId ?? "",
      retryPolicy: DEFAULT_WORKFLOW_RETRY_POLICY,
    });

    const steps = await backend.listStepAttempts({
      workflowRunId: handle.workflowRun.id,
      limit: 100,
    });
    const workflowAttempt = steps.data.find(
      (step) => step.stepName === child.workflow.spec.name,
    );
    const childRunId = workflowAttempt?.childWorkflowRunId;
    if (!childRunId) {
      throw new Error("Expected workflow attempt child workflow run id");
    }

    const parentAfterFirstPass = await backend.getWorkflowRun({
      workflowRunId: handle.workflowRun.id,
    });
    expect(parentAfterFirstPass?.status).toBe("running");
    expect(parentAfterFirstPass?.workerId).toBeNull();

    await sleep(150);

    const claimedChild = await backend.claimWorkflowRun({
      workerId: randomUUID(),
      leaseDurationMs: 5000,
    });
    if (!claimedChild) {
      throw new Error("Expected child workflow run to be claimed");
    }
    expect(claimedChild.id).toBe(childRunId);

    await backend.completeWorkflowRun({
      workflowRunId: childRunId,
      workerId: claimedChild.workerId ?? "",
      output: { ok: true },
    });

    const claimedParentReplay = await backend.claimWorkflowRun({
      workerId: randomUUID(),
      leaseDurationMs: 5000,
    });
    if (!claimedParentReplay) {
      throw new Error("Expected parent workflow run replay to be claimed");
    }
    expect(claimedParentReplay.id).toBe(handle.workflowRun.id);

    await executeWorkflow({
      backend,
      workflowRun: claimedParentReplay,
      workflowFn: parent.workflow.fn,
      workflowVersion: parent.workflow.spec.version ?? null,
      workerId: claimedParentReplay.workerId ?? "",
      retryPolicy: DEFAULT_WORKFLOW_RETRY_POLICY,
    });

    const parentAfterReplay = await backend.getWorkflowRun({
      workflowRunId: handle.workflowRun.id,
    });
    expect(parentAfterReplay?.status).toBe("failed");
    await expect(handle.result()).rejects.toThrow(
      /Timed out waiting for child workflow to complete/,
    );
  });

  test("runWorkflow wait parks until timeout and does not use poll-loop wake-up events", async () => {
    const backend = await createBackend();
    const client = new OpenWorkflow({ backend });

    const child = client.defineWorkflow(
      { name: `workflow-child-parked-${randomUUID()}` },
      async ({ step }) => {
        await step.sleep("wait", "200ms");
        return { ok: true };
      },
    );

    const parent = client.defineWorkflow(
      { name: `workflow-parent-parked-${randomUUID()}` },
      async ({ step }) => {
        return await step.runWorkflow(child.workflow.spec);
      },
    );

    const worker = client.newWorker({ concurrency: 2 });
    const handle = await parent.run();

    const parkedParent = await tickUntilParked(
      backend,
      worker,
      handle.workflowRun.id,
      200,
      10,
    );

    const millisecondsUntilWake =
      parkedParent.availableAt.getTime() - Date.now();
    const oneDayMs = 24 * 60 * 60 * 1000;
    // Default runWorkflow timeout is 1 year.
    expect(millisecondsUntilWake).toBeGreaterThan(300 * oneDayMs);
    expect(millisecondsUntilWake).toBeLessThan(370 * oneDayMs);

    const parentTerminalStatus = await tickUntilTerminal(
      backend,
      worker,
      handle.workflowRun.id,
      250,
      10,
    );
    expect(parentTerminalStatus).toBe("completed");
    await expect(handle.result()).resolves.toEqual({ ok: true });
  });

  test("parks using earliest timeout across parallel runWorkflow waits", async () => {
    const backend = await createBackend();
    const client = new OpenWorkflow({ backend });

    const child = client.defineWorkflow(
      { name: `workflow-child-timeout-fan-out-${randomUUID()}` },
      () => {
        return { ok: true };
      },
    );

    const parent = client.defineWorkflow(
      { name: `workflow-parent-timeout-fan-out-${randomUUID()}` },
      async ({ step }) => {
        await Promise.all([
          step.runWorkflow(child.workflow.spec, undefined, {
            name: "wait-long",
            timeout: 120_000,
          }),
          step.runWorkflow(child.workflow.spec, undefined, {
            name: "wait-short",
            timeout: 5000,
          }),
        ]);
        return "never";
      },
    );

    const handle = await parent.run();
    const claimedParent = await backend.claimWorkflowRun({
      workerId: randomUUID(),
      leaseDurationMs: 5000,
    });
    if (!claimedParent) {
      throw new Error("Expected parent workflow run to be claimed");
    }
    expect(claimedParent.id).toBe(handle.workflowRun.id);

    const childStepNameByRunId = new Map<string, string>();
    const originalSetStepAttemptChildWorkflowRun =
      backend.setStepAttemptChildWorkflowRun.bind(backend);
    const setStepAttemptChildWorkflowRunSpy = vi
      .spyOn(backend, "setStepAttemptChildWorkflowRun")
      .mockImplementation(async (params) => {
        const linked = await originalSetStepAttemptChildWorkflowRun(params);
        childStepNameByRunId.set(params.childWorkflowRunId, linked.stepName);
        return linked;
      });

    const originalGetWorkflowRun = backend.getWorkflowRun.bind(backend);
    const getWorkflowRunSpy = vi
      .spyOn(backend, "getWorkflowRun")
      .mockImplementation(async (params) => {
        const stepName = childStepNameByRunId.get(params.workflowRunId);
        if (stepName === "wait-long") {
          await sleep(40);
        } else if (stepName === "wait-short") {
          await sleep(120);
        }
        return await originalGetWorkflowRun(params);
      });

    try {
      await executeWorkflow({
        backend,
        workflowRun: claimedParent,
        workflowFn: parent.workflow.fn,
        workflowVersion: parent.workflow.spec.version ?? null,
        workerId: claimedParent.workerId ?? "",
        retryPolicy: DEFAULT_WORKFLOW_RETRY_POLICY,
      });
    } finally {
      getWorkflowRunSpy.mockRestore();
      setStepAttemptChildWorkflowRunSpy.mockRestore();
    }

    const parentAfter = await backend.getWorkflowRun({
      workflowRunId: handle.workflowRun.id,
    });
    expect(parentAfter?.status).toBe("running");
    expect(parentAfter?.workerId).toBeNull();
    expect(parentAfter?.availableAt).not.toBeNull();
    if (!parentAfter?.availableAt) {
      throw new Error("Expected parked parent availableAt");
    }

    const millisecondsUntilWake =
      parentAfter.availableAt.getTime() - Date.now();
    expect(millisecondsUntilWake).toBeGreaterThan(1500);
    expect(millisecondsUntilWake).toBeLessThan(20_000);

    const attempts = await backend.listStepAttempts({
      workflowRunId: handle.workflowRun.id,
      limit: 100,
    });
    const runningWorkflowStepNames = attempts.data
      .filter(
        (attempt) =>
          attempt.kind === "workflow" && attempt.status === "running",
      )
      .map((attempt) => attempt.stepName)
      .toSorted((a, b) => a.localeCompare(b));
    expect(runningWorkflowStepNames).toEqual(["wait-long", "wait-short"]);
  });

  test("replay pre-pass parks on earliest running wait across sleep and runWorkflow history", async () => {
    const backend = await createBackend();

    const workflowRun = await backend.createWorkflowRun({
      workflowName: `workflow-replay-earliest-wait-${randomUUID()}`,
      version: null,
      idempotencyKey: null,
      config: {},
      context: null,
      input: null,
      parentStepAttemptNamespaceId: null,
      parentStepAttemptId: null,
      availableAt: null,
      deadlineAt: null,
    });

    const claimedWorkflowRun = await backend.claimWorkflowRun({
      workerId: randomUUID(),
      leaseDurationMs: 5000,
    });
    if (!claimedWorkflowRun) {
      throw new Error("Expected workflow run to be claimed");
    }
    expect(claimedWorkflowRun.id).toBe(workflowRun.id);
    if (!claimedWorkflowRun.workerId) {
      throw new Error("Expected claimed workflow run worker id");
    }

    await backend.createStepAttempt({
      workflowRunId: claimedWorkflowRun.id,
      workerId: claimedWorkflowRun.workerId,
      stepName: "sleep-late",
      kind: "sleep",
      config: {},
      context: {
        kind: "sleep",
        resumeAt: new Date(Date.now() + 120_000).toISOString(),
      },
    });
    await backend.createStepAttempt({
      workflowRunId: claimedWorkflowRun.id,
      workerId: claimedWorkflowRun.workerId,
      stepName: "wait-early",
      kind: "workflow",
      config: {},
      context: {
        kind: "workflow",
        timeoutAt: new Date(Date.now() + 5000).toISOString(),
      },
    });

    await executeWorkflow({
      backend,
      workflowRun: claimedWorkflowRun,
      workflowFn: () => "unreachable",
      workflowVersion: null,
      workerId: claimedWorkflowRun.workerId,
      retryPolicy: DEFAULT_WORKFLOW_RETRY_POLICY,
    });

    const parkedRun = await backend.getWorkflowRun({
      workflowRunId: workflowRun.id,
    });
    expect(parkedRun?.status).toBe("running");
    expect(parkedRun?.workerId).toBeNull();
    expect(parkedRun?.availableAt).not.toBeNull();
    if (!parkedRun?.availableAt) {
      throw new Error("Expected parked workflow availableAt");
    }

    const millisecondsUntilWake = parkedRun.availableAt.getTime() - Date.now();
    expect(millisecondsUntilWake).toBeGreaterThan(1000);
    expect(millisecondsUntilWake).toBeLessThan(20_000);
  });

  test("best-effort fences late parallel branches after parent parks", async () => {
    const backend = await createBackend();
    const client = new OpenWorkflow({ backend });
    const lateStepName = "late-after-park";

    const workflow = client.defineWorkflow(
      { name: `workflow-stale-branch-fence-${randomUUID()}` },
      async ({ step }) => {
        await Promise.all([
          step.sleep("park-now", "600ms"),
          (async () => {
            await sleep(200);
            await step.run({ name: lateStepName }, () => "late-result");
          })(),
        ]);

        return "done";
      },
    );

    const worker = client.newWorker({ concurrency: 2 });
    const handle = await workflow.run();
    await tickUntilParked(backend, worker, handle.workflowRun.id, 200, 10);

    // Give the late branch enough time to continue after the parent is parked.
    await sleep(250);

    const attemptsWhileParked = await backend.listStepAttempts({
      workflowRunId: handle.workflowRun.id,
      limit: 100,
    });
    expect(
      attemptsWhileParked.data.some(
        (stepAttempt) => stepAttempt.stepName === lateStepName,
      ),
    ).toBe(false);

    const status = await tickUntilTerminal(
      backend,
      worker,
      handle.workflowRun.id,
      400,
      10,
    );
    expect(status).toBe("completed");
    await expect(handle.result()).resolves.toBe("done");

    const finalAttempts = await backend.listStepAttempts({
      workflowRunId: handle.workflowRun.id,
      limit: 100,
    });
    const lateAttempts = finalAttempts.data.filter(
      (stepAttempt) => stepAttempt.stepName === lateStepName,
    );
    expect(lateAttempts).toHaveLength(1);
    expect(lateAttempts[0]?.status).toBe("completed");
  });

  test("supports parallel workflows via Promise.all", async () => {
    const backend = await createBackend();
    const client = new OpenWorkflow({ backend });

    const child = client.defineWorkflow(
      { name: `workflow-child-parallel-${randomUUID()}` },
      ({ input }: { input: { value: number } }) => {
        return input.value * 2;
      },
    );

    const parent = client.defineWorkflow(
      { name: `workflow-parent-parallel-${randomUUID()}` },
      async ({ step }) => {
        const [a, b] = await Promise.all([
          step.runWorkflow(child.workflow.spec, {
            value: 2,
          }),
          step.runWorkflow(child.workflow.spec, {
            value: 3,
          }),
        ]);
        return a + b;
      },
    );

    const worker = client.newWorker({ concurrency: 3 });
    const handle = await parent.run();
    const status = await tickUntilTerminal(
      backend,
      worker,
      handle.workflowRun.id,
      200,
      10,
    );

    expect(status).toBe("completed");
    await expect(handle.result()).resolves.toBe(10);
  });

  test("fans out 300 isolated child workflows in parallel and notifies once all complete", async () => {
    const backend = await createBackend();
    const client = new OpenWorkflow({ backend });

    let activeChildren = 0;
    let maxParallelChildren = 0;
    let notifyStepCalls = 0;

    const child = client.defineWorkflow<
      { childId: number },
      { childId: number; childRunId: string }
    >(
      { name: `workflow-child-fan-out-${randomUUID()}` },
      async ({ input, run, step }) => {
        return await step.run({ name: "work" }, async () => {
          activeChildren += 1;
          maxParallelChildren = Math.max(maxParallelChildren, activeChildren);

          try {
            await sleep(5);
            return {
              childId: input.childId,
              childRunId: run.id,
            };
          } finally {
            activeChildren -= 1;
          }
        });
      },
    );

    const parent = client.defineWorkflow<
      undefined,
      {
        childResults: { childId: number; childRunId: string }[];
        notifyMessage: string;
      }
    >({ name: `workflow-parent-fan-out-${randomUUID()}` }, async ({ step }) => {
      const childResults = await Promise.all(
        Array.from({ length: 300 }, (_, index) =>
          step.runWorkflow(
            child.workflow.spec,
            { childId: index + 1 },
            { name: `fan-out-child-${String(index + 1)}` },
          ),
        ),
      );

      const notifyMessage = await step.run(
        { name: "notify-parent-complete" },
        () => {
          notifyStepCalls += 1;
          return `Completed ${String(childResults.length)} child workflows`;
        },
      );

      return { childResults, notifyMessage };
    });

    const worker = client.newWorker({ concurrency: 350 });
    const handle = await parent.run();
    const status = await tickUntilTerminal(
      backend,
      worker,
      handle.workflowRun.id,
      800,
      10,
      { maxWaitMs: 10_000 },
    );

    expect(status).toBe("completed");

    const result = await handle.result();
    expect(result.childResults).toHaveLength(300);
    expect(result.notifyMessage).toBe("Completed 300 child workflows");
    expect(
      new Set(result.childResults.map((childResult) => childResult.childRunId))
        .size,
    ).toBe(300);
    expect(maxParallelChildren).toBeGreaterThan(1);
    expect(notifyStepCalls).toBe(1);

    const parentAttempts = await backend.listStepAttempts({
      workflowRunId: handle.workflowRun.id,
      limit: 400,
    });
    const workflowAttempts = parentAttempts.data.filter(
      (stepAttempt) => stepAttempt.kind === "workflow",
    );
    expect(workflowAttempts).toHaveLength(300);
    const maxWorkflowFinishedAt = Math.max(
      ...workflowAttempts.map(
        (workflowAttempt) => workflowAttempt.finishedAt?.getTime() ?? 0,
      ),
    );
    const notifyAttempt = parentAttempts.data.find(
      (stepAttempt) => stepAttempt.stepName === "notify-parent-complete",
    );
    if (!notifyAttempt) {
      throw new Error("Expected notify-parent-complete step attempt");
    }
    if (notifyAttempt.startedAt === null) {
      throw new Error("Expected notify-parent-complete startedAt timestamp");
    }
    expect(notifyAttempt.startedAt.getTime()).toBeGreaterThanOrEqual(
      maxWorkflowFinishedAt,
    );

    const linkedChildRunIds = workflowAttempts.map(
      (workflowAttempt) => workflowAttempt.childWorkflowRunId,
    );
    expect(linkedChildRunIds).not.toContain(null);
    expect(new Set(linkedChildRunIds).size).toBe(300);

    const runs = await backend.listWorkflowRuns({ limit: 500 });
    const linkedChildRunIdSet = new Set(linkedChildRunIds);
    const linkedChildRuns = runs.data.filter((run) =>
      linkedChildRunIdSet.has(run.id),
    );
    expect(linkedChildRuns).toHaveLength(300);

    expect(notifyAttempt.status).toBe("completed");
  });

  test("fails parent when child 150 fails and does not auto-replay the failed child", async () => {
    const backend = await createBackend();
    const client = new OpenWorkflow({ backend });

    let injectedFailures = 0;
    let notifyStepCalls = 0;
    const failedChildIds = new Set<number>();

    const child = client.defineWorkflow<
      { childId: number },
      { childId: number; childRunId: string }
    >(
      {
        name: `workflow-child-fan-out-replay-${randomUUID()}`,
        retryPolicy: {
          initialInterval: "1ms",
          maximumInterval: "1ms",
          backoffCoefficient: 1,
          maximumAttempts: 1,
        },
      },
      async ({ input, run, step }) => {
        return await step.run(
          { name: "work", retryPolicy: { maximumAttempts: 1 } },
          async () => {
            if (input.childId === 150 && !failedChildIds.has(input.childId)) {
              failedChildIds.add(input.childId);
              injectedFailures += 1;
              throw new Error("Injected failure at child 150");
            }

            await sleep(5);
            return { childId: input.childId, childRunId: run.id };
          },
        );
      },
    );

    const parent = client.defineWorkflow<
      undefined,
      {
        childResults: { childId: number; childRunId: string }[];
        notifyMessage: string;
      }
    >(
      {
        name: `workflow-parent-fan-out-replay-${randomUUID()}`,
        retryPolicy: {
          initialInterval: "1ms",
          maximumInterval: "1ms",
          backoffCoefficient: 1,
          maximumAttempts: 1,
        },
      },
      async ({ step }) => {
        const childResults = await Promise.all(
          Array.from({ length: 300 }, (_, index) =>
            step.runWorkflow(
              child.workflow.spec,
              { childId: index + 1 },
              { name: `fan-out-child-${String(index + 1)}` },
            ),
          ),
        );

        const notifyMessage = await step.run(
          { name: "notify-parent-complete" },
          () => {
            notifyStepCalls += 1;
            return `Completed ${String(childResults.length)} child workflows`;
          },
        );

        return { childResults, notifyMessage };
      },
    );

    const worker = client.newWorker({ concurrency: 350 });
    const handle = await parent.run();
    const status = await tickUntilTerminal(
      backend,
      worker,
      handle.workflowRun.id,
      1200,
      10,
      { maxWaitMs: 20_000 },
    );

    expect(status).toBe("failed");
    await expect(handle.result()).rejects.toThrow(
      /Injected failure at child 150/,
    );
    expect(injectedFailures).toBe(1);
    expect(notifyStepCalls).toBe(0);

    const parentAttempts = await backend.listStepAttempts({
      workflowRunId: handle.workflowRun.id,
      limit: 1200,
    });
    const workflowAttempts = parentAttempts.data.filter(
      (stepAttempt) => stepAttempt.kind === "workflow",
    );
    const failedWorkflowAttempts = workflowAttempts.filter(
      (stepAttempt) => stepAttempt.status === "failed",
    );
    const completedWorkflowAttempts = workflowAttempts.filter(
      (stepAttempt) => stepAttempt.status === "completed",
    );

    expect(failedWorkflowAttempts).toHaveLength(1);
    expect(completedWorkflowAttempts.length).toBeGreaterThan(0);
    expect(completedWorkflowAttempts.length).toBeLessThanOrEqual(299);
    expect(workflowAttempts).toHaveLength(300);

    const child150Attempts = workflowAttempts.filter((stepAttempt) =>
      stepAttempt.stepName.startsWith("fan-out-child-150"),
    );
    expect(child150Attempts).toHaveLength(1);
    expect(child150Attempts[0]?.status).toBe("failed");

    expect(
      parentAttempts.data.some(
        (stepAttempt) => stepAttempt.stepName === "notify-parent-complete",
      ),
    ).toBe(false);

    const runs = await backend.listWorkflowRuns({ limit: 1200 });
    const childRuns = runs.data.filter(
      (run) =>
        run.workflowName === child.workflow.spec.name &&
        run.parentStepAttemptId !== null,
    );
    expect(childRuns).toHaveLength(300);
  });

  test("completes when child 150 has transient failure handled by child-level retries", async () => {
    const backend = await createBackend();
    const client = new OpenWorkflow({ backend });

    let injectedFailures = 0;
    let notifyStepCalls = 0;
    const failedChildIds = new Set<number>();

    const child = client.defineWorkflow<
      { childId: number },
      { childId: number; childRunId: string }
    >(
      { name: `workflow-child-fan-out-child-retry-${randomUUID()}` },
      async ({ input, run, step }) => {
        return await step.run(
          { name: "work", retryPolicy: { maximumAttempts: 2 } },
          async () => {
            if (input.childId === 150 && !failedChildIds.has(input.childId)) {
              failedChildIds.add(input.childId);
              injectedFailures += 1;
              throw new Error("Injected transient failure at child 150");
            }

            await sleep(5);
            return { childId: input.childId, childRunId: run.id };
          },
        );
      },
    );

    const parent = client.defineWorkflow<
      undefined,
      {
        childResults: { childId: number; childRunId: string }[];
        notifyMessage: string;
      }
    >(
      { name: `workflow-parent-fan-out-child-retry-${randomUUID()}` },
      async ({ step }) => {
        const childResults = await Promise.all(
          Array.from({ length: 300 }, (_, index) =>
            step.runWorkflow(
              child.workflow.spec,
              { childId: index + 1 },
              { name: `fan-out-child-${String(index + 1)}` },
            ),
          ),
        );

        const notifyMessage = await step.run(
          { name: "notify-parent-complete" },
          () => {
            notifyStepCalls += 1;
            return `Completed ${String(childResults.length)} child workflows`;
          },
        );

        return { childResults, notifyMessage };
      },
    );

    const worker = client.newWorker({ concurrency: 350 });
    const handle = await parent.run();
    const status = await tickUntilTerminal(
      backend,
      worker,
      handle.workflowRun.id,
      1200,
      10,
      { maxWaitMs: 20_000 },
    );

    expect(status).toBe("completed");
    const result = await handle.result();
    expect(result.childResults).toHaveLength(300);
    expect(result.notifyMessage).toBe("Completed 300 child workflows");
    expect(
      new Set(result.childResults.map((childResult) => childResult.childRunId))
        .size,
    ).toBe(300);
    expect(injectedFailures).toBe(1);
    expect(notifyStepCalls).toBe(1);

    const runs = await backend.listWorkflowRuns({ limit: 1200 });
    const childRuns = runs.data.filter(
      (run) =>
        run.workflowName === child.workflow.spec.name &&
        run.parentStepAttemptId !== null,
    );
    expect(childRuns).toHaveLength(300);
  });

  test("auto-indexes duplicate workflow names in parallel Promise.all", async () => {
    const backend = await createBackend();
    const client = new OpenWorkflow({ backend });

    const child = client.defineWorkflow(
      { name: `workflow-child-parallel-duplicate-${randomUUID()}` },
      ({ input }: { input: { value: number } }) => {
        return input.value * 3;
      },
    );

    const parent = client.defineWorkflow(
      { name: `workflow-parent-parallel-duplicate-${randomUUID()}` },
      async ({ step }) => {
        const [first, second] = await Promise.all([
          step.runWorkflow(child.workflow.spec, {
            value: 2,
          }),
          step.runWorkflow(child.workflow.spec, {
            value: 3,
          }),
        ]);
        return { first, second };
      },
    );

    const worker = client.newWorker({ concurrency: 3 });
    const handle = await parent.run();
    const status = await tickUntilTerminal(
      backend,
      worker,
      handle.workflowRun.id,
      200,
      10,
    );

    expect(status).toBe("completed");
    await expect(handle.result()).resolves.toEqual({ first: 6, second: 9 });

    const steps = await backend.listStepAttempts({
      workflowRunId: handle.workflowRun.id,
      limit: 100,
    });
    const workflowStepNames = steps.data
      .filter(
        (stepAttempt) =>
          stepAttempt.kind === "workflow" &&
          stepAttempt.stepName.startsWith(child.workflow.spec.name),
      )
      .map((stepAttempt) => stepAttempt.stepName)
      .toSorted((a, b) => a.localeCompare(b));
    expect(workflowStepNames).toEqual([
      child.workflow.spec.name,
      `${child.workflow.spec.name}:1`,
    ]);
  });

  test("does not create duplicate child runs while waiting across replays", async () => {
    const backend = await createBackend();
    const client = new OpenWorkflow({ backend });

    const child = client.defineWorkflow(
      { name: `workflow-child-replay-${randomUUID()}` },
      async ({ step }) => {
        await step.sleep("wait", "600ms");
        return { ok: true };
      },
    );

    const parent = client.defineWorkflow(
      { name: `workflow-parent-replay-${randomUUID()}` },
      async ({ step }) => {
        return await step.runWorkflow(child.workflow.spec);
      },
    );

    const worker = client.newWorker({ concurrency: 2 });
    const handle = await parent.run();
    const status = await tickUntilTerminal(
      backend,
      worker,
      handle.workflowRun.id,
      300,
      10,
    );

    expect(status).toBe("completed");
    await expect(handle.result()).resolves.toEqual({ ok: true });

    const steps = await backend.listStepAttempts({
      workflowRunId: handle.workflowRun.id,
      limit: 100,
    });
    const workflowAttempt = steps.data.find(
      (step) => step.stepName === child.workflow.spec.name,
    );
    if (!workflowAttempt) {
      throw new Error(
        `Expected workflow attempt for step ${child.workflow.spec.name}`,
      );
    }

    const runs = await backend.listWorkflowRuns({ limit: 100 });
    const childrenForWorkflowAttempt = runs.data.filter(
      (run) => run.parentStepAttemptId === workflowAttempt.id,
    );
    expect(childrenForWorkflowAttempt).toHaveLength(1);
  });

  test("does not replay a failed workflow step when Promise.all has waiting siblings", async () => {
    const backend = await createBackend();
    const client = new OpenWorkflow({ backend });

    const child = client.defineWorkflow<
      { childId: string },
      { childId: string }
    >({ name: `workflow-child-no-replay-${randomUUID()}` }, ({ input }) => ({
      childId: input.childId,
    }));

    const parent = client.defineWorkflow(
      { name: `workflow-parent-no-replay-${randomUUID()}` },
      async ({ step }) => {
        await Promise.all([
          step.runWorkflow(
            child.workflow.spec,
            { childId: "running" },
            { name: "child-running" },
          ),
          step.runWorkflow(
            child.workflow.spec,
            { childId: "failed" },
            { name: "child-failed" },
          ),
        ]);

        return "never";
      },
    );

    const handle = await parent.run();
    const claimedParent = await backend.claimWorkflowRun({
      workerId: randomUUID(),
      leaseDurationMs: 5000,
    });
    if (!claimedParent) {
      throw new Error("Expected parent workflow run to be claimed");
    }
    expect(claimedParent.id).toBe(handle.workflowRun.id);
    if (!claimedParent.workerId) {
      throw new Error("Expected claimed parent worker id");
    }

    const timeoutAt = new Date(Date.now() + 60_000).toISOString();
    const runningAttempt = await backend.createStepAttempt({
      workflowRunId: claimedParent.id,
      workerId: claimedParent.workerId,
      stepName: "child-running",
      kind: "workflow",
      config: {},
      context: {
        kind: "workflow",
        timeoutAt,
      },
    });
    const failedAttempt = await backend.createStepAttempt({
      workflowRunId: claimedParent.id,
      workerId: claimedParent.workerId,
      stepName: "child-failed",
      kind: "workflow",
      config: {},
      context: {
        kind: "workflow",
        timeoutAt,
      },
    });

    const runningChildRun = await backend.createWorkflowRun({
      workflowName: child.workflow.spec.name,
      version: child.workflow.spec.version ?? null,
      idempotencyKey: null,
      config: {},
      context: null,
      input: { childId: "running" },
      parentStepAttemptNamespaceId: runningAttempt.namespaceId,
      parentStepAttemptId: runningAttempt.id,
      availableAt: null,
      deadlineAt: null,
    });
    const failedChildRun = await backend.createWorkflowRun({
      workflowName: child.workflow.spec.name,
      version: child.workflow.spec.version ?? null,
      idempotencyKey: null,
      config: {},
      context: null,
      input: { childId: "failed" },
      parentStepAttemptNamespaceId: failedAttempt.namespaceId,
      parentStepAttemptId: failedAttempt.id,
      availableAt: null,
      deadlineAt: null,
    });

    await backend.setStepAttemptChildWorkflowRun({
      workflowRunId: claimedParent.id,
      stepAttemptId: runningAttempt.id,
      workerId: claimedParent.workerId,
      childWorkflowRunNamespaceId: runningChildRun.namespaceId,
      childWorkflowRunId: runningChildRun.id,
    });
    await backend.setStepAttemptChildWorkflowRun({
      workflowRunId: claimedParent.id,
      stepAttemptId: failedAttempt.id,
      workerId: claimedParent.workerId,
      childWorkflowRunNamespaceId: failedChildRun.namespaceId,
      childWorkflowRunId: failedChildRun.id,
    });
    await backend.failStepAttempt({
      workflowRunId: claimedParent.id,
      stepAttemptId: failedAttempt.id,
      workerId: claimedParent.workerId,
      error: { message: "historical child failure" },
    });

    await executeWorkflow({
      backend,
      workflowRun: claimedParent,
      workflowFn: parent.workflow.fn,
      workflowVersion: parent.workflow.spec.version ?? null,
      workerId: claimedParent.workerId,
      retryPolicy: DEFAULT_WORKFLOW_RETRY_POLICY,
    });

    const parentAfterReplay = await backend.getWorkflowRun({
      workflowRunId: handle.workflowRun.id,
    });
    expect(parentAfterReplay?.status).toBe("failed");
    expect(parentAfterReplay?.error?.message).toContain(
      "historical child failure",
    );
    await expect(handle.result()).rejects.toThrow(/historical child failure/);

    const parentAttempts = await backend.listStepAttempts({
      workflowRunId: handle.workflowRun.id,
      limit: 50,
    });
    const failedStepAttempts = parentAttempts.data.filter(
      (stepAttempt) => stepAttempt.stepName === "child-failed",
    );
    expect(failedStepAttempts).toHaveLength(1);
    expect(failedStepAttempts[0]?.status).toBe("failed");

    const runs = await backend.listWorkflowRuns({ limit: 50 });
    const linkedChildRuns = runs.data.filter(
      (run) =>
        run.workflowName === child.workflow.spec.name &&
        run.parentStepAttemptNamespaceId !== null &&
        run.parentStepAttemptId !== null,
    );
    expect(linkedChildRuns).toHaveLength(2);
  });

  test("canceling parent while waiting does not cancel child workflow", async () => {
    const backend = await createBackend();
    const client = new OpenWorkflow({ backend });

    const child = client.defineWorkflow(
      { name: `workflow-child-cancel-${randomUUID()}` },
      async ({ step }) => {
        await step.sleep("wait", "600ms");
        return { childDone: true };
      },
    );

    const parent = client.defineWorkflow(
      { name: `workflow-parent-cancel-${randomUUID()}` },
      async ({ step }) => {
        return await step.runWorkflow(child.workflow.spec);
      },
    );

    const worker = client.newWorker({ concurrency: 2 });
    const handle = await parent.run();
    await tickUntilParked(backend, worker, handle.workflowRun.id, 200, 10);

    const steps = await backend.listStepAttempts({
      workflowRunId: handle.workflowRun.id,
      limit: 100,
    });
    const workflowAttempt = steps.data.find(
      (step) => step.stepName === child.workflow.spec.name,
    );
    const childRunId = workflowAttempt?.childWorkflowRunId;
    if (!childRunId) {
      throw new Error("Expected workflow attempt child workflow run id");
    }

    await handle.cancel();

    const parentStatus = await tickUntilStatus(
      backend,
      worker,
      handle.workflowRun.id,
      "canceled",
      200,
      10,
    );
    expect(parentStatus).toBe("canceled");

    const childStatus = await tickUntilStatus(
      backend,
      worker,
      childRunId,
      "completed",
      300,
      10,
    );
    expect(childStatus).toBe("completed");
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
    test("fails terminally when replay step history exceeds the step limit", async () => {
      const attempts = Array.from(
        { length: WORKFLOW_STEP_LIMIT + 1 },
        (_, index) =>
          createMockStepAttempt({
            id: `history-step-${String(index)}`,
            stepName: `history-step-${String(index)}`,
            status: "completed",
          }),
      );

      const listStepAttempts = vi.fn(() =>
        Promise.resolve({
          data: attempts,
          pagination: { next: null, prev: null },
        }),
      );
      const failWorkflowRun = vi.fn(
        (params: Parameters<Backend["failWorkflowRun"]>[0]) => {
          if (params.workflowRunId.length === 0) {
            throw new TypeError("Expected workflowRunId");
          }
          return Promise.resolve(
            createMockWorkflowRun({
              status: "failed",
              error: {
                code: STEP_LIMIT_EXCEEDED_ERROR_CODE,
                message: "step limit exceeded",
              },
            }),
          );
        },
      );
      const workflowFn = vi.fn(() => "unreachable");
      const workflowRun = createMockWorkflowRun({
        id: "replay-step-limit-run",
        workerId: "worker-step-limit",
      });

      await executeWorkflow({
        backend: {
          listStepAttempts,
          failWorkflowRun,
        } as unknown as Backend,
        workflowRun,
        workflowFn,
        workflowVersion: null,
        workerId: "worker-step-limit",
        retryPolicy: {
          ...DEFAULT_WORKFLOW_RETRY_POLICY,
          maximumAttempts: 5,
        },
      });

      expect(workflowFn).not.toHaveBeenCalled();
      expect(listStepAttempts).toHaveBeenCalledTimes(1);

      const failCall = failWorkflowRun.mock.calls[0]?.[0];
      if (!failCall) throw new Error("Expected failWorkflowRun call");

      expect(failCall.workflowRunId).toBe(workflowRun.id);
      expect(failCall.workerId).toBe("worker-step-limit");
      expect(failCall.retryPolicy).toEqual(DEFAULT_WORKFLOW_RETRY_POLICY);
      expect(failCall.error["code"]).toBe(STEP_LIMIT_EXCEEDED_ERROR_CODE);
      expect(failCall.error["limit"]).toBe(WORKFLOW_STEP_LIMIT);
      expect(failCall.error["stepCount"]).toBe(WORKFLOW_STEP_LIMIT + 1);
      if (typeof failCall.error.message !== "string") {
        throw new TypeError("Expected step-limit message to be a string");
      }
      expect(failCall.error.message).toMatch(/exceeded the step limit/i);
    });

    test("completes when replay step history is exactly at the step limit", async () => {
      const attempts = Array.from({ length: WORKFLOW_STEP_LIMIT }, (_, index) =>
        createMockStepAttempt({
          id: `history-step-${String(index)}`,
          stepName: `history-step-${String(index)}`,
          status: "completed",
        }),
      );

      const listStepAttempts = vi.fn(() =>
        Promise.resolve({
          data: attempts,
          pagination: { next: null, prev: null },
        }),
      );
      const completeWorkflowRun = vi.fn(
        (params: Parameters<Backend["completeWorkflowRun"]>[0]) =>
          Promise.resolve(
            createMockWorkflowRun({
              id: params.workflowRunId,
              status: "completed",
              workerId: params.workerId,
              output: params.output ?? null,
            }),
          ),
      );
      const failWorkflowRun = vi.fn(
        (params: Parameters<Backend["failWorkflowRun"]>[0]) =>
          Promise.resolve(
            createMockWorkflowRun({
              id: params.workflowRunId,
              status: "failed",
            }),
          ),
      );
      const workflowFn = vi.fn(() => "replayed-success");
      const workflowRun = createMockWorkflowRun({
        id: "replay-step-limit-exact-run",
        workerId: "worker-step-limit-exact",
      });

      await executeWorkflow({
        backend: {
          listStepAttempts,
          completeWorkflowRun,
          failWorkflowRun,
        } as unknown as Backend,
        workflowRun,
        workflowFn,
        workflowVersion: null,
        workerId: "worker-step-limit-exact",
        retryPolicy: {
          ...DEFAULT_WORKFLOW_RETRY_POLICY,
          maximumAttempts: 5,
        },
      });

      expect(workflowFn).toHaveBeenCalledTimes(1);
      expect(completeWorkflowRun).toHaveBeenCalledTimes(1);
      expect(failWorkflowRun).not.toHaveBeenCalled();
    });

    test("fails terminally when new steps would exceed the step limit", async () => {
      const stepNamesByAttemptId = new Map<string, string>();
      const listStepAttempts = vi.fn(() =>
        Promise.resolve({
          data: Array.from({ length: WORKFLOW_STEP_LIMIT - 1 }, (_, index) =>
            createMockStepAttempt({
              id: `existing-step-${String(index)}`,
              stepName: `existing-step-${String(index)}`,
              status: "completed",
            }),
          ),
          pagination: { next: null, prev: null },
        }),
      );
      const createStepAttempt = vi.fn(
        (params: Parameters<Backend["createStepAttempt"]>[0]) => {
          const createdId = `created-${params.stepName}`;
          stepNamesByAttemptId.set(createdId, params.stepName);
          return Promise.resolve(
            createMockStepAttempt({
              id: createdId,
              stepName: params.stepName,
              kind: params.kind,
              status: "running",
              output: null,
              finishedAt: null,
            }),
          );
        },
      );
      const completeStepAttempt = vi.fn(
        (params: Parameters<Backend["completeStepAttempt"]>[0]) => {
          const stepName = stepNamesByAttemptId.get(params.stepAttemptId);
          if (!stepName) {
            throw new Error(`Missing step name for ${params.stepAttemptId}`);
          }
          return Promise.resolve(
            createMockStepAttempt({
              id: params.stepAttemptId,
              stepName,
              status: "completed",
              output: params.output ?? null,
            }),
          );
        },
      );
      const failWorkflowRun = vi.fn(
        (params: Parameters<Backend["failWorkflowRun"]>[0]) => {
          if (params.workflowRunId.length === 0) {
            throw new TypeError("Expected workflowRunId");
          }
          return Promise.resolve(
            createMockWorkflowRun({
              status: "failed",
              error: {
                code: STEP_LIMIT_EXCEEDED_ERROR_CODE,
                message: "step limit exceeded",
              },
            }),
          );
        },
      );
      const workflowRun = createMockWorkflowRun({
        id: "runtime-step-limit-run",
        workerId: "worker-step-runtime",
      });
      const workflowFn = vi.fn(
        async ({ step }: WorkflowFunctionParams<unknown>) => {
          await step.run({ name: "new-step-1" }, () => "first");
          await step.run({ name: "new-step-2" }, () => "second");
          return "unreachable";
        },
      );

      await executeWorkflow({
        backend: {
          listStepAttempts,
          createStepAttempt,
          completeStepAttempt,
          failWorkflowRun,
        } as unknown as Backend,
        workflowRun,
        workflowFn,
        workflowVersion: null,
        workerId: "worker-step-runtime",
        retryPolicy: {
          ...DEFAULT_WORKFLOW_RETRY_POLICY,
          maximumAttempts: 5,
        },
      });

      expect(createStepAttempt).toHaveBeenCalledTimes(1);
      expect(completeStepAttempt).toHaveBeenCalledTimes(1);

      const failCall = failWorkflowRun.mock.calls[0]?.[0];
      if (!failCall) throw new Error("Expected failWorkflowRun call");

      expect(failCall.workflowRunId).toBe(workflowRun.id);
      expect(failCall.workerId).toBe("worker-step-runtime");
      expect(failCall.retryPolicy).toEqual(DEFAULT_WORKFLOW_RETRY_POLICY);
      expect(failCall.error["code"]).toBe(STEP_LIMIT_EXCEEDED_ERROR_CODE);
      expect(failCall.error["limit"]).toBe(WORKFLOW_STEP_LIMIT);
      expect(failCall.error["stepCount"]).toBe(WORKFLOW_STEP_LIMIT);
      if (typeof failCall.error.message !== "string") {
        throw new TypeError("Expected step-limit message to be a string");
      }
      expect(failCall.error.message).toMatch(/exceeded the step limit/i);
    });

    test("ignores fail-transition races after run cancel", async () => {
      const listStepAttempts = vi.fn(() =>
        Promise.resolve({
          data: [],
          pagination: { next: null, prev: null },
        }),
      );
      const failWorkflowRun = vi.fn(() =>
        Promise.reject(new Error("Failed to mark workflow run failed")),
      );
      const getWorkflowRun = vi.fn(() =>
        Promise.resolve(
          createMockWorkflowRun({
            id: "workflow-cancel-race-run",
            status: "canceled",
            workerId: null,
            finishedAt: new Date("2026-01-01T00:00:02.000Z"),
          }),
        ),
      );
      const workflowFn = vi.fn(() => {
        throw new Error("workflow failed");
      });
      const workflowRun = createMockWorkflowRun({
        id: "workflow-cancel-race-run",
        workerId: "worker-cancel-race",
      });

      await expect(
        executeWorkflow({
          backend: {
            listStepAttempts,
            failWorkflowRun,
            getWorkflowRun,
          } as unknown as Backend,
          workflowRun,
          workflowFn,
          workflowVersion: null,
          workerId: "worker-cancel-race",
          retryPolicy: DEFAULT_WORKFLOW_RETRY_POLICY,
        }),
      ).resolves.toBeUndefined();

      expect(workflowFn).toHaveBeenCalledTimes(1);
      expect(failWorkflowRun).toHaveBeenCalledTimes(1);
      expect(getWorkflowRun).toHaveBeenCalledWith({
        workflowRunId: workflowRun.id,
      });
    });

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
    test("workflow parks in running status", async () => {
      const backend = await createBackend();
      const client = new OpenWorkflow({ backend });

      const workflow = client.defineWorkflow(
        { name: "sleep-workflow" },
        async ({ step }) => {
          await step.sleep("wait", "500ms");
          return "after sleep";
        },
      );

      const handle = await workflow.run();
      const worker = client.newWorker();
      await worker.tick();

      const workflowRun = await backend.getWorkflowRun({
        workflowRunId: handle.workflowRun.id,
      });
      expect(workflowRun?.status).toBe("running");
      expect(workflowRun?.workerId).toBeNull();
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

      const parked = await backend.getWorkflowRun({
        workflowRunId: handle.workflowRun.id,
      });
      expect(parked?.status).toBe("running");
      expect(parked?.workerId).toBeNull();

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

  describe("run", () => {
    test("exposes run metadata from workflow run", async () => {
      const backend = await createBackend();
      const client = new OpenWorkflow({ backend });
      const deadlineAt = new Date(Date.now() + 60_000);
      const idempotencyKey = "run-metadata-idempotency";

      const workflow = client.defineWorkflow(
        { name: "run-metadata", version: "1.2.3" },
        ({ run }) => {
          return {
            id: run.id,
            workflowName: run.workflowName,
            createdAtIsDate: run.createdAt instanceof Date,
            startedAtIsDate: run.startedAt instanceof Date,
            createdAtMs: run.createdAt.getTime(),
            startedAtMs: run.startedAt?.getTime() ?? null,
          };
        },
      );

      const worker = client.newWorker();
      const handle = await workflow.run(
        {},
        {
          deadlineAt,
          idempotencyKey,
        },
      );
      await worker.tick();
      const result = await handle.result();

      expect(result.id).toBe(handle.workflowRun.id);
      expect(result.workflowName).toBe("run-metadata");
      expect(result.createdAtIsDate).toBe(true);
      expect(result.startedAtIsDate).toBe(true);
      expect(result.startedAtMs).not.toBeNull();
      if (result.startedAtMs === null) {
        throw new Error("expected startedAtMs");
      }
      expect(result.startedAtMs).toBeGreaterThanOrEqual(result.createdAtMs);
    });

    test("keeps run metadata frozen at runtime", async () => {
      const backend = await createBackend();
      const client = new OpenWorkflow({ backend });
      let mutationError: unknown = null;

      const workflow = client.defineWorkflow(
        { name: "run-frozen" },
        async ({ run, step }) => {
          await step.run({ name: "mutate-run" }, () => {
            try {
              Object.assign(run as unknown as Record<string, unknown>, {
                id: "mutated",
              });
            } catch (error) {
              mutationError = error;
            }
            return null;
          });
          return run.id;
        },
      );

      const worker = client.newWorker();
      const handle = await workflow.run();
      await worker.tick();

      const result = await handle.result();
      expect(result).toBe(handle.workflowRun.id);
      if (mutationError !== null) {
        expect(mutationError).toBeInstanceOf(TypeError);
      }
    });

    test("keeps id and timestamps stable across replay", async () => {
      const backend = await createBackend();
      const client = new OpenWorkflow({ backend });
      const snapshots: {
        id: string;
        createdAt: number;
        startedAt: number | null;
      }[] = [];

      const workflow = client.defineWorkflow(
        { name: "run-replay-stable" },
        async ({ run, step }) => {
          snapshots.push({
            id: run.id,
            createdAt: run.createdAt.getTime(),
            startedAt: run.startedAt?.getTime() ?? null,
          });
          await step.sleep("pause", "10ms");
          return null;
        },
      );

      const worker = client.newWorker();
      const handle = await workflow.run();
      await worker.tick();
      await sleep(50);
      await worker.tick();
      await handle.result();

      expect(snapshots.length).toBe(2);
      expect(snapshots[0]).toEqual(snapshots[1]);
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
    expect(state.failedByStepName.get("step-a")).toBe(failedA2);
    expect(state.failedByStepName.get("step-b")).toBe(failedB);
    expect(state.failedByStepName.has("step-c")).toBe(false);
    expect(state.runningByStepName.get("step-c")).toBe(running);
    expect(state.runningByStepName.has("step-b")).toBe(false);
  });

  test("returns empty cache and counts for empty history", () => {
    const state = createStepExecutionStateFromAttempts([]);

    expect(state.cache.size).toBe(0);
    expect(state.failedCountsByStepName.size).toBe(0);
    expect(state.failedByStepName.size).toBe(0);
    expect(state.runningByStepName.size).toBe(0);
  });
});

async function createBackend(): Promise<BackendPostgres> {
  const backend = await BackendPostgres.connect(DEFAULT_POSTGRES_URL, {
    namespaceId: randomUUID(),
  });
  backendsToStop.push(backend);

  return backend;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const TERMINAL_RUN_STATUSES = new Set(["completed", "failed", "canceled"]);
type ParkedWorkflowRun = WorkflowRun & {
  status: "running";
  workerId: null;
  availableAt: Date;
};

async function tickUntilTerminal(
  backend: BackendPostgres,
  worker: ReturnType<OpenWorkflow["newWorker"]>,
  workflowRunId: string,
  maxTicks: number,
  sleepMs: number,
  options?: { maxWaitMs?: number },
): Promise<string> {
  const startedAt = Date.now();
  const maxWaitMs =
    options?.maxWaitMs ?? Math.max(250, Math.min(maxTicks * sleepMs, 3000));

  while (Date.now() - startedAt <= maxWaitMs) {
    const claimedCount = await worker.tick();
    const run = await backend.getWorkflowRun({ workflowRunId });
    if (run && TERMINAL_RUN_STATUSES.has(run.status)) {
      return run.status;
    }
    if (claimedCount === 0) {
      await sleep(sleepMs);
    }
  }

  throw new Error(`Timed out waiting for workflow run ${workflowRunId}`);
}

async function tickUntilStatus(
  backend: BackendPostgres,
  worker: ReturnType<OpenWorkflow["newWorker"]>,
  workflowRunId: string,
  expectedStatus: string,
  maxTicks: number,
  sleepMs: number,
): Promise<string> {
  const startedAt = Date.now();
  const maxWaitMs = Math.max(250, Math.min(maxTicks * sleepMs, 3000));

  while (Date.now() - startedAt <= maxWaitMs) {
    const claimedCount = await worker.tick();
    const run = await backend.getWorkflowRun({ workflowRunId });
    if (run?.status === expectedStatus) {
      return run.status;
    }
    if (claimedCount === 0) {
      await sleep(sleepMs);
    }
  }

  throw new Error(
    `Timed out waiting for workflow run ${workflowRunId} to reach ${expectedStatus}`,
  );
}

async function tickUntilParked(
  backend: BackendPostgres,
  worker: ReturnType<OpenWorkflow["newWorker"]>,
  workflowRunId: string,
  maxTicks: number,
  sleepMs: number,
): Promise<ParkedWorkflowRun> {
  const startedAt = Date.now();
  const maxWaitMs = Math.max(250, Math.min(maxTicks * sleepMs, 3000));

  while (Date.now() - startedAt <= maxWaitMs) {
    const claimedCount = await worker.tick();
    const run = await backend.getWorkflowRun({ workflowRunId });
    if (
      run?.status === "running" &&
      run.workerId === null &&
      run.availableAt !== null
    ) {
      return run as ParkedWorkflowRun;
    }
    if (claimedCount === 0) {
      await sleep(sleepMs);
    }
  }

  throw new Error(
    `Timed out waiting for workflow run ${workflowRunId} to park`,
  );
}

function createMockStepAttempt(
  overrides: Partial<StepAttempt> = {},
): StepAttempt {
  const status = overrides.status ?? "completed";

  return {
    namespaceId: "default",
    id: "step-attempt-id",
    workflowRunId: "workflow-run-id",
    stepName: "step",
    kind: "function",
    status,
    config: {},
    context: null,
    output: null,
    error: null,
    childWorkflowRunNamespaceId: null,
    childWorkflowRunId: null,
    startedAt: new Date("2026-01-01T00:00:00.000Z"),
    finishedAt:
      status === "running" ? null : new Date("2026-01-01T00:00:01.000Z"),
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:01.000Z"),
    ...overrides,
  };
}

function createMockWorkflowRun(
  overrides: Partial<WorkflowRun> = {},
): WorkflowRun {
  return {
    namespaceId: "default",
    id: "workflow-run-id",
    workflowName: "workflow-name",
    version: null,
    status: "running",
    idempotencyKey: null,
    config: {},
    context: null,
    input: null,
    output: null,
    error: null,
    attempts: 1,
    parentStepAttemptNamespaceId: null,
    parentStepAttemptId: null,
    workerId: "worker-id",
    availableAt: null,
    deadlineAt: null,
    startedAt: new Date("2026-01-01T00:00:00.000Z"),
    finishedAt: null,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    ...overrides,
  };
}
