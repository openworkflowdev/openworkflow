import { testBackend } from "../backend.testsuite.js";
import { BackendSqlite } from "./backend.js";
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
