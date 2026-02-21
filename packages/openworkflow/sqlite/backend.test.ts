import { testBackend } from "../backend.testsuite.js";
import { BackendSqlite } from "./backend.js";
import { Database } from "./sqlite.js";
import assert from "node:assert";
import { randomUUID } from "node:crypto";
import { unlinkSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test, describe, afterAll, expect } from "vitest";

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
          concurrencyKey: null,
          concurrencyLimit: null,
          config: {},
          context: null,
          input: null,
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
        concurrencyKey: null,
        concurrencyLimit: null,
        config: {},
        context: null,
        input: null,
        availableAt: null,
        deadlineAt: null,
      }),
    ).rejects.toThrow("busy");

    expect(calls).toEqual(["BEGIN IMMEDIATE", "ROLLBACK"]);
    await backend.stop();
  });
});
