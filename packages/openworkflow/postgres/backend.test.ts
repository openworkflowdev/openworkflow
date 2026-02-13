import { testBackend } from "../backend.testsuite.js";
import { BackendPostgres } from "./backend.js";
import {
  DEFAULT_POSTGRES_URL,
  Postgres,
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
        availableAt: null,
        deadlineAt: null,
      });

      const internalBackend = backend as unknown as {
        pg: Postgres;
        schema: string;
      };
      const workflowRunsTable = internalBackend.pg`${internalBackend.pg(internalBackend.schema)}.${internalBackend.pg("workflow_runs")}`;

      const [record] = await internalBackend.pg<{ id: string }[]>`
        SELECT "id"
        FROM ${workflowRunsTable}
        WHERE "namespace_id" = ${namespaceId}
          AND "id" = ${workflowRun.id}
        LIMIT 1
      `;

      expect(record?.id).toBe(workflowRun.id);
    } finally {
      await backend.stop();

      const pg = newPostgresMaxOne(DEFAULT_POSTGRES_URL);
      await dropSchema(pg, schema);
      await pg.end();
    }
  });
});
