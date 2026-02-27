import { testBackend } from "../testing/backend.testsuite.js";
import { BackendPostgres } from "./backend.js";
import {
  DEFAULT_SCHEMA,
  DEFAULT_POSTGRES_URL,
  dropSchema,
  newPostgresMaxOne,
} from "./postgres.js";
import assert from "node:assert";
import { randomUUID } from "node:crypto";
import { describe, expect, test } from "vitest";

test("it is a test file (workaround for sonarjs/no-empty-test-file linter)", () => {
  assert.ok(true);
});

testBackend({
  setup: async () => {
    return await BackendPostgres.connect(DEFAULT_POSTGRES_URL, {
      namespaceId: randomUUID(),
    });
  },
  teardown: async (backend) => {
    await backend.stop();
  },
});

describe("BackendPostgres.connect errors", () => {
  test("returns a helpful error for invalid connection URLs", async () => {
    await expect(BackendPostgres.connect("not-a-valid-url")).rejects.toThrow(
      /Postgres backend failed to connect.*postgresql:\/\/user:pass@host:port\/db.*:/,
    );
  });

  test("throws a clear error for invalid schema names", async () => {
    await expect(
      BackendPostgres.connect(DEFAULT_POSTGRES_URL, {
        schema: "invalid-schema",
      }),
    ).rejects.toThrow(/Invalid schema name/);
  });

  test("throws for schema names longer than 63 bytes", async () => {
    await expect(
      BackendPostgres.connect(DEFAULT_POSTGRES_URL, {
        schema: "a".repeat(64),
      }),
    ).rejects.toThrow(/at most 63 bytes/i);
  });
});

describe("BackendPostgres schema option", () => {
  test("stores workflow data in the configured schema", async () => {
    const schema = `test_schema_${randomUUID().replaceAll("-", "_")}`;
    const namespaceId = randomUUID();
    const backend = await BackendPostgres.connect(DEFAULT_POSTGRES_URL, {
      namespaceId,
      schema,
    });

    try {
      const workflowRun = await backend.createWorkflowRun({
        workflowName: "schema-test",
        version: null,
        idempotencyKey: null,
        input: null,
        config: {},
        context: null,
        parentStepAttemptNamespaceId: null,
        parentStepAttemptId: null,
        availableAt: null,
        deadlineAt: null,
      });

      const pg = newPostgresMaxOne(DEFAULT_POSTGRES_URL);
      try {
        const workflowRunsTable = pg`${pg(schema)}.${pg("workflow_runs")}`;

        const [record] = await pg<{ id: string }[]>`
          SELECT "id"
          FROM ${workflowRunsTable}
          WHERE "namespace_id" = ${namespaceId}
            AND "id" = ${workflowRun.id}
          LIMIT 1
        `;

        expect(record?.id).toBe(workflowRun.id);
      } finally {
        await pg.end();
      }
    } finally {
      await backend.stop();

      const pg = newPostgresMaxOne(DEFAULT_POSTGRES_URL);
      await dropSchema(pg, schema);
      await pg.end();
    }
  });

  test("reschedules workflow runs in the configured schema", async () => {
    const schema = `test_schema_${randomUUID().replaceAll("-", "_")}`;
    const namespaceId = randomUUID();
    const workerId = randomUUID();
    const backend = await BackendPostgres.connect(DEFAULT_POSTGRES_URL, {
      namespaceId,
      schema,
    });

    try {
      const workflowRun = await backend.createWorkflowRun({
        workflowName: "schema-reschedule-test",
        version: null,
        idempotencyKey: null,
        input: null,
        config: {},
        context: null,
        parentStepAttemptNamespaceId: null,
        parentStepAttemptId: null,
        availableAt: null,
        deadlineAt: null,
      });

      const claimed = await backend.claimWorkflowRun({
        workerId,
        leaseDurationMs: 60_000,
      });

      expect(claimed?.id).toBe(workflowRun.id);

      const availableAt = new Date(Date.now() + 60_000);
      const rescheduled =
        await backend.rescheduleWorkflowRunAfterFailedStepAttempt({
          workflowRunId: workflowRun.id,
          workerId,
          availableAt,
          error: { message: "step failed" },
        });

      expect(rescheduled.id).toBe(workflowRun.id);
      expect(rescheduled.status).toBe("pending");
      expect(rescheduled.workerId).toBeNull();

      const pg = newPostgresMaxOne(DEFAULT_POSTGRES_URL);
      try {
        const workflowRunsTable = pg`${pg(schema)}.${pg("workflow_runs")}`;

        const [record] = await pg<
          {
            id: string;
            status: string;
          }[]
        >`
          SELECT "id", "status"
          FROM ${workflowRunsTable}
          WHERE "namespace_id" = ${namespaceId}
            AND "id" = ${workflowRun.id}
          LIMIT 1
        `;

        expect(record?.id).toBe(workflowRun.id);
        expect(record?.status).toBe("pending");
      } finally {
        await pg.end();
      }
    } finally {
      await backend.stop();

      const pg = newPostgresMaxOne(DEFAULT_POSTGRES_URL);
      await dropSchema(pg, schema);
      await pg.end();
    }
  });
});

