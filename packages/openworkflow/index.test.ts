import { BackendPostgres } from "../backend-postgres/index.js";
import { DEFAULT_DATABASE_URL } from "../backend-postgres/postgres.js";
import { OpenWorkflow } from "./index.js";
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

describe("OpenWorkflow", () => {
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

  test("enqueues workflow runs via backend", async () => {
    const workflow = client.defineWorkflow("enqueue-test", noopFn);
    await workflow.run({
      input: { docUrl: "https://example.com" },
    });

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
    const workflow = client.defineWorkflow("result-success", noopFn);
    const handle = await workflow.run({ input: { value: 1 } });

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
    const workflow = client.defineWorkflow("result-failure", noopFn);
    const handle = await workflow.run({ input: { value: 1 } });

    const workerId = "test-worker";
    const claimed = await backend.claimWorkflowRun({
      namespaceId,
      workerId,
      leaseDurationMs: 1000,
    });
    expect(claimed).not.toBeNull();
    if (!claimed) throw new Error("workflow run was not claimed");

    await backend.markWorkflowRunFailed({
      namespaceId,
      workflowRunId: claimed.id,
      workerId,
      error: { message: "boom" },
    });

    await expect(handle.result()).rejects.toThrow(
      "Workflow result-failure failed",
    );
  });

  test("listWorkflowDefinitions returns registered workflows", () => {
    client.defineWorkflow("first", noopFn);
    client.defineWorkflow("second", noopFn);

    const definitions = client.listWorkflowDefinitions();
    expect(definitions).toHaveLength(2);
    expect(definitions.map((def) => def.name)).toEqual(["first", "second"]);
  });
});

async function noopFn() {
  // no-op
}
