import { randomUUID } from "node:crypto";
import type { Backend, StepAttempt, WorkflowRun } from "openworkflow/internal";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

/**
 * Options for the Backend test suite.
 */
export interface TestBackendOptions {
  /**
   * Creates a new isolated Backend instance.
   */
  setup: () => Promise<Backend>;
  /**
   * Cleans up a Backend instance.
   */
  teardown: (backend: Backend) => Promise<void>;
}

/**
 * Runs the Backend test suite.
 * @param options - Test suite options
 */
export function testBackend(options: TestBackendOptions): void {
  const { setup, teardown } = options;
  describe("Backend", () => {
    let backend: Backend;

    beforeAll(async () => {
      backend = await setup();
    });

    afterAll(async () => {
      await teardown(backend);
    });

    describe("createWorkflowRun()", () => {
      test("creates a workflow run", async () => {
        const expected: WorkflowRun = {
          namespaceId: "", // -
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
          deadlineAt: newDateInOneYear(),
          startedAt: null,
          finishedAt: null,
          createdAt: new Date(), // -
          updatedAt: new Date(), // -
        };

        // Create with all fields
        const created = await backend.createWorkflowRun({
          workflowName: expected.workflowName,
          version: expected.version,
          idempotencyKey: expected.idempotencyKey,
          input: expected.input,
          config: expected.config,
          context: expected.context,
          availableAt: expected.availableAt,
          deadlineAt: expected.deadlineAt,
        });
        expect(created.namespaceId).toHaveLength(36);
        expect(created.id).toHaveLength(36);
        expect(deltaSeconds(created.availableAt)).toBeGreaterThan(1);
        expect(deltaSeconds(created.createdAt)).toBeLessThan(1);
        expect(deltaSeconds(created.updatedAt)).toBeLessThan(1);

        expected.namespaceId = created.namespaceId;
        expected.id = created.id;
        expected.availableAt = created.availableAt;
        expected.createdAt = created.createdAt;
        expected.updatedAt = created.updatedAt;
        expect(created).toEqual(expected);

        // Create with minimal fields
        const createdMin = await backend.createWorkflowRun({
          workflowName: expected.workflowName,
          version: null,
          idempotencyKey: null,
          input: null,
          config: {},
          context: null,
          availableAt: null,
          deadlineAt: null,
        });
        expect(createdMin.version).toBeNull();
        expect(createdMin.idempotencyKey).toBeNull();
        expect(createdMin.input).toBeNull();
        expect(createdMin.context).toBeNull();
        expect(deltaSeconds(createdMin.availableAt)).toBeLessThan(1); // defaults to NOW()
        expect(createdMin.deadlineAt).toBeNull();
      });

      test("returns existing run when idempotency key matches", async () => {
        const workflowName = randomUUID();
        const idempotencyKey = randomUUID();

        // Create first run with idempotency key
        const first = await backend.createWorkflowRun({
          workflowName,
          version: null,
          idempotencyKey,
          input: { first: true },
          config: {},
          context: null,
          availableAt: null,
          deadlineAt: null,
        });

        // Create second run with same idempotency key - should return existing
        const second = await backend.createWorkflowRun({
          workflowName,
          version: null,
          idempotencyKey,
          input: { second: true }, 
          config: {},
          context: null,
          availableAt: null,
          deadlineAt: null,
        });

        // Should return the same run
        expect(second.id).toBe(first.id);
        expect(second.input).toEqual({ first: true }); 
      });

      test("creates new run when idempotency key differs", async () => {
        const workflowName = randomUUID();

        const first = await backend.createWorkflowRun({
          workflowName,
          version: null,
          idempotencyKey: randomUUID(),
          input: { first: true },
          config: {},
          context: null,
          availableAt: null,
          deadlineAt: null,
        });

        const second = await backend.createWorkflowRun({
          workflowName,
          version: null,
          idempotencyKey: randomUUID(), 
          input: { second: true },
          config: {},
          context: null,
          availableAt: null,
          deadlineAt: null,
        });

        expect(second.id).not.toBe(first.id);
      });

      test("same idempotency key with different workflow name creates new run", async () => {
        const idempotencyKey = randomUUID();

        const first = await backend.createWorkflowRun({
          workflowName: randomUUID(),
          version: null,
          idempotencyKey,
          input: null,
          config: {},
          context: null,
          availableAt: null,
          deadlineAt: null,
        });

        const second = await backend.createWorkflowRun({
          workflowName: randomUUID(), // different workflow
          version: null,
          idempotencyKey, // same key
          input: null,
          config: {},
          context: null,
          availableAt: null,
          deadlineAt: null,
        });

        expect(second.id).not.toBe(first.id);
      });

      test("null idempotency key always creates new runs", async () => {
        const workflowName = randomUUID();

        const first = await backend.createWorkflowRun({
          workflowName,
          version: null,
          idempotencyKey: null,
          input: null,
          config: {},
          context: null,
          availableAt: null,
          deadlineAt: null,
        });

        const second = await backend.createWorkflowRun({
          workflowName,
          version: null,
          idempotencyKey: null,
          input: null,
          config: {},
          context: null,
          availableAt: null,
          deadlineAt: null,
        });

        expect(second.id).not.toBe(first.id);
      });
    });

    describe("getWorkflowRunByIdempotencyKey()", () => {
      test("returns workflow run when idempotency key matches", async () => {
        const workflowName = randomUUID();
        const idempotencyKey = randomUUID();

        const created = await backend.createWorkflowRun({
          workflowName,
          version: null,
          idempotencyKey,
          input: { test: true },
          config: {},
          context: null,
          availableAt: null,
          deadlineAt: null,
        });

        const found = await backend.getWorkflowRunByIdempotencyKey({
          workflowName,
          idempotencyKey,
        });

        expect(found).not.toBeNull();
        expect(found?.id).toBe(created.id);
      });

      test("returns null when idempotency key does not match", async () => {
        const workflowName = randomUUID();

        await backend.createWorkflowRun({
          workflowName,
          version: null,
          idempotencyKey: randomUUID(),
          input: null,
          config: {},
          context: null,
          availableAt: null,
          deadlineAt: null,
        });

        const found = await backend.getWorkflowRunByIdempotencyKey({
          workflowName,
          idempotencyKey: randomUUID(), // different key
        });

        expect(found).toBeNull();
      });

      test("returns null when workflow name does not match", async () => {
        const idempotencyKey = randomUUID();

        await backend.createWorkflowRun({
          workflowName: randomUUID(),
          version: null,
          idempotencyKey,
          input: null,
          config: {},
          context: null,
          availableAt: null,
          deadlineAt: null,
        });

        const found = await backend.getWorkflowRunByIdempotencyKey({
          workflowName: randomUUID(), // different workflow
          idempotencyKey,
        });

        expect(found).toBeNull();
      });
    });

    describe("listWorkflowRuns()", () => {
      test("lists workflow runs ordered by creation time", async () => {
        const backend = await setup();
        const first = await createPendingWorkflowRun(backend);
        await sleep(10); // ensure timestamp difference
        const second = await createPendingWorkflowRun(backend);

        const listed = await backend.listWorkflowRuns({});
        const listedIds = listed.data.map((run) => run.id);
        expect(listedIds).toEqual([first.id, second.id]);
        await teardown(backend);
      });

      test("paginates workflow runs", async () => {
        const backend = await setup();
        const runs: WorkflowRun[] = [];
        for (let i = 0; i < 5; i++) {
          runs.push(await createPendingWorkflowRun(backend));
          await sleep(10);
        }

        // p1
        const page1 = await backend.listWorkflowRuns({ limit: 2 });
        expect(page1.data).toHaveLength(2);
        expect(page1.data[0]?.id).toBe(runs[0]?.id);
        expect(page1.data[1]?.id).toBe(runs[1]?.id);
        expect(page1.pagination.next).not.toBeNull();
        expect(page1.pagination.prev).toBeNull();

        // p2
        const page2 = await backend.listWorkflowRuns({
          limit: 2,
          after: page1.pagination.next!, // eslint-disable-line @typescript-eslint/no-non-null-assertion
        });
        expect(page2.data).toHaveLength(2);
        expect(page2.data[0]?.id).toBe(runs[2]?.id);
        expect(page2.data[1]?.id).toBe(runs[3]?.id);
        expect(page2.pagination.next).not.toBeNull();
        expect(page2.pagination.prev).not.toBeNull();

        // p3
        const page3 = await backend.listWorkflowRuns({
          limit: 2,
          after: page2.pagination.next!, // eslint-disable-line @typescript-eslint/no-non-null-assertion
        });
        expect(page3.data).toHaveLength(1);
        expect(page3.data[0]?.id).toBe(runs[4]?.id);
        expect(page3.pagination.next).toBeNull();
        expect(page3.pagination.prev).not.toBeNull();

        // p2 again
        const page2Back = await backend.listWorkflowRuns({
          limit: 2,
          before: page3.pagination.prev!, // eslint-disable-line @typescript-eslint/no-non-null-assertion
        });
        expect(page2Back.data).toHaveLength(2);
        expect(page2Back.data[0]?.id).toBe(runs[2]?.id);
        expect(page2Back.data[1]?.id).toBe(runs[3]?.id);
        expect(page2Back.pagination.next).toEqual(page2.pagination.next);
        expect(page2Back.pagination.prev).toEqual(page2.pagination.prev);
        await teardown(backend);
      });

      test("handles empty results", async () => {
        const backend = await setup();
        const listed = await backend.listWorkflowRuns({});
        expect(listed.data).toHaveLength(0);
        expect(listed.pagination.next).toBeNull();
        expect(listed.pagination.prev).toBeNull();
        await teardown(backend);
      });

      test("paginates correctly with id as tiebreaker when multiple items have the same created_at timestamp", async () => {
        const backend = await setup();

        const runs: WorkflowRun[] = [];
        for (let i = 0; i < 5; i++) {
          runs.push(await createPendingWorkflowRun(backend));
        }

        runs.sort((a, b) => {
          const timeDiff = a.createdAt.getTime() - b.createdAt.getTime();
          if (timeDiff !== 0) return timeDiff;
          return a.id.localeCompare(b.id);
        });

        const page1 = await backend.listWorkflowRuns({ limit: 2 });
        expect(page1.data).toHaveLength(2);
        expect(page1.data[0]?.id).toBe(runs[0]?.id);
        expect(page1.data[1]?.id).toBe(runs[1]?.id);
        expect(page1.pagination.next).not.toBeNull();

        const page2 = await backend.listWorkflowRuns({
          limit: 2,
          after: page1.pagination.next!, // eslint-disable-line @typescript-eslint/no-non-null-assertion
        });
        expect(page2.data).toHaveLength(2);
        expect(page2.data[0]?.id).toBe(runs[2]?.id);
        expect(page2.data[1]?.id).toBe(runs[3]?.id);
        expect(page2.pagination.next).not.toBeNull();

        const page3 = await backend.listWorkflowRuns({
          limit: 2,
          after: page2.pagination.next!, // eslint-disable-line @typescript-eslint/no-non-null-assertion
        });
        expect(page3.data).toHaveLength(1);
        expect(page3.data[0]?.id).toBe(runs[4]?.id);
        expect(page3.pagination.next).toBeNull();

        const page2Back = await backend.listWorkflowRuns({
          limit: 2,
          before: page3.pagination.prev!, // eslint-disable-line @typescript-eslint/no-non-null-assertion
        });
        expect(page2Back.data).toHaveLength(2);
        expect(page2Back.data[0]?.id).toBe(runs[2]?.id);
        expect(page2Back.data[1]?.id).toBe(runs[3]?.id);

        await teardown(backend);
      });
    });

    describe("claimWorkflowRun()", () => {
      // because claims involve timing and leases, we create and teardown a new
      // namespaced backend instance for each test

      test("claims workflow runs and respects leases, reclaiming if lease expires", async () => {
        const backend = await setup();

        await createPendingWorkflowRun(backend);

        const firstLeaseMs = 30;
        const firstWorker = randomUUID();
        const claimed = await backend.claimWorkflowRun({
          workerId: firstWorker,
          leaseDurationMs: firstLeaseMs,
        });
        expect(claimed?.status).toBe("running");
        expect(claimed?.workerId).toBe(firstWorker);
        expect(claimed?.attempts).toBe(1);
        expect(claimed?.startedAt).not.toBeNull();

        const secondWorker = randomUUID();
        const blocked = await backend.claimWorkflowRun({
          workerId: secondWorker,
          leaseDurationMs: 10,
        });
        expect(blocked).toBeNull();

        await sleep(firstLeaseMs + 5); // small buffer for timing variability

        const reclaimed = await backend.claimWorkflowRun({
          workerId: secondWorker,
          leaseDurationMs: 10,
        });
        expect(reclaimed?.id).toBe(claimed?.id);
        expect(reclaimed?.attempts).toBe(2);
        expect(reclaimed?.workerId).toBe(secondWorker);
        expect(reclaimed?.startedAt?.getTime()).toBe(
          claimed?.startedAt?.getTime(),
        );

        await teardown(backend);
      });

      test("prioritizes pending workflow runs over expired running ones", async () => {
        const backend = await setup();

        const running = await createPendingWorkflowRun(backend);
        const runningClaim = await backend.claimWorkflowRun({
          workerId: "worker-running",
          leaseDurationMs: 5,
        });
        if (!runningClaim) throw new Error("expected claim");
        expect(runningClaim.id).toBe(running.id);

        await sleep(10); // wait for running's lease to expire

        // pending claimed first, even though running expired
        const pending = await createPendingWorkflowRun(backend);
        const claimedFirst = await backend.claimWorkflowRun({
          workerId: "worker-second",
          leaseDurationMs: 100,
        });
        expect(claimedFirst?.id).toBe(pending.id);

        // running claimed second
        const claimedSecond = await backend.claimWorkflowRun({
          workerId: "worker-third",
          leaseDurationMs: 100,
        });
        expect(claimedSecond?.id).toBe(running.id);

        await teardown(backend);
      });

      test("returns null when no workflow runs are available", async () => {
        const backend = await setup();

        const claimed = await backend.claimWorkflowRun({
          workerId: randomUUID(),
          leaseDurationMs: 10,
        });
        expect(claimed).toBeNull();

        await teardown(backend);
      });
    });

    describe("extendWorkflowRunLease()", () => {
      test("extends the lease for running workflow runs", async () => {
        const workerId = randomUUID();
        await createPendingWorkflowRun(backend);

        const claimed = await backend.claimWorkflowRun({
          workerId,
          leaseDurationMs: 20,
        });
        if (!claimed) throw new Error("Expected workflow run to be claimed"); // for type narrowing

        const previousExpiry = claimed.availableAt;
        const extended = await backend.extendWorkflowRunLease({
          workflowRunId: claimed.id,
          workerId,
          leaseDurationMs: 200,
        });

        expect(extended.availableAt?.getTime()).toBeGreaterThan(
          previousExpiry?.getTime() ?? Infinity,
        );
      });
    });

    describe("sleepWorkflowRun()", () => {
      test("sets a running workflow to sleeping status until a future time", async () => {
        const workerId = randomUUID();
        await createPendingWorkflowRun(backend);

        const claimed = await backend.claimWorkflowRun({
          workerId,
          leaseDurationMs: 100,
        });
        if (!claimed) throw new Error("Expected workflow run to be claimed");

        const sleepUntil = new Date(Date.now() + 5000); // 5 seconds from now

        await backend.sleepWorkflowRun({
          workflowRunId: claimed.id,
          workerId,
          availableAt: sleepUntil,
        });

        const fetched = await backend.getWorkflowRun({
          workflowRunId: claimed.id,
        });

        expect(fetched).not.toBeNull();
        expect(fetched?.availableAt?.getTime()).toBe(sleepUntil.getTime());
        expect(fetched?.workerId).toBeNull();
        expect(fetched?.status).toBe("sleeping");
      });

      test("fails when trying to sleep a canceled workflow", async () => {
        const backend = await setup();

        // completed run
        let claimed = await createClaimedWorkflowRun(backend);
        await backend.completeWorkflowRun({
          workflowRunId: claimed.id,
          workerId: claimed.workerId ?? "",
          output: null,
        });
        await expect(
          backend.sleepWorkflowRun({
            workflowRunId: claimed.id,
            workerId: claimed.workerId ?? "",
            availableAt: new Date(Date.now() + 60_000),
          }),
        ).rejects.toThrow("Failed to sleep workflow run");

        // failed run
        claimed = await createClaimedWorkflowRun(backend);
        await backend.failWorkflowRun({
          workflowRunId: claimed.id,
          workerId: claimed.workerId ?? "",
          error: { message: "failed" },
        });
        await expect(
          backend.sleepWorkflowRun({
            workflowRunId: claimed.id,
            workerId: claimed.workerId ?? "",
            availableAt: new Date(Date.now() + 60_000),
          }),
        ).rejects.toThrow("Failed to sleep workflow run");

        // canceled run
        claimed = await createClaimedWorkflowRun(backend);
        await backend.cancelWorkflowRun({
          workflowRunId: claimed.id,
        });
        await expect(
          backend.sleepWorkflowRun({
            workflowRunId: claimed.id,
            workerId: claimed.workerId ?? "",
            availableAt: new Date(Date.now() + 60_000),
          }),
        ).rejects.toThrow("Failed to sleep workflow run");

        await teardown(backend);
      });
    });

    describe("completeWorkflowRun()", () => {
      test("marks running workflow runs as completed", async () => {
        const workerId = randomUUID();
        await createPendingWorkflowRun(backend);

        const claimed = await backend.claimWorkflowRun({
          workerId,
          leaseDurationMs: 20,
        });
        if (!claimed) throw new Error("Expected workflow run to be claimed"); // for type narrowing

        const output = { ok: true };
        const completed = await backend.completeWorkflowRun({
          workflowRunId: claimed.id,
          workerId,
          output,
        });

        expect(completed.status).toBe("completed");
        expect(completed.output).toEqual(output);
        expect(completed.error).toBeNull();
        expect(completed.finishedAt).not.toBeNull();
        expect(completed.availableAt).toBeNull();
      });
    });

    describe("failWorkflowRun()", () => {
      test("reschedules workflow runs with exponential backoff on first failure", async () => {
        const workerId = randomUUID();
        await createPendingWorkflowRun(backend);

        const claimed = await backend.claimWorkflowRun({
          workerId,
          leaseDurationMs: 20,
        });
        if (!claimed) throw new Error("Expected workflow run to be claimed");

        const beforeFailTime = Date.now();

        const error = { message: "boom" };
        const failed = await backend.failWorkflowRun({
          workflowRunId: claimed.id,
          workerId,
          error,
        });

        // rescheduled, not permanently failed
        expect(failed.status).toBe("pending");
        expect(failed.error).toEqual(error);
        expect(failed.output).toBeNull();
        expect(failed.finishedAt).toBeNull();
        expect(failed.workerId).toBeNull();
        expect(failed.startedAt).toBeNull(); // cleared on failure for retry

        expect(failed.availableAt).not.toBeNull();
        if (!failed.availableAt) throw new Error("Expected availableAt");
        const delayMs = failed.availableAt.getTime() - beforeFailTime;
        expect(delayMs).toBeGreaterThanOrEqual(900); // ~1s with some tolerance
        expect(delayMs).toBeLessThan(1500);
      });

      test("reschedules with increasing backoff on multiple failures", async () => {
        // this test needs isolated namespace
        const backend = await setup();

        await createPendingWorkflowRun(backend);

        // fail first attempt
        let workerId = randomUUID();
        let claimed = await backend.claimWorkflowRun({
          workerId,
          leaseDurationMs: 20,
        });
        if (!claimed) throw new Error("Expected workflow run to be claimed");
        expect(claimed.attempts).toBe(1);

        const firstFailed = await backend.failWorkflowRun({
          workflowRunId: claimed.id,
          workerId,
          error: { message: "first failure" },
        });

        expect(firstFailed.status).toBe("pending");

        await sleep(1100); // wait for first backoff (~1s)

        // fail second attempt
        workerId = randomUUID();
        claimed = await backend.claimWorkflowRun({
          workerId,
          leaseDurationMs: 20,
        });
        if (!claimed) throw new Error("Expected workflow run to be claimed");
        expect(claimed.attempts).toBe(2);

        const beforeSecondFail = Date.now();
        const secondFailed = await backend.failWorkflowRun({
          workflowRunId: claimed.id,
          workerId,
          error: { message: "second failure" },
        });

        expect(secondFailed.status).toBe("pending");

        // second attempt should have ~2s backoff (1s * 2^1)
        if (!secondFailed.availableAt) throw new Error("Expected availableAt");
        const delayMs = secondFailed.availableAt.getTime() - beforeSecondFail;
        expect(delayMs).toBeGreaterThanOrEqual(1900); // ~2s with some tolerance
        expect(delayMs).toBeLessThan(2500);

        await teardown(backend);
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
          kind: "function",
          status: "running",
          config: { key: "val" },
          context: null,
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

    describe("getStepAttempt()", () => {
      test("returns a persisted step attempt", async () => {
        const claimed = await createClaimedWorkflowRun(backend);

        const created = await backend.createStepAttempt({
          workflowRunId: claimed.id,
          workerId: claimed.workerId!, // eslint-disable-line @typescript-eslint/no-non-null-assertion
          stepName: randomUUID(),
          kind: "function",
          config: {},
          context: null,
        });

        const got = await backend.getStepAttempt({
          stepAttemptId: created.id,
        });
        expect(got).toEqual(created);
      });
    });

    describe("listStepAttempts()", () => {
      test("lists step attempts ordered by creation time", async () => {
        const claimed = await createClaimedWorkflowRun(backend);

        const first = await backend.createStepAttempt({
          workflowRunId: claimed.id,
          workerId: claimed.workerId!, // eslint-disable-line @typescript-eslint/no-non-null-assertion
          stepName: randomUUID(),
          kind: "function",
          config: {},
          context: null,
        });
        await backend.completeStepAttempt({
          workflowRunId: claimed.id,
          stepAttemptId: first.id,
          workerId: claimed.workerId!, // eslint-disable-line @typescript-eslint/no-non-null-assertion,
          output: { ok: true },
        });

        await sleep(10); // ensure timestamp difference

        const second = await backend.createStepAttempt({
          workflowRunId: claimed.id,
          workerId: claimed.workerId!, // eslint-disable-line @typescript-eslint/no-non-null-assertion
          stepName: randomUUID(),
          kind: "function",
          config: {},
          context: null,
        });

        const listed = await backend.listStepAttempts({
          workflowRunId: claimed.id,
        });
        const listedStepNames = listed.data.map((step) => step.stepName);
        expect(listedStepNames).toEqual([first.stepName, second.stepName]);
      });

      test("paginates step attempts", async () => {
        const claimed = await createClaimedWorkflowRun(backend);

        for (let i = 0; i < 5; i++) {
          await backend.createStepAttempt({
            workflowRunId: claimed.id,
            workerId: claimed.workerId!, // eslint-disable-line @typescript-eslint/no-non-null-assertion
            stepName: `step-${String(i)}`,
            kind: "function",
            config: {},
            context: null,
          });

          await sleep(10); // ensure createdAt differs
        }

        // p1
        const page1 = await backend.listStepAttempts({
          workflowRunId: claimed.id,
          limit: 2,
        });
        expect(page1.data).toHaveLength(2);
        expect(page1.data[0]?.stepName).toBe("step-0");
        expect(page1.data[1]?.stepName).toBe("step-1");
        expect(page1.pagination.next).not.toBeNull();
        expect(page1.pagination.prev).toBeNull();

        // p2
        const page2 = await backend.listStepAttempts({
          workflowRunId: claimed.id,
          limit: 2,
          after: page1.pagination.next!, // eslint-disable-line @typescript-eslint/no-non-null-assertion
        });
        expect(page2.data).toHaveLength(2);
        expect(page2.data[0]?.stepName).toBe("step-2");
        expect(page2.data[1]?.stepName).toBe("step-3");
        expect(page2.pagination.next).not.toBeNull();
        expect(page2.pagination.prev).not.toBeNull();

        // p3
        const page3 = await backend.listStepAttempts({
          workflowRunId: claimed.id,
          limit: 2,
          after: page2.pagination.next!, // eslint-disable-line @typescript-eslint/no-non-null-assertion
        });
        expect(page3.data).toHaveLength(1);
        expect(page3.data[0]?.stepName).toBe("step-4");
        expect(page3.pagination.next).toBeNull();
        expect(page3.pagination.prev).not.toBeNull();

        // p2 again
        const page2Back = await backend.listStepAttempts({
          workflowRunId: claimed.id,
          limit: 2,
          before: page3.pagination.prev!, // eslint-disable-line @typescript-eslint/no-non-null-assertion
        });
        expect(page2Back.data).toHaveLength(2);
        expect(page2Back.data[0]?.stepName).toBe("step-2");
        expect(page2Back.data[1]?.stepName).toBe("step-3");
        expect(page2Back.pagination.next).toEqual(page2.pagination.next);
        expect(page2Back.pagination.prev).toEqual(page2.pagination.prev);
      });

      test("handles empty results", async () => {
        const claimed = await createClaimedWorkflowRun(backend);
        const listed = await backend.listStepAttempts({
          workflowRunId: claimed.id,
        });
        expect(listed.data).toHaveLength(0);
        expect(listed.pagination.next).toBeNull();
        expect(listed.pagination.prev).toBeNull();
      });

      test("handles exact limit match", async () => {
        const claimed = await createClaimedWorkflowRun(backend);
        await backend.createStepAttempt({
          workflowRunId: claimed.id,
          workerId: claimed.workerId!, // eslint-disable-line @typescript-eslint/no-non-null-assertion
          stepName: "step-1",
          kind: "function",
          config: {},
          context: null,
        });

        const listed = await backend.listStepAttempts({
          workflowRunId: claimed.id,
          limit: 1,
        });
        expect(listed.data).toHaveLength(1);
        expect(listed.pagination.next).toBeNull();
        expect(listed.pagination.prev).toBeNull();
      });
    });

    describe("completeStepAttempt()", () => {
      test("marks running step attempts as completed", async () => {
        const claimed = await createClaimedWorkflowRun(backend);

        const created = await backend.createStepAttempt({
          workflowRunId: claimed.id,
          workerId: claimed.workerId!, // eslint-disable-line @typescript-eslint/no-non-null-assertion
          stepName: randomUUID(),
          kind: "function",
          config: {},
          context: null,
        });
        const output = { foo: "bar" };

        const completed = await backend.completeStepAttempt({
          workflowRunId: claimed.id,
          stepAttemptId: created.id,
          workerId: claimed.workerId!, // eslint-disable-line @typescript-eslint/no-non-null-assertion
          output,
        });

        expect(completed.status).toBe("completed");
        expect(completed.output).toEqual(output);
        expect(completed.error).toBeNull();
        expect(completed.finishedAt).not.toBeNull();

        const fetched = await backend.getStepAttempt({
          stepAttemptId: created.id,
        });
        expect(fetched?.status).toBe("completed");
        expect(fetched?.output).toEqual(output);
        expect(fetched?.error).toBeNull();
        expect(fetched?.finishedAt).not.toBeNull();
      });

      test("throws when workflow is not running", async () => {
        const backend = await setup();
        await createPendingWorkflowRun(backend);

        // create a step attempt by first claiming the workflow
        const claimed = await backend.claimWorkflowRun({
          workerId: randomUUID(),
          leaseDurationMs: 100,
        });
        if (!claimed) throw new Error("Failed to claim workflow run");

        const stepAttempt = await backend.createStepAttempt({
          workflowRunId: claimed.id,
          workerId: claimed.workerId!, // eslint-disable-line @typescript-eslint/no-non-null-assertion
          stepName: randomUUID(),
          kind: "function",
          config: {},
          context: null,
        });

        // complete the workflow so it's no longer running
        await backend.completeWorkflowRun({
          workflowRunId: claimed.id,
          workerId: claimed.workerId!, // eslint-disable-line @typescript-eslint/no-non-null-assertion
          output: null,
        });

        // try to complete the step attempt
        await expect(
          backend.completeStepAttempt({
            workflowRunId: claimed.id,
            stepAttemptId: stepAttempt.id,
            workerId: claimed.workerId!, // eslint-disable-line @typescript-eslint/no-non-null-assertion
            output: { foo: "bar" },
          }),
        ).rejects.toThrow("Failed to mark step attempt completed");

        await teardown(backend);
      });

      test("throws when step attempt does not exist", async () => {
        const backend = await setup();
        const claimed = await createClaimedWorkflowRun(backend);

        await expect(
          backend.completeStepAttempt({
            workflowRunId: claimed.id,
            stepAttemptId: randomUUID(),
            workerId: claimed.workerId!, // eslint-disable-line @typescript-eslint/no-non-null-assertion
            output: { foo: "bar" },
          }),
        ).rejects.toThrow("Failed to mark step attempt completed");

        await teardown(backend);
      });
    });

    describe("failStepAttempt()", () => {
      test("marks running step attempts as failed", async () => {
        const claimed = await createClaimedWorkflowRun(backend);

        const created = await backend.createStepAttempt({
          workflowRunId: claimed.id,
          workerId: claimed.workerId!, // eslint-disable-line @typescript-eslint/no-non-null-assertion
          stepName: randomUUID(),
          kind: "function",
          config: {},
          context: null,
        });
        const error = { message: "nope" };

        const failed = await backend.failStepAttempt({
          workflowRunId: claimed.id,
          stepAttemptId: created.id,
          workerId: claimed.workerId!, // eslint-disable-line @typescript-eslint/no-non-null-assertion
          error,
        });

        expect(failed.status).toBe("failed");
        expect(failed.error).toEqual(error);
        expect(failed.output).toBeNull();
        expect(failed.finishedAt).not.toBeNull();

        const fetched = await backend.getStepAttempt({
          stepAttemptId: created.id,
        });
        expect(fetched?.status).toBe("failed");
        expect(fetched?.error).toEqual(error);
        expect(fetched?.output).toBeNull();
        expect(fetched?.finishedAt).not.toBeNull();
      });

      test("throws when workflow is not running", async () => {
        const backend = await setup();
        await createPendingWorkflowRun(backend);

        // create a step attempt by first claiming the workflow
        const claimed = await backend.claimWorkflowRun({
          workerId: randomUUID(),
          leaseDurationMs: 100,
        });
        if (!claimed) throw new Error("Failed to claim workflow run");

        const stepAttempt = await backend.createStepAttempt({
          workflowRunId: claimed.id,
          workerId: claimed.workerId!, // eslint-disable-line @typescript-eslint/no-non-null-assertion
          stepName: randomUUID(),
          kind: "function",
          config: {},
          context: null,
        });

        // complete the workflow so it's no longer running
        await backend.completeWorkflowRun({
          workflowRunId: claimed.id,
          workerId: claimed.workerId!, // eslint-disable-line @typescript-eslint/no-non-null-assertion
          output: null,
        });

        // try to fail the step attempt
        await expect(
          backend.failStepAttempt({
            workflowRunId: claimed.id,
            stepAttemptId: stepAttempt.id,
            workerId: claimed.workerId!, // eslint-disable-line @typescript-eslint/no-non-null-assertion
            error: { message: "nope" },
          }),
        ).rejects.toThrow("Failed to mark step attempt failed");

        await teardown(backend);
      });

      test("throws when step attempt does not exist", async () => {
        const backend = await setup();
        const claimed = await createClaimedWorkflowRun(backend);

        await expect(
          backend.failStepAttempt({
            workflowRunId: claimed.id,
            stepAttemptId: randomUUID(),
            workerId: claimed.workerId!, // eslint-disable-line @typescript-eslint/no-non-null-assertion
            error: { message: "nope" },
          }),
        ).rejects.toThrow("Failed to mark step attempt failed");

        await teardown(backend);
      });
    });

    describe("deadline_at", () => {
      test("creates a workflow run with a deadline", async () => {
        const deadline = new Date(Date.now() + 60_000); // in 1 minute
        const created = await backend.createWorkflowRun({
          workflowName: randomUUID(),
          version: null,
          idempotencyKey: null,
          input: null,
          config: {},
          context: null,
          availableAt: null,
          deadlineAt: deadline,
        });

        expect(created.deadlineAt).not.toBeNull();
        expect(created.deadlineAt?.getTime()).toBe(deadline.getTime());
      });

      test("does not claim workflow runs past their deadline", async () => {
        const backend = await setup();

        const pastDeadline = new Date(Date.now() - 1000);
        await backend.createWorkflowRun({
          workflowName: randomUUID(),
          version: null,
          idempotencyKey: null,
          input: null,
          config: {},
          context: null,
          availableAt: null,
          deadlineAt: pastDeadline,
        });

        const claimed = await backend.claimWorkflowRun({
          workerId: randomUUID(),
          leaseDurationMs: 1000,
        });

        expect(claimed).toBeNull();

        await teardown(backend);
      });

      test("marks deadline-expired workflow runs as failed when claiming", async () => {
        const backend = await setup();

        const pastDeadline = new Date(Date.now() - 1000);
        const created = await backend.createWorkflowRun({
          workflowName: randomUUID(),
          version: null,
          idempotencyKey: null,
          input: null,
          config: {},
          context: null,
          availableAt: null,
          deadlineAt: pastDeadline,
        });

        // attempt to claim triggers deadline check
        const claimed = await backend.claimWorkflowRun({
          workerId: randomUUID(),
          leaseDurationMs: 1000,
        });
        expect(claimed).toBeNull();

        // verify it was marked as failed
        const failed = await backend.getWorkflowRun({
          workflowRunId: created.id,
        });
        expect(failed?.status).toBe("failed");
        expect(failed?.error).toEqual({
          message: "Workflow run deadline exceeded",
        });
        expect(failed?.finishedAt).not.toBeNull();
        expect(failed?.availableAt).toBeNull();

        await teardown(backend);
      });

      test("does not reschedule failed workflow runs if next retry would exceed deadline", async () => {
        const backend = await setup();

        const deadline = new Date(Date.now() + 500); // 500ms from now
        const created = await backend.createWorkflowRun({
          workflowName: randomUUID(),
          version: null,
          idempotencyKey: null,
          input: null,
          config: {},
          context: null,
          availableAt: null,
          deadlineAt: deadline,
        });

        const workerId = randomUUID();
        const claimed = await backend.claimWorkflowRun({
          workerId,
          leaseDurationMs: 100,
        });
        expect(claimed).not.toBeNull();

        // should mark as permanently failed since retry backoff (1s) would exceed deadline (500ms)
        const failed = await backend.failWorkflowRun({
          workflowRunId: created.id,
          workerId,
          error: { message: "test error" },
        });

        expect(failed.status).toBe("failed");
        expect(failed.availableAt).toBeNull();
        expect(failed.finishedAt).not.toBeNull();
        expect(failed.startedAt).toBeNull(); // cleared on permanent failure

        await teardown(backend);
      });

      test("reschedules failed workflow runs if retry would complete before deadline", async () => {
        const backend = await setup();

        const deadline = new Date(Date.now() + 5000); // in 5 seconds
        const created = await backend.createWorkflowRun({
          workflowName: randomUUID(),
          version: null,
          idempotencyKey: null,
          input: null,
          config: {},
          context: null,
          availableAt: null,
          deadlineAt: deadline,
        });

        const workerId = randomUUID();
        const claimed = await backend.claimWorkflowRun({
          workerId,
          leaseDurationMs: 100,
        });
        expect(claimed).not.toBeNull();

        // should reschedule since retry backoff (1s) is before deadline (5s
        const failed = await backend.failWorkflowRun({
          workflowRunId: created.id,
          workerId,
          error: { message: "test error" },
        });

        expect(failed.status).toBe("pending");
        expect(failed.availableAt).not.toBeNull();
        expect(failed.finishedAt).toBeNull();

        await teardown(backend);
      });
    });

    describe("cancelWorkflowRun()", () => {
      test("cancels a pending workflow run", async () => {
        const backend = await setup();

        const created = await createPendingWorkflowRun(backend);
        expect(created.status).toBe("pending");

        const canceled = await backend.cancelWorkflowRun({
          workflowRunId: created.id,
        });

        expect(canceled.status).toBe("canceled");
        expect(canceled.workerId).toBeNull();
        expect(canceled.availableAt).toBeNull();
        expect(canceled.finishedAt).not.toBeNull();
        expect(deltaSeconds(canceled.finishedAt)).toBeLessThan(1);

        await teardown(backend);
      });

      test("cancels a running workflow run", async () => {
        const backend = await setup();

        const created = await createClaimedWorkflowRun(backend);
        expect(created.status).toBe("running");
        expect(created.workerId).not.toBeNull();

        const canceled = await backend.cancelWorkflowRun({
          workflowRunId: created.id,
        });

        expect(canceled.status).toBe("canceled");
        expect(canceled.workerId).toBeNull();
        expect(canceled.availableAt).toBeNull();
        expect(canceled.finishedAt).not.toBeNull();

        await teardown(backend);
      });

      test("cancels a sleeping workflow run", async () => {
        const backend = await setup();

        const claimed = await createClaimedWorkflowRun(backend);

        // put workflow to sleep
        const sleepUntil = new Date(Date.now() + 60_000); // 1 minute from now
        const sleeping = await backend.sleepWorkflowRun({
          workflowRunId: claimed.id,
          workerId: claimed.workerId ?? "",
          availableAt: sleepUntil,
        });
        expect(sleeping.status).toBe("sleeping");

        const canceled = await backend.cancelWorkflowRun({
          workflowRunId: sleeping.id,
        });

        expect(canceled.status).toBe("canceled");
        expect(canceled.workerId).toBeNull();
        expect(canceled.availableAt).toBeNull();
        expect(canceled.finishedAt).not.toBeNull();

        await teardown(backend);
      });

      test("throws error when canceling a completed workflow run", async () => {
        const backend = await setup();

        const claimed = await createClaimedWorkflowRun(backend);

        // mark as completed
        await backend.completeWorkflowRun({
          workflowRunId: claimed.id,
          workerId: claimed.workerId ?? "",
          output: { result: "success" },
        });

        await expect(
          backend.cancelWorkflowRun({
            workflowRunId: claimed.id,
          }),
        ).rejects.toThrow(
          /Cannot cancel workflow run .* with status completed/,
        );

        await teardown(backend);
      });

      test("throws error when canceling a failed workflow run", async () => {
        const backend = await setup();

        // create with deadline that's already passed to make it fail
        const workflowWithDeadline = await backend.createWorkflowRun({
          workflowName: randomUUID(),
          version: null,
          idempotencyKey: null,
          input: null,
          config: {},
          context: null,
          availableAt: null,
          deadlineAt: new Date(Date.now() - 1000), // deadline in the past
        });

        // try to claim it, which should mark it as failed due to deadline
        const claimed = await backend.claimWorkflowRun({
          workerId: randomUUID(),
          leaseDurationMs: 100,
        });

        // if claim succeeds, manually fail it
        if (claimed?.workerId) {
          await backend.failWorkflowRun({
            workflowRunId: claimed.id,
            workerId: claimed.workerId,
            error: { message: "test error" },
          });
        }

        // get a workflow that's definitely failed
        const failedRun = await backend.getWorkflowRun({
          workflowRunId: workflowWithDeadline.id,
        });

        if (failedRun?.status === "failed") {
          await expect(
            backend.cancelWorkflowRun({
              workflowRunId: failedRun.id,
            }),
          ).rejects.toThrow(/Cannot cancel workflow run .* with status failed/);
        }

        await teardown(backend);
      });

      test("is idempotent when canceling an already canceled workflow run", async () => {
        const backend = await setup();

        const created = await createPendingWorkflowRun(backend);

        const firstCancel = await backend.cancelWorkflowRun({
          workflowRunId: created.id,
        });
        expect(firstCancel.status).toBe("canceled");

        const secondCancel = await backend.cancelWorkflowRun({
          workflowRunId: created.id,
        });
        expect(secondCancel.status).toBe("canceled");
        expect(secondCancel.id).toBe(firstCancel.id);

        await teardown(backend);
      });

      test("throws error when canceling a non-existent workflow run", async () => {
        const backend = await setup();

        const nonExistentId = randomUUID();

        await expect(
          backend.cancelWorkflowRun({
            workflowRunId: nonExistentId,
          }),
        ).rejects.toThrow(`Workflow run ${nonExistentId} does not exist`);

        await teardown(backend);
      });

      test("canceled workflow is not claimed by workers", async () => {
        const backend = await setup();

        const created = await createPendingWorkflowRun(backend);

        // cancel the workflow
        await backend.cancelWorkflowRun({
          workflowRunId: created.id,
        });

        // try to claim work
        const claimed = await backend.claimWorkflowRun({
          workerId: randomUUID(),
          leaseDurationMs: 100,
        });

        // should not claim the canceled workflow
        expect(claimed).toBeNull();

        await teardown(backend);
      });
    });
  });
}

/**
 * Create a pending workflow run for tests.
 * @param b - Backend
 * @returns Created workflow run
 */
async function createPendingWorkflowRun(b: Backend) {
  return await b.createWorkflowRun({
    workflowName: randomUUID(),
    version: null,
    idempotencyKey: null,
    input: null,
    config: {},
    context: null,
    availableAt: null,
    deadlineAt: null,
  });
}

/**
 * Create and claim a workflow run for tests.
 * @param b - Backend
 * @returns Claimed workflow run
 */
async function createClaimedWorkflowRun(b: Backend) {
  await createPendingWorkflowRun(b);

  const claimed = await b.claimWorkflowRun({
    workerId: randomUUID(),
    leaseDurationMs: 100,
  });

  if (!claimed) throw new Error("Failed to claim workflow run");

  return claimed;
}

/**
 * Get delta in seconds from now.
 * @param date - Date to compare
 * @returns Delta in seconds
 */
function deltaSeconds(date: Date | null | undefined): number {
  if (!date) return Infinity;
  return Math.abs((Date.now() - date.getTime()) / 1000);
}

/**
 * Create a Date one year in the future.
 * @returns Future Date
 */
function newDateInOneYear() {
  const d = new Date();
  d.setFullYear(d.getFullYear() + 1);
  return d;
}

/**
 * Sleep for a given duration.
 * @param ms - Milliseconds to sleep
 * @returns Promise resolved after sleeping
 */
function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