describe("BackendPostgres cancel fallback", () => {
  test("throws generic cancel error for non-standard workflow status", async () => {
    const backend = await BackendPostgres.connect(DEFAULT_POSTGRES_URL, {
      namespaceId: randomUUID(),
    });

    try {
      const run = await backend.createWorkflowRun({
        workflowName: "cancel-non-standard-status",
        version: null,
        idempotencyKey: null,
        input: null,
        config: {},
        context: null,
        parentStepAttemptNamespaceId: null,
        parentStepAttemptId: null,
        availableAt: null,
        deadlineAt: null,
      });

      const pg = newPostgresMaxOne(DEFAULT_POSTGRES_URL);
      try {
        const workflowRunsTable = pg`${pg(DEFAULT_SCHEMA)}.${pg("workflow_runs")}`;

        await pg`
          UPDATE ${workflowRunsTable}
          SET "status" = 'paused'
          WHERE "namespace_id" = ${run.namespaceId}
            AND "id" = ${run.id}
        `;
      } finally {
        await pg.end();
      }

      await expect(
        backend.cancelWorkflowRun({
          workflowRunId: run.id,
        }),
      ).rejects.toThrow("Failed to cancel workflow run");
    } finally {
      await backend.stop();
    }
  });
});

describe("BackendPostgres legacy sleeping compatibility", () => {
  test("claims workflow runs persisted with legacy sleeping status", async () => {
    const namespaceId = randomUUID();
    const backend = await BackendPostgres.connect(DEFAULT_POSTGRES_URL, {
      namespaceId,
    });

    try {
      const run = await backend.createWorkflowRun({
        workflowName: "legacy-sleeping-claim",
        version: null,
        idempotencyKey: null,
        input: null,
        config: {},
        context: null,
        parentStepAttemptNamespaceId: null,
        parentStepAttemptId: null,
        availableAt: null,
        deadlineAt: null,
      });

      const pg = newPostgresMaxOne(DEFAULT_POSTGRES_URL);
      try {
        const workflowRunsTable = pg`${pg(DEFAULT_SCHEMA)}.${pg("workflow_runs")}`;

        await pg`
          UPDATE ${workflowRunsTable}
          SET
            "status" = 'sleeping',
            "worker_id" = NULL,
            "available_at" = NOW() - INTERVAL '1 second',
            "updated_at" = NOW()
          WHERE "namespace_id" = ${namespaceId}
            AND "id" = ${run.id}
        `;
      } finally {
        await pg.end();
      }

      const workerId = randomUUID();
      const claimed = await backend.claimWorkflowRun({
        workerId,
        leaseDurationMs: 60_000,
      });

      expect(claimed?.id).toBe(run.id);
      expect(claimed?.status).toBe("running");
      expect(claimed?.workerId).toBe(workerId);
    } finally {
      await backend.stop();
    }
  });
});

