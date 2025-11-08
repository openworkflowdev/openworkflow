import { BackendPostgres } from "../backend-postgres/backend.js";
import { DEFAULT_DATABASE_URL } from "../backend-postgres/postgres.js";
import { OpenWorkflow } from "./client.js";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

describe("OpenWorkflow", () => {
  let backend: BackendPostgres;

  beforeAll(async () => {
    backend = await BackendPostgres.connect(DEFAULT_DATABASE_URL);
  });

  afterAll(async () => {
    await backend.end();
  });

  test("enqueues workflow runs via backend", async () => {
    const namespaceId = randomUUID();
    const client = new OpenWorkflow({ backend, namespaceId });

    const workflow = client.defineWorkflow({ name: "enqueue-test" }, noopFn);
    await workflow.run({ docUrl: "https://example.com" });

    const workerId = "enqueue-worker";
    const claimed = await backend.claimWorkflowRun({
      namespaceId,
      workerId,
      leaseDurationMs: 1000,
    });

    expect(claimed?.workflowName).toBe("enqueue-test");
    expect(claimed?.workerId).toBe(workerId);
    expect(claimed?.input).toEqual({ docUrl: "https://example.com" });
  });

  test("result resolves when workflow succeeds", async () => {
    const namespaceId = randomUUID();
    const client = new OpenWorkflow({ backend, namespaceId });

    const workflow = client.defineWorkflow({ name: "result-success" }, noopFn);
    const handle = await workflow.run({ value: 1 });

    const workerId = "test-worker";
    const claimed = await backend.claimWorkflowRun({
      namespaceId,
      workerId,
      leaseDurationMs: 1000,
    });
    expect(claimed).not.toBeNull();
    if (!claimed) throw new Error("workflow run was not claimed");

    await backend.markWorkflowRunSucceeded({
      namespaceId,
      workflowRunId: claimed.id,
      workerId,
      output: { ok: true },
    });

    // eslint-disable-next-line @typescript-eslint/no-confusing-void-expression
    const result = await handle.result();
    expect(result).toEqual({ ok: true });
  });

  test("result rejects when workflow fails", async () => {
    const namespaceId = randomUUID();
    const client = new OpenWorkflow({ backend, namespaceId });

    const workflow = client.defineWorkflow({ name: "result-failure" }, noopFn);
    await workflow.run({ value: 1 });

    const workerId = "test-worker";
    const claimed = await backend.claimWorkflowRun({
      namespaceId,
      workerId,
      leaseDurationMs: 1000,
    });
    expect(claimed).not.toBeNull();
    if (!claimed) throw new Error("workflow run was not claimed");

    // mark as failed (should reschedule))
    await backend.markWorkflowRunFailed({
      namespaceId,
      workflowRunId: claimed.id,
      workerId,
      error: { message: "boom" },
    });

    const rescheduled = await backend.getWorkflowRun({
      namespaceId,
      workflowRunId: claimed.id,
    });
    expect(rescheduled?.status).toBe("pending");
    expect(rescheduled?.error).toEqual({ message: "boom" });
  });

  test("listWorkflowDefinitions returns registered workflows", () => {
    const namespaceId = randomUUID();
    const client = new OpenWorkflow({ backend, namespaceId });

    client.defineWorkflow({ name: "first" }, noopFn);
    client.defineWorkflow({ name: "second" }, noopFn);

    const definitions = client.listWorkflowDefinitions();
    expect(definitions).toHaveLength(2);
    expect(definitions.map((def) => def.name)).toEqual(["first", "second"]);
  });
});

async function noopFn() {
  // no-op
}
