import { WorkflowRun } from "../backend/index.js";
import { BackendPostgres } from "./index.js";
import { DEFAULT_DATABASE_URL } from "./postgres.js";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

describe("BackendPostgres", () => {
  let backend: BackendPostgres;

  beforeAll(() => {
    backend = new BackendPostgres(DEFAULT_DATABASE_URL);
  });

  afterAll(async () => {
    await backend.end();
  });

  describe("createWorkflowRun()", () => {
    test("creates a workflow run", async () => {
      const expected: WorkflowRun = {
        namespaceId: randomUUID(),
        id: "", // -
        workflowName: randomUUID(),
        version: randomUUID(),
        status: "pending",
        idempotencyKey: randomUUID(),
        context: { key: "val" },
        input: { key: "val" },
        output: null,
        error: null,
        attempts: 0,
        parentStepRunNamespaceId: null,
        parentStepRunId: null,
        workerId: null,
        availableAt: newDateInOneYear(), // -
        startedAt: null,
        finishedAt: null,
        createdAt: new Date(), // -
        updatedAt: new Date(), // -
      };

      // Create with all fields
      const created = await backend.createWorkflowRun({
        namespaceId: expected.namespaceId,
        workflowName: expected.workflowName,
        version: expected.version,
        idempotencyKey: expected.idempotencyKey,
        input: expected.input,
        context: expected.context,
        availableAt: expected.availableAt,
      });
      expect(created.id).toHaveLength(36);
      expect(deltaSeconds(created.availableAt)).toBeGreaterThan(1);
      expect(deltaSeconds(created.createdAt)).toBeLessThan(1);
      expect(deltaSeconds(created.updatedAt)).toBeLessThan(1);

      expected.id = created.id;
      expected.availableAt = created.availableAt;
      expected.createdAt = created.createdAt;
      expected.updatedAt = created.updatedAt;
      expect(created).toEqual(expected);

      // Create with minimal fields
      const createdMin = await backend.createWorkflowRun({
        namespaceId: expected.namespaceId,
        workflowName: expected.workflowName,
        version: null,
        idempotencyKey: null,
        input: null,
        context: null,
        availableAt: null,
      });
      expect(createdMin.version).toBeNull();
      expect(createdMin.idempotencyKey).toBeNull();
      expect(createdMin.input).toBeNull();
      expect(createdMin.context).toBeNull();
      expect(deltaSeconds(createdMin.availableAt)).toBeLessThan(1); // defaults to NOW()
    });
  });

  describe("claimWorkflowRun()", () => {
    test("claims workflow runs and respects leases, reclaiming if lease expires", async () => {
      const namespaceId = randomUUID();
      await createPendingWorkflowRun(backend, namespaceId);

      const firstLeaseMs = 30;
      const firstWorker = randomUUID();
      const claimed = await backend.claimWorkflowRun({
        namespaceId,
        workerId: firstWorker,
        leaseDurationMs: firstLeaseMs,
      });
      expect(claimed?.status).toBe("running");
      expect(claimed?.workerId).toBe(firstWorker);
      expect(claimed?.attempts).toBe(1);
      expect(claimed?.startedAt).not.toBeNull();

      const secondWorker = randomUUID();
      const blocked = await backend.claimWorkflowRun({
        namespaceId,
        workerId: secondWorker,
        leaseDurationMs: 10,
      });
      expect(blocked).toBeNull();

      await sleep(firstLeaseMs);

      const reclaimed = await backend.claimWorkflowRun({
        namespaceId,
        workerId: secondWorker,
        leaseDurationMs: 10,
      });
      expect(reclaimed?.id).toBe(claimed?.id);
      expect(reclaimed?.attempts).toBe(2);
      expect(reclaimed?.workerId).toBe(secondWorker);
      expect(reclaimed?.startedAt?.getTime()).toBe(
        claimed?.startedAt?.getTime(),
      );
    });

    test("returns null when no workflow runs are available", async () => {
      const claimed = await backend.claimWorkflowRun({
        namespaceId: randomUUID(),
        workerId: randomUUID(),
        leaseDurationMs: 10,
      });
      expect(claimed).toBeNull();
    });
  });

  describe("heartbeatWorkflowRun()", () => {
    test("extends the lease for running workflow runs", async () => {
      const namespaceId = randomUUID();
      const workerId = randomUUID();
      await createPendingWorkflowRun(backend, namespaceId);

      const claimed = await backend.claimWorkflowRun({
        namespaceId,
        workerId,
        leaseDurationMs: 20,
      });
      if (!claimed) throw new Error("Expected workflow run to be claimed"); // for type narrowing

      const previousExpiry = claimed.availableAt;
      await backend.heartbeatWorkflowRun({
        namespaceId,
        workflowRunId: claimed.id,
        workerId,
        leaseDurationMs: 200,
      });

      const refreshed = await backend.getWorkflowRun({
        namespaceId,
        workflowRunId: claimed.id,
      });

      expect(refreshed?.availableAt?.getTime()).toBeGreaterThan(
        previousExpiry?.getTime() ?? Infinity,
      );
    });
  });

  describe("markWorkflowRunSucceeded()", () => {
    test("marks running workflow runs as succeeded", async () => {
      const namespaceId = randomUUID();
      const workerId = randomUUID();
      await createPendingWorkflowRun(backend, namespaceId);

      const claimed = await backend.claimWorkflowRun({
        namespaceId,
        workerId,
        leaseDurationMs: 20,
      });
      if (!claimed) throw new Error("Expected workflow run to be claimed"); // for type narrowing

      const output = { ok: true };
      await backend.markWorkflowRunSucceeded({
        namespaceId,
        workflowRunId: claimed.id,
        workerId,
        output,
      });

      const finished = await backend.getWorkflowRun({
        namespaceId,
        workflowRunId: claimed.id,
      });
      expect(finished?.status).toBe("succeeded");
      expect(finished?.output).toEqual(output);
      expect(finished?.error).toBeNull();
      expect(finished?.finishedAt).not.toBeNull();
      expect(finished?.availableAt).toBeNull();
    });
  });

  describe("markWorkflowRunFailed()", () => {
    test("marks running workflow runs as failed", async () => {
      const namespaceId = randomUUID();
      const workerId = randomUUID();
      await createPendingWorkflowRun(backend, namespaceId);

      const claimed = await backend.claimWorkflowRun({
        namespaceId,
        workerId,
        leaseDurationMs: 20,
      });
      if (!claimed) throw new Error("Expected workflow run to be claimed");

      const error = { message: "boom" };
      await backend.markWorkflowRunFailed({
        namespaceId,
        workflowRunId: claimed.id,
        workerId,
        error,
      });

      const finished = await backend.getWorkflowRun({
        namespaceId,
        workflowRunId: claimed.id,
      });
      expect(finished?.status).toBe("failed");
      expect(finished?.error).toEqual(error);
      expect(finished?.output).toBeNull();
      expect(finished?.finishedAt).not.toBeNull();
      expect(finished?.availableAt).toBeNull();
    });
  });

  describe("createStepRun()", () => {
    test("creates step runs and bumps attempts for retries", async () => {
      const claimed = await createClaimedWorkflowRun(backend);
      const stepName = randomUUID();

      const created = await backend.createStepRun({
        namespaceId: claimed.namespaceId,
        workflowRunId: claimed.id,
        workerId: claimed.workerId!, // eslint-disable-line @typescript-eslint/no-non-null-assertion
        stepName,
        kind: "activity",
      });
      expect(created.status).toBe("running");
      expect(created.attempts).toBe(1);
      expect(created.finishedAt).toBeNull();

      const retried = await backend.createStepRun({
        namespaceId: claimed.namespaceId,
        workflowRunId: claimed.id,
        workerId: claimed.workerId!, // eslint-disable-line @typescript-eslint/no-non-null-assertion
        stepName,
        kind: "activity",
      });
      expect(retried.id).toBe(created.id);
      expect(retried.attempts).toBe(2);
      expect(retried.status).toBe("running");
      expect(retried.startedAt?.getTime()).toBeGreaterThan(
        created.startedAt?.getTime() ?? 0,
      );
    });

    test("throws when worker does not own the workflow run", async () => {
      const { namespaceId, id: workflowRunId } =
        await createClaimedWorkflowRun(backend);

      await expect(
        backend.createStepRun({
          namespaceId,
          workflowRunId,
          workerId: randomUUID(),
          stepName: randomUUID(),
          kind: "activity",
        }),
      ).rejects.toThrow("Failed to create step run");
    });
  });

  describe("listStepRuns()", () => {
    test("lists step runs ordered by creation time", async () => {
      const claimed = await createClaimedWorkflowRun(backend);

      const first = await backend.createStepRun({
        namespaceId: claimed.namespaceId,
        workflowRunId: claimed.id,
        workerId: claimed.workerId!, // eslint-disable-line @typescript-eslint/no-non-null-assertion
        stepName: randomUUID(),
        kind: "activity",
      });
      await backend.markStepRunSucceeded({
        namespaceId: claimed.namespaceId,
        workflowRunId: claimed.id,
        stepRunId: first.id,
        workerId: claimed.workerId!, // eslint-disable-line @typescript-eslint/no-non-null-assertion,
        output: { ok: true },
      });

      const second = await backend.createStepRun({
        namespaceId: claimed.namespaceId,
        workflowRunId: claimed.id,
        workerId: claimed.workerId!, // eslint-disable-line @typescript-eslint/no-non-null-assertion
        stepName: randomUUID(),
        kind: "activity",
      });

      const listed = await backend.listStepRuns({
        namespaceId: claimed.namespaceId,
        workflowRunId: claimed.id,
      });
      expect(listed.map((step) => step.stepName)).toEqual([
        first.stepName,
        second.stepName,
      ]);
    });
  });

  describe("getStepRun()", () => {
    test("returns a persisted step run", async () => {
      const claimed = await createClaimedWorkflowRun(backend);

      const created = await backend.createStepRun({
        namespaceId: claimed.namespaceId,
        workflowRunId: claimed.id,
        workerId: claimed.workerId!, // eslint-disable-line @typescript-eslint/no-non-null-assertion
        stepName: randomUUID(),
        kind: "activity",
      });

      const got = await backend.getStepRun({
        namespaceId: claimed.namespaceId,
        stepRunId: created.id,
      });
      expect(got).toEqual(created);
    });
  });

  describe("markStepRunSucceeded()", () => {
    test("marks running step runs as succeeded", async () => {
      const claimed = await createClaimedWorkflowRun(backend);

      const created = await backend.createStepRun({
        namespaceId: claimed.namespaceId,
        workflowRunId: claimed.id,
        workerId: claimed.workerId!, // eslint-disable-line @typescript-eslint/no-non-null-assertion
        stepName: randomUUID(),
        kind: "activity",
      });
      const output = { foo: "bar" };

      await backend.markStepRunSucceeded({
        namespaceId: claimed.namespaceId,
        workflowRunId: claimed.id,
        stepRunId: created.id,
        workerId: claimed.workerId!, // eslint-disable-line @typescript-eslint/no-non-null-assertion
        output,
      });

      const succeeded = await backend.getStepRun({
        namespaceId: claimed.namespaceId,
        stepRunId: created.id,
      });
      expect(succeeded?.status).toBe("succeeded");
      expect(succeeded?.output).toEqual(output);
      expect(succeeded?.error).toBeNull();
      expect(succeeded?.finishedAt).not.toBeNull();
    });
  });

  describe("markStepRunFailed()", () => {
    test("marks running step runs as failed", async () => {
      const claimed = await createClaimedWorkflowRun(backend);

      const created = await backend.createStepRun({
        namespaceId: claimed.namespaceId,
        workflowRunId: claimed.id,
        workerId: claimed.workerId!, // eslint-disable-line @typescript-eslint/no-non-null-assertion
        stepName: randomUUID(),
        kind: "activity",
      });
      const error = { message: "nope" };

      await backend.markStepRunFailed({
        namespaceId: claimed.namespaceId,
        workflowRunId: claimed.id,
        stepRunId: created.id,
        workerId: claimed.workerId!, // eslint-disable-line @typescript-eslint/no-non-null-assertion
        error,
      });

      const failed = await backend.getStepRun({
        namespaceId: claimed.namespaceId,
        stepRunId: created.id,
      });
      expect(failed?.status).toBe("failed");
      expect(failed?.error).toEqual(error);
      expect(failed?.output).toBeNull();
      expect(failed?.finishedAt).not.toBeNull();
    });
  });
});

function deltaSeconds(date: Date | null | undefined): number {
  if (!date) return Infinity;
  return Math.abs((Date.now() - date.getTime()) / 1000);
}

function newDateInOneYear() {
  const d = new Date();
  d.setFullYear(d.getFullYear() + 1);
  return d;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function createPendingWorkflowRun(
  backend: BackendPostgres,
  namespaceId: string,
) {
  return await backend.createWorkflowRun({
    namespaceId,
    workflowName: randomUUID(),
    version: null,
    idempotencyKey: null,
    input: null,
    context: null,
    availableAt: null,
  });
}

async function createClaimedWorkflowRun(backend: BackendPostgres) {
  const namespaceId = randomUUID();
  await createPendingWorkflowRun(backend, namespaceId);

  const claimed = await backend.claimWorkflowRun({
    namespaceId,
    workerId: randomUUID(),
    leaseDurationMs: 100,
  });

  if (!claimed) throw new Error("Failed to claim workflow run");

  return claimed;
}
