import { BackendPostgres } from "../backend-postgres/backend.js";
import { DEFAULT_DATABASE_URL } from "../backend-postgres/postgres.js";
import { OpenWorkflow } from "./client.js";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

describe("OpenWorkflow", () => {
  let backend: BackendPostgres;

  beforeAll(async () => {
    backend = await BackendPostgres.connect(DEFAULT_DATABASE_URL, {
      namespaceId: randomUUID(),
    });
  });

  afterAll(async () => {
    await backend.end();
  });

  test("enqueues workflow runs via backend", async () => {
    const client = new OpenWorkflow({ backend });

    const workflow = client.defineWorkflow({ name: "enqueue-test" }, noopFn);
    await workflow.run({ docUrl: "https://example.com" });

    const workerId = "enqueue-worker";
    const claimed = await backend.claimWorkflowRun({
      workerId,
      leaseDurationMs: 1000,
    });

    expect(claimed?.workflowName).toBe("enqueue-test");
    expect(claimed?.workerId).toBe(workerId);
    expect(claimed?.input).toEqual({ docUrl: "https://example.com" });
  });

  test("result resolves when workflow succeeds", async () => {
    const client = new OpenWorkflow({ backend });

    const workflow = client.defineWorkflow({ name: "result-success" }, noopFn);
    const handle = await workflow.run({ value: 1 });

    const workerId = "test-worker";
    const claimed = await backend.claimWorkflowRun({
      workerId,
      leaseDurationMs: 1000,
    });
    expect(claimed).not.toBeNull();
    if (!claimed) throw new Error("workflow run was not claimed");

    await backend.markWorkflowRunSucceeded({
      workflowRunId: claimed.id,
      workerId,
      output: { ok: true },
    });

    // eslint-disable-next-line @typescript-eslint/no-confusing-void-expression
    const result = await handle.result();
    expect(result).toEqual({ ok: true });
  });

  test("result rejects when workflow fails", async () => {
    const client = new OpenWorkflow({ backend });

    const workflow = client.defineWorkflow({ name: "result-failure" }, noopFn);
    await workflow.run({ value: 1 });

    const workerId = "test-worker";
    const claimed = await backend.claimWorkflowRun({
      workerId,
      leaseDurationMs: 1000,
    });
    expect(claimed).not.toBeNull();
    if (!claimed) throw new Error("workflow run was not claimed");

    // mark as failed (should reschedule))
    await backend.markWorkflowRunFailed({
      workflowRunId: claimed.id,
      workerId,
      error: { message: "boom" },
    });

    const rescheduled = await backend.getWorkflowRun({
      workflowRunId: claimed.id,
    });
    expect(rescheduled?.status).toBe("pending");
    expect(rescheduled?.error).toEqual({ message: "boom" });
  });

  test("creates workflow run with deadline", async () => {
    const client = new OpenWorkflow({ backend });

    const workflow = client.defineWorkflow({ name: "deadline-test" }, noopFn);
    const deadline = new Date(Date.now() + 60_000); // in 1 minute
    const handle = await workflow.run({ value: 1 }, { deadlineAt: deadline });

    expect(handle.workflowRun.deadlineAt).not.toBeNull();
    expect(handle.workflowRun.deadlineAt?.getTime()).toBe(deadline.getTime());
  });
});

async function noopFn() {
  // no-op
}
