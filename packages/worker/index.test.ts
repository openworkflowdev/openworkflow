import { BackendPostgres } from "../backend-postgres/index.js";
import { DEFAULT_DATABASE_URL } from "../backend-postgres/postgres.js";
import { OpenWorkflow } from "../openworkflow/index.js";
import { Worker } from "./index.js";
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

describe("Worker", () => {
  let backend: BackendPostgres;
  let namespaceId: string;
  let client: OpenWorkflow;

  beforeEach(() => {
    namespaceId = randomUUID();
    backend = new BackendPostgres(DEFAULT_DATABASE_URL);
    client = new OpenWorkflow({
      backend,
      namespaceId,
    });
  });

  afterEach(async () => {
    await backend.end();
  });

  test("passes workflow input to handlers", async () => {
    const workflow = client.defineWorkflow("context", ({ input }) => input);
    const worker = new Worker({
      backend,
      namespaceId,
      workflows: client.listWorkflowDefinitions(),
    });

    const payload = { value: 10 };
    const handle = await workflow.run({
      input: payload,
    });
    await worker.tick();

    const result = await handle.result();
    expect(result).toEqual(payload);
  });

  test("processes workflow runs to completion", async () => {
    const workflow = client.defineWorkflow(
      "process",
      ({ input }: { input: { value: number } }) => input.value * 2,
    );
    const worker = new Worker({
      backend,
      namespaceId,
      workflows: client.listWorkflowDefinitions(),
    });

    const handle = await workflow.run({ input: { value: 21 } });
    await worker.tick();

    const result = await handle.result();
    expect(result).toBe(42);
  });

  test("step.run reuses cached results", async () => {
    let executionCount = 0;
    const workflow = client.defineWorkflow("cached-step", async ({ step }) => {
      const first = await step.run("once", () => {
        executionCount++;
        return "value";
      });
      const second = await step.run("once", () => {
        executionCount++;
        return "should-not-run";
      });
      return { first, second };
    });

    const worker = new Worker({
      backend,
      namespaceId,
      workflows: client.listWorkflowDefinitions(),
    });

    const handle = await workflow.run({ input: {} });
    await worker.tick();

    const result = await handle.result();
    expect(result).toEqual({ first: "value", second: "value" });
    expect(executionCount).toBe(1);
  });

  test("marks workflow failed when definition is missing", async () => {
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

    const worker = new Worker({
      backend,
      namespaceId,
      workflows: [
        client.defineWorkflow("other", () => {
          return null;
        }),
      ],
    });

    await worker.tick();

    const updated = await backend.getWorkflowRun({
      namespaceId,
      workflowRunId: workflowRun.id,
    });
    expect(updated?.status).toBe("failed");
  });

  test("tick is a no-op when no work is available", async () => {
    client.defineWorkflow("noop", () => null);
    const worker = new Worker({
      backend,
      namespaceId,
      workflows: client.listWorkflowDefinitions(),
    });

    await worker.tick(); // no runs queued
  });
});
