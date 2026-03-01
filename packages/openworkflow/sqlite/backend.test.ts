import { testBackend } from "../testing/backend.testsuite.js";
import { BackendSqlite } from "./backend.js";
import { Database } from "./sqlite.js";
import assert from "node:assert";
import { randomUUID } from "node:crypto";
import { unlinkSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test, describe, afterAll, expect, vi } from "vitest";

test("it is a test file (workaround for sonarjs/no-empty-test-file linter)", () => {
  assert.ok(true);
});

describe("BackendSqlite (in-memory)", () => {
  testBackend({
    setup: () => {
      return Promise.resolve(
        BackendSqlite.connect(":memory:", {
          namespaceId: randomUUID(),
        }),
      );
    },
    teardown: async (backend) => {
      await backend.stop();
    },
  });
});

describe("BackendSqlite (file-based)", () => {
  const testDbPath = path.join(
    tmpdir(),
    `openworkflow-test-${randomUUID()}.db`,
  );

  afterAll(() => {
    const walPath = `${testDbPath}-wal`;
    const shmPath = `${testDbPath}-shm`;
    // clean up the test database, WAL, and SHM files if they exist
    if (existsSync(testDbPath)) {
      unlinkSync(testDbPath);
    }
    if (existsSync(walPath)) {
      unlinkSync(walPath);
    }
    if (existsSync(shmPath)) {
      unlinkSync(shmPath);
    }
  });

  testBackend({
    setup: () => {
      return Promise.resolve(
        BackendSqlite.connect(testDbPath, {
          namespaceId: randomUUID(),
        }),
      );
    },
    teardown: async (backend) => {
      await backend.stop();
    },
  });
});

describe("BackendSqlite.connect errors", () => {
  test("returns a helpful error for invalid database paths", () => {
    const badPath = path.join(
      tmpdir(),
      `openworkflow-missing-${randomUUID()}`,
      "backend.db",
    );

    expect(() => BackendSqlite.connect(badPath)).toThrow(
      /SQLite backend failed to open database.*valid and writable.*:/,
    );
  });
});

describe("BackendSqlite.createWorkflowRun error handling", () => {
  test("rolls back and rejects with the original error when keyed insert fails", async () => {
    const backend = BackendSqlite.connect(":memory:", {
      namespaceId: randomUUID(),
    });
    const internalBackend = backend as unknown as {
      insertWorkflowRun: (params: unknown) => unknown;
    };
    const originalInsertWorkflowRun = internalBackend.insertWorkflowRun;

    internalBackend.insertWorkflowRun = () => {
      throw new Error("insert failed");
    };

    try {
      await expect(
        backend.createWorkflowRun({
          workflowName: "failing-workflow",
          version: "v1",
          idempotencyKey: randomUUID(),
          config: {},
          context: null,
          input: null,
          parentStepAttemptNamespaceId: null,
          parentStepAttemptId: null,
          availableAt: null,
          deadlineAt: null,
        }),
      ).rejects.toThrow("insert failed");
    } finally {
      internalBackend.insertWorkflowRun = originalInsertWorkflowRun;
      await backend.stop();
    }
  });

  test("swallows rollback failures and wraps non-Error thrown values", async () => {
    type BackendSqliteCtor = new (
      db: Database,
      namespaceId: string,
    ) => BackendSqlite;

    const calls: string[] = [];
    const fakeDb: Database = {
      exec(sql: string) {
        calls.push(sql);
        if (sql === "BEGIN IMMEDIATE") {
          // eslint-disable-next-line @typescript-eslint/only-throw-error
          throw "busy";
        }
        if (sql === "ROLLBACK") throw new Error("cannot rollback");
      },
      prepare() {
        throw new Error("prepare should not be called when BEGIN fails");
      },
      close() {
        // no-op
      },
    };

    const backend = new (BackendSqlite as unknown as BackendSqliteCtor)(
      fakeDb,
      randomUUID(),
    );

    await expect(
      backend.createWorkflowRun({
        workflowName: "failing-workflow",
        version: "v1",
        idempotencyKey: randomUUID(),
        config: {},
        context: null,
        input: null,
        parentStepAttemptNamespaceId: null,
        parentStepAttemptId: null,
        availableAt: null,
        deadlineAt: null,
      }),
    ).rejects.toThrow("busy");

    expect(calls).toEqual(["BEGIN IMMEDIATE", "ROLLBACK"]);
    await backend.stop();
  });
});

