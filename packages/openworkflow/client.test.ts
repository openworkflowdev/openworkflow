import { BackendPostgres } from "../backend-postgres/backend.js";
import { DEFAULT_POSTGRES_URL } from "../backend-postgres/postgres.js";
import { createClient, declareWorkflow, OpenWorkflow } from "./client.js";
import * as configModule from "./config.js";
import { type as arkType } from "arktype";
import { randomUUID } from "node:crypto";
import * as v from "valibot";
import { describe, expect, test, vi } from "vitest";
import {
  number as yupNumber,
  object as yupObject,
  string as yupString,
} from "yup";
import { z } from "zod";

describe("OpenWorkflow", () => {
  test("enqueues workflow runs via backend", async () => {
    const backend = await createBackend();
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

  describe("schema validation", () => {
    describe("Zod schema", () => {
      const schema = z.object({
        userId: z.uuid(),
        count: z.number().int().positive(),
      });

      test("accepts valid input", async () => {
        const backend = await createBackend();
        const client = new OpenWorkflow({ backend });
        const workflow = client.defineWorkflow(
          { name: "schema-zod-valid", schema },
          noopFn,
        );

        const handle = await workflow.run({
          userId: randomUUID(),
          count: 3,
        });

        await handle.cancel();
      });

      test("rejects invalid input", async () => {
        const backend = await createBackend();
        const client = new OpenWorkflow({ backend });
        const workflow = client.defineWorkflow(
          { name: "schema-zod-invalid", schema },
          noopFn,
        );

        await expect(
          workflow.run({ userId: "not-a-uuid", count: 0 } as never),
        ).rejects.toThrow();
      });
    });

    describe("ArkType schema", () => {
      const schema = arkType({
        name: "string",
        platform: "'android' | 'ios'",
      });

      test("accepts valid input", async () => {
        const backend = await createBackend();
        const client = new OpenWorkflow({ backend });
        const workflow = client.defineWorkflow(
          { name: "schema-arktype-valid", schema },
          noopFn,
        );

        const handle = await workflow.run({
          name: "Riley",
          platform: "android",
        });

        await handle.cancel();
      });

      test("rejects invalid input", async () => {
        const backend = await createBackend();
        const client = new OpenWorkflow({ backend });
        const workflow = client.defineWorkflow(
          { name: "schema-arktype-invalid", schema },
          noopFn,
        );

        await expect(
          workflow.run({ name: "Riley", platform: "web" } as never),
        ).rejects.toThrow();
      });
    });

    describe("Valibot schema", () => {
      const schema = v.object({
        key1: v.string(),
        key2: v.number(),
      });

      test("accepts valid input", async () => {
        const backend = await createBackend();
        const client = new OpenWorkflow({ backend });
        const workflow = client.defineWorkflow(
          { name: "schema-valibot-valid", schema },
          noopFn,
        );

        const handle = await workflow.run({
          key1: "value",
          key2: 42,
        });

        await handle.cancel();
      });

      test("rejects invalid input", async () => {
        const backend = await createBackend();
        const client = new OpenWorkflow({ backend });
        const workflow = client.defineWorkflow(
          { name: "schema-valibot-invalid", schema },
          noopFn,
        );

        await expect(
          workflow.run({ key1: "value", key2: "oops" } as never),
        ).rejects.toThrow();
      });
    });

    describe("Yup schema", () => {
      const schema = yupObject({
        name: yupString().required(),
        age: yupNumber().required().integer().positive(),
      });

      test("accepts valid input", async () => {
        const backend = await createBackend();
        const client = new OpenWorkflow({ backend });
        const workflow = client.defineWorkflow(
          { name: "schema-yup-valid", schema },
          noopFn,
        );

        const handle = await workflow.run({
          name: "Mona",
          age: 32,
        });

        await handle.cancel();
      });

      test("rejects invalid input", async () => {
        const backend = await createBackend();
        const client = new OpenWorkflow({ backend });
        const workflow = client.defineWorkflow(
          { name: "schema-yup-invalid", schema },
          noopFn,
        );

        await expect(
          workflow.run({ name: "Mona", age: -10 } as never),
        ).rejects.toThrow();
      });
    });
  });

  test("result resolves when workflow succeeds", async () => {
    const backend = await createBackend();
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

    await backend.completeWorkflowRun({
      workflowRunId: claimed.id,
      workerId,
      output: { ok: true },
    });

    // eslint-disable-next-line @typescript-eslint/no-confusing-void-expression
    const result = await handle.result();
    expect(result).toEqual({ ok: true });
  });

  test("result rejects when workflow fails", async () => {
    const backend = await createBackend();
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
    await backend.failWorkflowRun({
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
    const backend = await createBackend();
    const client = new OpenWorkflow({ backend });

    const workflow = client.defineWorkflow({ name: "deadline-test" }, noopFn);
    const deadline = new Date(Date.now() + 60_000); // in 1 minute
    const handle = await workflow.run({ value: 1 }, { deadlineAt: deadline });

    expect(handle.workflowRun.deadlineAt).not.toBeNull();
    expect(handle.workflowRun.deadlineAt?.getTime()).toBe(deadline.getTime());
  });

  test("creates workflow run with version", async () => {
    const backend = await createBackend();
    const client = new OpenWorkflow({ backend });

    const workflow = client.defineWorkflow(
      { name: "versioned-test", version: "v2.0" },
      noopFn,
    );
    const handle = await workflow.run({ value: 1 });

    expect(handle.workflowRun.version).toBe("v2.0");
  });

  test("creates workflow run without version", async () => {
    const backend = await createBackend();
    const client = new OpenWorkflow({ backend });

    const workflow = client.defineWorkflow(
      { name: "unversioned-test" },
      noopFn,
    );
    const handle = await workflow.run({ value: 1 });

    expect(handle.workflowRun.version).toBeNull();
  });

  test("cancels workflow run via handle", async () => {
    const backend = await createBackend();
    const client = new OpenWorkflow({ backend });

    const workflow = client.defineWorkflow({ name: "cancel-test" }, noopFn);
    const handle = await workflow.run({ value: 1 });

    await handle.cancel();

    const workflowRun = await backend.getWorkflowRun({
      workflowRunId: handle.workflowRun.id,
    });
    expect(workflowRun?.status).toBe("canceled");
    expect(workflowRun?.finishedAt).not.toBeNull();
  });

  describe("declareWorkflow / implementWorkflow API", () => {
    test("declareWorkflow returns a spec that can be used to schedule runs", async () => {
      const backend = await createBackend();
      const client = new OpenWorkflow({ backend });

      const spec = declareWorkflow({ name: "declare-test" });

      const handle = await client.runWorkflow(spec, { message: "hello" });
      expect(handle.workflowRun.workflowName).toBe("declare-test");

      await handle.cancel();
    });

    test("implementWorkflow registers the workflow for worker execution", async () => {
      const backend = await createBackend();
      const client = new OpenWorkflow({ backend });

      const spec = declareWorkflow({ name: "implement-test" });
      client.implementWorkflow(spec, ({ input }) => {
        return { received: input };
      });

      const handle = await client.runWorkflow(spec, { data: 42 });
      const worker = client.newWorker();
      await worker.tick();
      await sleep(100); // wait for background execution

      const result = await handle.result();
      expect(result).toEqual({ received: { data: 42 } });
    });

    test("implementWorkflow throws when workflow is already registered", async () => {
      const backend = await createBackend();
      const client = new OpenWorkflow({ backend });

      const spec = declareWorkflow({ name: "duplicate-test" });
      client.implementWorkflow(spec, noopFn);

      expect(() => {
        client.implementWorkflow(spec, noopFn);
      }).toThrow('Workflow "duplicate-test" is already registered');
    });

    test("implementWorkflow allows registering different versions of the same workflow", async () => {
      const backend = await createBackend();
      const client = new OpenWorkflow({ backend });

      const specV1 = declareWorkflow({
        name: "multi-version",
        version: "v1",
      });
      const specV2 = declareWorkflow({
        name: "multi-version",
        version: "v2",
      });

      // no throwing...
      client.implementWorkflow(specV1, noopFn);
      client.implementWorkflow(specV2, noopFn);
    });

    test("implementWorkflow throws for same name+version combination", async () => {
      const backend = await createBackend();
      const client = new OpenWorkflow({ backend });

      const spec1 = declareWorkflow({
        name: "version-duplicate",
        version: "v1",
      });
      const spec2 = declareWorkflow({
        name: "version-duplicate",
        version: "v1",
      });

      client.implementWorkflow(spec1, noopFn);

      expect(() => {
        client.implementWorkflow(spec2, noopFn);
      }).toThrow(
        'Workflow "version-duplicate" (version: v1) is already registered',
      );
    });

    test("declareWorkflow with schema validates input on runWorkflow", async () => {
      const backend = await createBackend();
      const client = new OpenWorkflow({ backend });

      const schema = z.object({
        email: z.email(),
      });
      const spec = declareWorkflow({
        name: "declare-schema-test",
        schema,
      });

      const handle = await client.runWorkflow(spec, {
        email: "test@example.com",
      });
      await handle.cancel();

      await expect(
        client.runWorkflow(spec, { email: "not-an-email" }),
      ).rejects.toThrow();
    });

    test("declareWorkflow with version sets version on workflow run", async () => {
      const backend = await createBackend();
      const client = new OpenWorkflow({ backend });

      const spec = declareWorkflow({
        name: "declare-version-test",
        version: "v1.2.3",
      });

      const handle = await client.runWorkflow(spec);
      expect(handle.workflowRun.version).toBe("v1.2.3");

      await handle.cancel();
    });

    test("defineWorkflow wraps declareWorkflow and implementWorkflow", async () => {
      const backend = await createBackend();
      const client = new OpenWorkflow({ backend });

      const workflow = client.defineWorkflow(
        { name: "define-wrap-test" },
        ({ input }) => ({ doubled: (input as { n: number }).n * 2 }),
      );

      const handle = await workflow.run({ n: 21 });
      const worker = client.newWorker();
      await worker.tick();
      await sleep(100); // wait for background execution

      const result = await handle.result();
      expect(result).toEqual({ doubled: 42 });
    });
  });
});

describe("createClient", () => {
  test("creates client from project config file", async () => {
    const mockBackend = await BackendPostgres.connect(DEFAULT_POSTGRES_URL, {
      namespaceId: randomUUID(),
    });

    vi.spyOn(configModule, "loadConfig").mockResolvedValueOnce({
      config: { backend: mockBackend },
      configFile: "/mock/openworkflow.config.js",
    });

    const client = await createClient();

    expect(client).toBeInstanceOf(OpenWorkflow);
  });
});

async function createBackend(): Promise<BackendPostgres> {
  return await BackendPostgres.connect(DEFAULT_POSTGRES_URL, {
    namespaceId: randomUUID(), // unique namespace per test
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function noopFn() {
  // no-op
}
