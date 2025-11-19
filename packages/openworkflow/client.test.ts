import { BackendPostgres } from "../backend-postgres/backend.js";
import { DEFAULT_DATABASE_URL } from "../backend-postgres/postgres.js";
import { OpenWorkflow } from "./client.js";
import { type as arkType } from "arktype";
import { randomUUID } from "node:crypto";
import * as v from "valibot";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import {
  number as yupNumber,
  object as yupObject,
  string as yupString,
} from "yup";
import { z } from "zod";

describe("OpenWorkflow", () => {
  let backend: BackendPostgres;

  beforeAll(async () => {
    backend = await BackendPostgres.connect(DEFAULT_DATABASE_URL, {
      namespaceId: randomUUID(),
    });
  });

  afterAll(async () => {
    await backend.stop();
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

  describe("schema validation", () => {
    describe("Zod schema", () => {
      const schema = z.object({
        userId: z.uuid(),
        count: z.number().int().positive(),
      });

      test("accepts valid input", async () => {
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

  test("creates workflow run with version", async () => {
    const client = new OpenWorkflow({ backend });

    const workflow = client.defineWorkflow(
      { name: "versioned-test", version: "v2.0" },
      noopFn,
    );
    const handle = await workflow.run({ value: 1 });

    expect(handle.workflowRun.version).toBe("v2.0");
  });

  test("creates workflow run without version", async () => {
    const client = new OpenWorkflow({ backend });

    const workflow = client.defineWorkflow(
      { name: "unversioned-test" },
      noopFn,
    );
    const handle = await workflow.run({ value: 1 });

    expect(handle.workflowRun.version).toBeNull();
  });

  test("cancels workflow run via handle", async () => {
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
});

async function noopFn() {
  // no-op
}
