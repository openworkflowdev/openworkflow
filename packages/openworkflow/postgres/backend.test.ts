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
        concurrencyKey: null,
        concurrencyLimit: null,
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
        concurrencyKey: null,
        concurrencyLimit: null,
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

describe("BackendPostgres concurrency claim atomicity", () => {
  test("serializes same-bucket concurrent claims with advisory bucket locks", async () => {
    const namespaceId = randomUUID();
    const workflowName = "advisory-claim-atomicity";
    const version = "v1";
    const concurrencyKey = "tenant:acme";
    const concurrencyLimit = 1;
    const rounds = 5;
    const claimers = 6;

    const backends = await Promise.all(
      Array.from({ length: claimers }, async () => {
        return await BackendPostgres.connect(DEFAULT_POSTGRES_URL, {
          namespaceId,
        });
      }),
    );
    const primaryBackend = backends[0];
    if (!primaryBackend) {
      throw new Error("Expected at least one backend instance");
    }
    const inspector = newPostgresMaxOne(DEFAULT_POSTGRES_URL);

    try {
      for (let i = 0; i < rounds; i += 1) {
        await primaryBackend.createWorkflowRun({
          workflowName,
          version,
          idempotencyKey: null,
          concurrencyKey,
          concurrencyLimit,
          input: null,
          config: {},
          context: null,
          availableAt: null,
          deadlineAt: null,
        });
      }

      for (let round = 0; round < rounds; round += 1) {
        const claims = await Promise.all(
          backends.map(async (backend, i) => {
            return await backend.claimWorkflowRun({
              workerId: `worker-${String(round)}-${String(i)}-${randomUUID()}`,
              leaseDurationMs: 5000,
            });
          }),
        );
        const claimed = claims.filter((run): run is NonNullable<typeof run> => {
          return run !== null;
        });
        expect(claimed).toHaveLength(1);

        const workflowRunsTable = inspector`${inspector("openworkflow")}.${inspector("workflow_runs")}`;
        const [activeCount] = await inspector<{ count: number }[]>`
          SELECT COUNT(*)::INT AS "count"
          FROM ${workflowRunsTable}
          WHERE "namespace_id" = ${namespaceId}
            AND "workflow_name" = ${workflowName}
            AND "version" IS NOT DISTINCT FROM ${version}
            AND "concurrency_key" = ${concurrencyKey}
            AND "status" = 'running'
            AND "available_at" > NOW()
        `;
        expect(activeCount?.count).toBe(1);

        const claimedRun = claimed[0];
        if (!claimedRun?.workerId) {
          throw new Error("Expected claimed workflow run to include worker id");
        }

        await primaryBackend.completeWorkflowRun({
          workflowRunId: claimedRun.id,
          workerId: claimedRun.workerId,
          output: null,
        });
      }
    } finally {
      await Promise.all(
        backends.map(async (backend) => {
          await backend.stop();
        }),
      );
      await inspector.end();
    }
  });
});
