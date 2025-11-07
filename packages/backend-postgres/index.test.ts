import { StepAttempt, WorkflowRun } from "../openworkflow/backend.js";
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
        config: { key: "val" },
        context: { key: "val" },
        input: { key: "val" },
        output: null,
        error: null,
        attempts: 0,
        parentStepAttemptNamespaceId: null,
        parentStepAttemptId: null,
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
        config: expected.config,
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
        config: {},
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

    test("prioritizes pending workflow runs over expired running ones", async () => {
      const namespaceId = randomUUID();

      const running = await createPendingWorkflowRun(backend, namespaceId);
      const runningClaim = await backend.claimWorkflowRun({
        namespaceId,
        workerId: "worker-running",
        leaseDurationMs: 5,
      });
      if (!runningClaim) throw new Error("expected claim");
      expect(runningClaim.id).toBe(running.id);

      await sleep(10); // wait for running's lease to expire

      // pending claimed first, even though running expired
      const pending = await createPendingWorkflowRun(backend, namespaceId);
      const claimedFirst = await backend.claimWorkflowRun({
        namespaceId,
        workerId: "worker-second",
        leaseDurationMs: 100,
      });
      expect(claimedFirst?.id).toBe(pending.id);

      // running claimed second
      const claimedSecond = await backend.claimWorkflowRun({
        namespaceId,
        workerId: "worker-third",
        leaseDurationMs: 100,
      });
      expect(claimedSecond?.id).toBe(running.id);
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
    test("reschedules workflow runs with exponential backoff on first failure", async () => {
      const namespaceId = randomUUID();
      const workerId = randomUUID();
      await createPendingWorkflowRun(backend, namespaceId);

      const claimed = await backend.claimWorkflowRun({
        namespaceId,
        workerId,
        leaseDurationMs: 20,
      });
      if (!claimed) throw new Error("Expected workflow run to be claimed");

      const beforeFailTime = Date.now();

      const error = { message: "boom" };
      await backend.markWorkflowRunFailed({
        namespaceId,
        workflowRunId: claimed.id,
        workerId,
        error,
      });

      const rescheduled = await backend.getWorkflowRun({
        namespaceId,
        workflowRunId: claimed.id,
      });

      // rescheduled, not permanently failed
      expect(rescheduled?.status).toBe("pending");
      expect(rescheduled?.error).toEqual(error);
      expect(rescheduled?.output).toBeNull();
      expect(rescheduled?.finishedAt).toBeNull();
      expect(rescheduled?.workerId).toBeNull();

      expect(rescheduled?.availableAt).not.toBeNull();
      if (!rescheduled?.availableAt) throw new Error("Expected availableAt");
      const delayMs = rescheduled.availableAt.getTime() - beforeFailTime;
      expect(delayMs).toBeGreaterThanOrEqual(900); // ~1s with some tolerance
      expect(delayMs).toBeLessThan(1500);
    });

    test("reschedules with increasing backoff on multiple failures (known slow test)", async () => {
      const namespaceId = randomUUID();
      await createPendingWorkflowRun(backend, namespaceId);

      // fail first attempt
      let workerId = randomUUID();
      let claimed = await backend.claimWorkflowRun({
        namespaceId,
        workerId,
        leaseDurationMs: 20,
      });
      if (!claimed) throw new Error("Expected workflow run to be claimed");
      expect(claimed.attempts).toBe(1);

      await backend.markWorkflowRunFailed({
        namespaceId,
        workflowRunId: claimed.id,
        workerId,
        error: { message: "first failure" },
      });

      await sleep(1100); // wait for first backoff (~1s)

      // fail second attempt
      workerId = randomUUID();
      claimed = await backend.claimWorkflowRun({
        namespaceId,
        workerId,
        leaseDurationMs: 20,
      });
      if (!claimed) throw new Error("Expected workflow run to be claimed");
      expect(claimed.attempts).toBe(2);

      const beforeSecondFail = Date.now();
      await backend.markWorkflowRunFailed({
        namespaceId,
        workflowRunId: claimed.id,
        workerId,
        error: { message: "second failure" },
      });

      const rescheduled = await backend.getWorkflowRun({
        namespaceId,
        workflowRunId: claimed.id,
      });
      expect(rescheduled?.status).toBe("pending");

      // second attempt should have ~2s backoff (1s * 2^1)
      if (!rescheduled?.availableAt) throw new Error("Expected availableAt");
      const delayMs = rescheduled.availableAt.getTime() - beforeSecondFail;
      expect(delayMs).toBeGreaterThanOrEqual(1900); // ~2s with some tolerance
      expect(delayMs).toBeLessThan(2500);
    });
  });

  describe("createStepAttempt()", () => {
    test("creates a step attempt", async () => {
      const workflowRun = await createClaimedWorkflowRun(backend);

      const expected: StepAttempt = {
        namespaceId: workflowRun.namespaceId,
        id: "", // -
        workflowRunId: workflowRun.id,
        stepName: randomUUID(),
        kind: "activity",
        status: "running",
        config: { key: "val" },
        context: { key: "val" },
        output: null,
        error: null,
        childWorkflowRunNamespaceId: null,
        childWorkflowRunId: null,
        startedAt: null,
        finishedAt: null,
        createdAt: new Date(), // -
        updatedAt: new Date(), // -
      };

      const created = await backend.createStepAttempt({
        namespaceId: expected.namespaceId,
        workflowRunId: expected.workflowRunId,
        workerId: workflowRun.workerId!, // eslint-disable-line @typescript-eslint/no-non-null-assertion
        stepName: expected.stepName,
        kind: expected.kind,
        config: expected.config,
        context: expected.context,
      });
      expect(created.id).toHaveLength(36);
      expect(deltaSeconds(created.startedAt)).toBeLessThan(1);
      expect(deltaSeconds(created.createdAt)).toBeLessThan(1);
      expect(deltaSeconds(created.updatedAt)).toBeLessThan(1);

      expected.id = created.id;
      expected.startedAt = created.startedAt;
      expected.createdAt = created.createdAt;
      expected.updatedAt = created.updatedAt;
      expect(created).toEqual(expected);
    });
  });

  describe("listStepAttempts()", () => {
    test("lists step attempts ordered by creation time", async () => {
      const claimed = await createClaimedWorkflowRun(backend);

      const first = await backend.createStepAttempt({
        namespaceId: claimed.namespaceId,
        workflowRunId: claimed.id,
        workerId: claimed.workerId!, // eslint-disable-line @typescript-eslint/no-non-null-assertion
        stepName: randomUUID(),
        kind: "activity",
        config: {},
        context: null,
      });
      await backend.markStepAttemptSucceeded({
        namespaceId: claimed.namespaceId,
        workflowRunId: claimed.id,
        stepAttemptId: first.id,
        workerId: claimed.workerId!, // eslint-disable-line @typescript-eslint/no-non-null-assertion,
        output: { ok: true },
      });

      const second = await backend.createStepAttempt({
        namespaceId: claimed.namespaceId,
        workflowRunId: claimed.id,
        workerId: claimed.workerId!, // eslint-disable-line @typescript-eslint/no-non-null-assertion
        stepName: randomUUID(),
        kind: "activity",
        config: {},
        context: null,
      });

      const listed = await backend.listStepAttempts({
        namespaceId: claimed.namespaceId,
        workflowRunId: claimed.id,
      });
      expect(listed.map((step) => step.stepName)).toEqual([
        first.stepName,
        second.stepName,
      ]);
    });
  });

  describe("getStepAttempt()", () => {
    test("returns a persisted step attempt", async () => {
      const claimed = await createClaimedWorkflowRun(backend);

      const created = await backend.createStepAttempt({
        namespaceId: claimed.namespaceId,
        workflowRunId: claimed.id,
        workerId: claimed.workerId!, // eslint-disable-line @typescript-eslint/no-non-null-assertion
        stepName: randomUUID(),
        kind: "activity",
        config: {},
        context: null,
      });

      const got = await backend.getStepAttempt({
        namespaceId: claimed.namespaceId,
        stepAttemptId: created.id,
      });
      expect(got).toEqual(created);
    });
  });

  describe("markStepAttemptSucceeded()", () => {
    test("marks running step attempts as succeeded", async () => {
      const claimed = await createClaimedWorkflowRun(backend);

      const created = await backend.createStepAttempt({
        namespaceId: claimed.namespaceId,
        workflowRunId: claimed.id,
        workerId: claimed.workerId!, // eslint-disable-line @typescript-eslint/no-non-null-assertion
        stepName: randomUUID(),
        kind: "activity",
        config: {},
        context: null,
      });
      const output = { foo: "bar" };

      await backend.markStepAttemptSucceeded({
        namespaceId: claimed.namespaceId,
        workflowRunId: claimed.id,
        stepAttemptId: created.id,
        workerId: claimed.workerId!, // eslint-disable-line @typescript-eslint/no-non-null-assertion
        output,
      });

      const succeeded = await backend.getStepAttempt({
        namespaceId: claimed.namespaceId,
        stepAttemptId: created.id,
      });
      expect(succeeded?.status).toBe("succeeded");
      expect(succeeded?.output).toEqual(output);
      expect(succeeded?.error).toBeNull();
      expect(succeeded?.finishedAt).not.toBeNull();
    });
  });

  describe("markStepAttemptFailed()", () => {
    test("marks running step attempts as failed", async () => {
      const claimed = await createClaimedWorkflowRun(backend);

      const created = await backend.createStepAttempt({
        namespaceId: claimed.namespaceId,
        workflowRunId: claimed.id,
        workerId: claimed.workerId!, // eslint-disable-line @typescript-eslint/no-non-null-assertion
        stepName: randomUUID(),
        kind: "activity",
        config: {},
        context: null,
      });
      const error = { message: "nope" };

      await backend.markStepAttemptFailed({
        namespaceId: claimed.namespaceId,
        workflowRunId: claimed.id,
        stepAttemptId: created.id,
        workerId: claimed.workerId!, // eslint-disable-line @typescript-eslint/no-non-null-assertion
        error,
      });

      const failed = await backend.getStepAttempt({
        namespaceId: claimed.namespaceId,
        stepAttemptId: created.id,
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
    config: {},
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