describe("BackendPostgres invoke wake-up reconciliation", () => {
  test("wakes parked parent immediately when child already finished", async () => {
    const backend = await BackendPostgres.connect(DEFAULT_POSTGRES_URL, {
      namespaceId: randomUUID(),
    });

    try {
      const parent = await backend.createWorkflowRun({
        workflowName: "invoke-parent-reconcile",
        version: null,
        idempotencyKey: null,
        input: null,
        config: {},
        context: null,
        parentStepAttemptNamespaceId: null,
        parentStepAttemptId: null,
        availableAt: null,
        deadlineAt: null,
      });

      const parentWorkerId = randomUUID();
      const claimedParent = await backend.claimWorkflowRun({
        workerId: parentWorkerId,
        leaseDurationMs: 60_000,
      });
      expect(claimedParent?.id).toBe(parent.id);
      if (!claimedParent) {
        throw new Error("Expected parent workflow run to be claimed");
      }

      const invokeAttempt = await backend.createStepAttempt({
        workflowRunId: parent.id,
        workerId: parentWorkerId,
        stepName: "invoke-child",
        kind: "invoke",
        config: {},
        context: null,
      });

      const child = await backend.createWorkflowRun({
        workflowName: "invoke-child-reconcile",
        version: null,
        idempotencyKey: null,
        input: null,
        config: {},
        context: null,
        parentStepAttemptNamespaceId: invokeAttempt.namespaceId,
        parentStepAttemptId: invokeAttempt.id,
        availableAt: null,
        deadlineAt: null,
      });

      await backend.setStepAttemptChildWorkflowRun({
        workflowRunId: parent.id,
        stepAttemptId: invokeAttempt.id,
        workerId: parentWorkerId,
        childWorkflowRunNamespaceId: child.namespaceId,
        childWorkflowRunId: child.id,
      });

      const childWorkerId = randomUUID();
      const claimedChild = await backend.claimWorkflowRun({
        workerId: childWorkerId,
        leaseDurationMs: 60_000,
      });
      expect(claimedChild?.id).toBe(child.id);
      if (!claimedChild) {
        throw new Error("Expected child workflow run to be claimed");
      }

      await backend.completeWorkflowRun({
        workflowRunId: child.id,
        workerId: childWorkerId,
        output: { ok: true },
      });

      const sleepTarget = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
      const parkedParent = await backend.sleepWorkflowRun({
        workflowRunId: parent.id,
        workerId: parentWorkerId,
        availableAt: sleepTarget,
      });

      expect(parkedParent.status).toBe("running");
      expect(parkedParent.workerId).toBeNull();
      if (!parkedParent.availableAt) {
        throw new Error("Expected parked parent availableAt");
      }
      expect(parkedParent.availableAt.getTime()).toBeLessThan(
        Date.now() + 1000,
      );
    } finally {
      await backend.stop();
    }
  });

  test("does not wake parked parent when invoke step is no longer running", async () => {
    const backend = await BackendPostgres.connect(DEFAULT_POSTGRES_URL, {
      namespaceId: randomUUID(),
    });

    try {
      const parent = await backend.createWorkflowRun({
        workflowName: "invoke-parent-no-wake-after-failed-invoke",
        version: null,
        idempotencyKey: null,
        input: null,
        config: {},
        context: null,
        parentStepAttemptNamespaceId: null,
        parentStepAttemptId: null,
        availableAt: null,
        deadlineAt: null,
      });

      const parentWorkerId = randomUUID();
      const claimedParent = await backend.claimWorkflowRun({
        workerId: parentWorkerId,
        leaseDurationMs: 60_000,
      });
      expect(claimedParent?.id).toBe(parent.id);
      if (!claimedParent) {
        throw new Error("Expected parent workflow run to be claimed");
      }

      const invokeAttempt = await backend.createStepAttempt({
        workflowRunId: parent.id,
        workerId: parentWorkerId,
        stepName: "invoke-child",
        kind: "invoke",
        config: {},
        context: null,
      });

      const child = await backend.createWorkflowRun({
        workflowName: "invoke-child-no-wake-after-failed-invoke",
        version: null,
        idempotencyKey: null,
        input: null,
        config: {},
        context: null,
        parentStepAttemptNamespaceId: invokeAttempt.namespaceId,
        parentStepAttemptId: invokeAttempt.id,
        availableAt: null,
        deadlineAt: null,
      });

      await backend.setStepAttemptChildWorkflowRun({
        workflowRunId: parent.id,
        stepAttemptId: invokeAttempt.id,
        workerId: parentWorkerId,
        childWorkflowRunNamespaceId: child.namespaceId,
        childWorkflowRunId: child.id,
      });

      await backend.failStepAttempt({
        workflowRunId: parent.id,
        stepAttemptId: invokeAttempt.id,
        workerId: parentWorkerId,
        error: { message: "invoke failed in parent" },
      });

      const sleepTarget = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
      const parkedParent = await backend.sleepWorkflowRun({
        workflowRunId: parent.id,
        workerId: parentWorkerId,
        availableAt: sleepTarget,
      });

      expect(parkedParent.status).toBe("running");
      expect(parkedParent.workerId).toBeNull();

      const childWorkerId = randomUUID();
      const claimedChild = await backend.claimWorkflowRun({
        workerId: childWorkerId,
        leaseDurationMs: 60_000,
      });
      expect(claimedChild?.id).toBe(child.id);
      if (!claimedChild) {
        throw new Error("Expected child workflow run to be claimed");
      }

      await backend.completeWorkflowRun({
        workflowRunId: child.id,
        workerId: childWorkerId,
        output: { ok: true },
      });

      const parentAfterChild = await backend.getWorkflowRun({
        workflowRunId: parent.id,
      });
      expect(parentAfterChild?.status).toBe("running");
      expect(parentAfterChild?.workerId).toBeNull();
      if (!parentAfterChild?.availableAt) {
        throw new Error("Expected parent availableAt after child completion");
      }
      expect(parentAfterChild.availableAt.getTime()).toBeGreaterThan(
        Date.now() + 30 * 60 * 1000,
      );
    } finally {
      await backend.stop();
    }
  });

  test("sleepWorkflowRun overwrites stale due availableAt with new resume time", async () => {
    const namespaceId = randomUUID();
    const backend = await BackendPostgres.connect(DEFAULT_POSTGRES_URL, {
      namespaceId,
    });

    try {
      const run = await backend.createWorkflowRun({
        workflowName: "sleep-overwrite-stale-available-at",
        version: null,
        idempotencyKey: null,
        input: null,
        config: {},
        context: null,
        parentStepAttemptNamespaceId: null,
        parentStepAttemptId: null,
        availableAt: null,
        deadlineAt: null,
      });

      const workerId = randomUUID();
      const claimed = await backend.claimWorkflowRun({
        workerId,
        leaseDurationMs: 60_000,
      });
      expect(claimed?.id).toBe(run.id);
      if (!claimed) {
        throw new Error("Expected workflow run to be claimed");
      }

      const pg = newPostgresMaxOne(DEFAULT_POSTGRES_URL);
      try {
        const workflowRunsTable = pg`${pg(DEFAULT_SCHEMA)}.${pg("workflow_runs")}`;
        await pg`
          UPDATE ${workflowRunsTable}
          SET
            "available_at" = NOW() - INTERVAL '1 second',
            "updated_at" = NOW()
          WHERE "namespace_id" = ${namespaceId}
            AND "id" = ${run.id}
        `;
      } finally {
        await pg.end();
      }

      const sleepTarget = new Date(Date.now() + 60 * 60 * 1000);
      const parked = await backend.sleepWorkflowRun({
        workflowRunId: run.id,
        workerId,
        availableAt: sleepTarget,
      });

      expect(parked.status).toBe("running");
      expect(parked.workerId).toBeNull();
      if (!parked.availableAt) {
        throw new Error("Expected parked workflow availableAt");
      }
      expect(parked.availableAt.getTime()).toBeGreaterThan(
        Date.now() + 30 * 60 * 1000,
      );
    } finally {
      await backend.stop();
    }
  });
});
