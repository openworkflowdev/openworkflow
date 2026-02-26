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
  test("throws when linked step attempt cannot be reloaded", async () => {
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
        kind: "invoke",
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
        await expect(
          backend.setStepAttemptChildWorkflowRun({
            workflowRunId: claimed.id,
            stepAttemptId: stepAttempt.id,
            workerId,
            childWorkflowRunNamespaceId: childRun.namespaceId,
            childWorkflowRunId: childRun.id,
          }),
        ).rejects.toThrow("Failed to set step attempt child workflow run");
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
