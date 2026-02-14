import { testBackend } from "../backend.testsuite.js";
import { BackendPostgres } from "./backend.js";
import {
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