describe("BackendSqlite.setStepAttemptChildWorkflowRun error handling", () => {
  test("does not rely on a follow-up getStepAttempt reload", async () => {
    const backend = BackendSqlite.connect(":memory:", {
      namespaceId: randomUUID(),
    });

    try {
      const parent = await backend.createWorkflowRun({
        workflowName: randomUUID(),
        version: null,
        idempotencyKey: null,
        config: {},
        context: null,
        input: null,
        parentStepAttemptNamespaceId: null,
        parentStepAttemptId: null,
        availableAt: null,
        deadlineAt: null,
      });
      const workerId = randomUUID();
      const claimed = await backend.claimWorkflowRun({
        workerId,
        leaseDurationMs: 100,
      });
      if (!claimed) {
        throw new Error("Expected parent workflow run to be claimed");
      }
      expect(claimed.id).toBe(parent.id);

      const stepAttempt = await backend.createStepAttempt({
        workflowRunId: claimed.id,
        workerId,
        stepName: randomUUID(),
        kind: "workflow",
        config: {},
        context: null,
      });
      const childRun = await backend.createWorkflowRun({
        workflowName: randomUUID(),
        version: null,
        idempotencyKey: null,
        config: {},
        context: null,
        input: null,
        parentStepAttemptNamespaceId: stepAttempt.namespaceId,
        parentStepAttemptId: stepAttempt.id,
        availableAt: null,
        deadlineAt: null,
      });

      const originalGetStepAttempt = backend.getStepAttempt.bind(backend);
      const getStepAttemptSpy = vi
        .spyOn(backend, "getStepAttempt")
        .mockImplementation(async (params) => {
          if (params.stepAttemptId === stepAttempt.id) {
            return null;
          }
          return await originalGetStepAttempt(params);
        });

      try {
        const linked = await backend.setStepAttemptChildWorkflowRun({
          workflowRunId: claimed.id,
          stepAttemptId: stepAttempt.id,
          workerId,
          childWorkflowRunNamespaceId: childRun.namespaceId,
          childWorkflowRunId: childRun.id,
        });

        expect(linked.id).toBe(stepAttempt.id);
        expect(getStepAttemptSpy).not.toHaveBeenCalled();
      } finally {
        getStepAttemptSpy.mockRestore();
      }
    } finally {
      await backend.stop();
    }
  });
});

describe("BackendSqlite legacy sleeping compatibility", () => {
  test("claims workflow runs persisted with legacy sleeping status", async () => {
    const namespaceId = randomUUID();
    const backend = BackendSqlite.connect(":memory:", {
      namespaceId,
    });

    try {
      const run = await backend.createWorkflowRun({
        workflowName: "legacy-sleeping-claim",
        version: null,
        idempotencyKey: null,
        config: {},
        context: null,
        input: null,
        parentStepAttemptNamespaceId: null,
        parentStepAttemptId: null,
        availableAt: null,
        deadlineAt: null,
      });

      const internalBackend = backend as unknown as {
        db: Database;
      };
      const past = new Date(Date.now() - 1000).toISOString();
      internalBackend.db
        .prepare(
          `
          UPDATE "workflow_runs"
          SET
            "status" = 'sleeping',
            "worker_id" = NULL,
            "available_at" = ?,
            "updated_at" = ?
          WHERE "namespace_id" = ?
            AND "id" = ?
        `,
        )
        .run(past, past, namespaceId, run.id);

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

describe("BackendSqlite workflow wake-up reconciliation", () => {
  test("wakes parked parent immediately when child already finished", async () => {
    const backend = BackendSqlite.connect(":memory:", {
      namespaceId: randomUUID(),
    });

    try {
      const parent = await backend.createWorkflowRun({
        workflowName: "workflow-parent-reconcile",
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

      const workflowAttempt = await backend.createStepAttempt({
        workflowRunId: parent.id,
        workerId: parentWorkerId,
        stepName: "workflow-child",
        kind: "workflow",
        config: {},
        context: null,
      });

      const child = await backend.createWorkflowRun({
        workflowName: "workflow-child-reconcile",
        version: null,
        idempotencyKey: null,
        input: null,
        config: {},
        context: null,
        parentStepAttemptNamespaceId: workflowAttempt.namespaceId,
        parentStepAttemptId: workflowAttempt.id,
        availableAt: null,
        deadlineAt: null,
      });

      await backend.setStepAttemptChildWorkflowRun({
        workflowRunId: parent.id,
        stepAttemptId: workflowAttempt.id,
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

  test("does not wake parked parent when workflow step is no longer running", async () => {
    const backend = BackendSqlite.connect(":memory:", {
      namespaceId: randomUUID(),
    });

    try {
      const parent = await backend.createWorkflowRun({
        workflowName: "workflow-parent-no-wake-after-failed-workflow",
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

      const workflowAttempt = await backend.createStepAttempt({
        workflowRunId: parent.id,
        workerId: parentWorkerId,
        stepName: "workflow-child",
        kind: "workflow",
        config: {},
        context: null,
      });

      const child = await backend.createWorkflowRun({
        workflowName: "workflow-child-no-wake-after-failed-workflow",
        version: null,
        idempotencyKey: null,
        input: null,
        config: {},
        context: null,
        parentStepAttemptNamespaceId: workflowAttempt.namespaceId,
        parentStepAttemptId: workflowAttempt.id,
        availableAt: null,
        deadlineAt: null,
      });

      await backend.setStepAttemptChildWorkflowRun({
        workflowRunId: parent.id,
        stepAttemptId: workflowAttempt.id,
        workerId: parentWorkerId,
        childWorkflowRunNamespaceId: child.namespaceId,
        childWorkflowRunId: child.id,
      });

      await backend.failStepAttempt({
        workflowRunId: parent.id,
        stepAttemptId: workflowAttempt.id,
        workerId: parentWorkerId,
        error: { message: "workflow failed in parent" },
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
    const backend = BackendSqlite.connect(":memory:", {
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

      const internalBackend = backend as unknown as {
        db: Database;
      };
      const past = new Date(Date.now() - 1000).toISOString();
      internalBackend.db
        .prepare(
          `
          UPDATE "workflow_runs"
          SET
            "available_at" = ?,
            "updated_at" = ?
          WHERE "namespace_id" = ?
            AND "id" = ?
        `,
        )
        .run(past, past, namespaceId, run.id);

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
