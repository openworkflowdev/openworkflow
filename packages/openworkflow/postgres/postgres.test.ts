import {
  DEFAULT_POSTGRES_URL,
  DEFAULT_SCHEMA,
  Postgres,
  newPostgresMaxOne,
  migrations,
  migrate,
  dropSchema,
} from "./postgres.js";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

describe("postgres", () => {
  let pg: Postgres;

  beforeAll(() => {
    // maxOne since we use SQL-based transactions instead of the postgres
    // driver's built-in transactions
    pg = newPostgresMaxOne(DEFAULT_POSTGRES_URL);
  });

  afterAll(async () => {
    await pg.end();
  });

  describe("migrations()", () => {
    test("returns migrations in 'openworkflow' schema when no schema is specified", () => {
      const migs = migrations(DEFAULT_SCHEMA);
      for (const mig of migs) {
        expect(mig).toContain(`"openworkflow"`);
      }
    });

    test("returns migration in the specified schema when one is specified", () => {
      const schema = "test_custom_schema";
      const migs = migrations(schema);
      for (const mig of migs) {
        expect(mig).toContain(`"${schema}"`);
        expect(mig).not.toContain(`"openworkflow"`);
      }
    });

    test("throws for invalid schema names", () => {
      expect(() => migrations("invalid-schema")).toThrow(/Invalid schema name/);
    });

    test("throws for schema names longer than 63 bytes", () => {
      expect(() => migrations("a".repeat(64))).toThrow(/at most 63 bytes/i);
    });
  });

  describe("migrate()", () => {
    test("serializes startup migrations and can run again", async () => {
      const schema = "test_migrate_idempotent";
      await dropSchema(pg, schema);
      await Promise.all(
        Array.from({ length: 2 }, () => migrate(DEFAULT_POSTGRES_URL, schema)),
      );
      await migrate(DEFAULT_POSTGRES_URL, schema);

      const versions = await pg.unsafe<{ version: number }[]>(
        `SELECT "version" FROM "${schema}"."openworkflow_migrations" ORDER BY "version";`,
      );
      expect(versions).toHaveLength(migrations(schema).length);
    });

    test("applies all migrations when migrations table has no version rows", async () => {
      const schema = "test_empty_migration_rows";
      await dropSchema(pg, schema);
      const initialMigration = migrations(schema)[0];
      if (!initialMigration) throw new Error("Missing initial migration");
      await pg.unsafe(initialMigration);
      await pg.unsafe(`DELETE FROM "${schema}"."openworkflow_migrations"`);
      await migrate(DEFAULT_POSTGRES_URL, schema);

      const versions = await pg.unsafe<{ version: string }[]>(
        `SELECT version FROM "${schema}"."openworkflow_migrations"`,
      );
      expect(versions).toHaveLength(migrations(schema).length);
      await dropSchema(pg, schema);
    });

    test("leaves an interrupted index build for manual resolution", async () => {
      const schema = "test_migrate_invalid_index";
      const blocker = newPostgresMaxOne(DEFAULT_POSTGRES_URL);
      await dropSchema(pg, schema);
      try {
        for (const migration of migrations(schema).slice(0, 4)) {
          await pg.unsafe(migration);
        }
        await pg.unsafe(`INSERT INTO "${schema}"."workflow_runs"
          (namespace_id, id, workflow_name, status, config, attempts, created_at, updated_at)
          VALUES ('test', 'one', 'workflow', 'pending', '{}', 0, NOW(), NOW())`);
        // The writer lets the index build create its catalog entry, then blocks its scan.
        await blocker.unsafe(`BEGIN;
          UPDATE "${schema}"."workflow_runs" SET attempts = 1 WHERE id = 'one'`);
        await expect(
          migrate(DEFAULT_POSTGRES_URL, schema),
        ).rejects.toMatchObject({
          code: "55P03",
        });
        await blocker.unsafe("ROLLBACK");

        const invalidBefore = await pg`
          SELECT c.oid, c.relname FROM pg_index i
          JOIN pg_class c ON c.oid = i.indexrelid
          JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = ${schema} AND NOT i.indisvalid`;
        expect(invalidBefore).toMatchObject([
          { relname: "workflow_runs_status_available_at_created_at_idx" },
        ]);
        await expect(migrate(DEFAULT_POSTGRES_URL, schema)).rejects.toThrow(
          `Cannot migrate schema "${schema}" with invalid indexes: workflow_runs_status_available_at_created_at_idx. Resolve them before retrying.`,
        );
        const invalidAfter = await pg`
          SELECT c.oid, c.relname FROM pg_index i
          JOIN pg_class c ON c.oid = i.indexrelid
          JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = ${schema} AND NOT i.indisvalid`;
        expect(invalidAfter).toEqual(invalidBefore);
        const versions = await pg.unsafe<{ version: string }[]>(
          `SELECT version FROM "${schema}"."openworkflow_migrations" WHERE version >= 4`,
        );
        expect(versions).toHaveLength(0);

        await pg.unsafe(
          `DROP INDEX CONCURRENTLY "${schema}"."workflow_runs_status_available_at_created_at_idx"`,
        );
        await migrate(DEFAULT_POSTGRES_URL, schema);
        const [index] = await pg<{ valid: boolean }[]>`
          SELECT i.indisvalid AS valid FROM pg_index i
          JOIN pg_class c ON c.oid = i.indexrelid
          JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = ${schema}
            AND c.relname = 'workflow_runs_status_available_at_created_at_idx'`;
        expect(index?.valid).toBe(true);
      } finally {
        await blocker.unsafe("ROLLBACK");
        await blocker.end();
        await dropSchema(pg, schema);
      }
    });

    test("fails on a lock timeout and can be retried after contention clears", async () => {
      const schema = "test_migrate_lock_timeout";
      const blocker = newPostgresMaxOne(DEFAULT_POSTGRES_URL);
      await dropSchema(pg, schema);
      await migrate(DEFAULT_POSTGRES_URL, schema);
      await pg.unsafe(`ALTER TABLE "${schema}"."step_attempts" DROP COLUMN step_index;
        DELETE FROM "${schema}"."openworkflow_migrations" WHERE version >= 6`);
      try {
        await blocker.unsafe(`BEGIN;
          LOCK TABLE "${schema}"."step_attempts" IN ACCESS EXCLUSIVE MODE`);
        await expect(
          migrate(DEFAULT_POSTGRES_URL, schema),
        ).rejects.toMatchObject({
          code: "55P03",
        });
        const versions = await pg.unsafe<{ version: string }[]>(
          `SELECT version FROM "${schema}"."openworkflow_migrations" WHERE version = 6`,
        );
        expect(versions).toHaveLength(0);

        await blocker.unsafe("ROLLBACK");
        await migrate(DEFAULT_POSTGRES_URL, schema);
        await pg.unsafe(`SELECT step_index FROM "${schema}"."step_attempts"`);
      } finally {
        await blocker.unsafe("ROLLBACK");
        await blocker.end();
        await dropSchema(pg, schema);
      }
    });

    test("fails promptly if its connection closes while waiting for another migrator", async () => {
      const schema = "test_migrate_disconnected_waiter";
      const blocker = newPostgresMaxOne(DEFAULT_POSTGRES_URL);
      try {
        await blocker`SELECT pg_advisory_lock(hashtextextended(${`openworkflow:migrations:${schema}`}, 0))`;
        const attempt = Promise.allSettled([
          migrate(DEFAULT_POSTGRES_URL, schema),
        ]);
        let pid: number | undefined;
        await expect
          .poll(
            async () => {
              const [session] = await pg<{ pid: number }[]>`
            SELECT pid FROM pg_stat_activity
            WHERE application_name = ${`openworkflow:migrate:${schema}`}
              AND state = 'idle' AND query LIKE '%pg_try_advisory_lock%'`;
              pid = session?.pid;
              return pid;
            },
            { interval: 10 },
          )
          .toBeTypeOf("number");
        if (!pid) throw new Error("Waiting migration connection was not found");
        await pg`SELECT pg_terminate_backend(${pid})`;
        expect(await attempt).toMatchObject([{ status: "rejected" }]);
        await blocker.end();
        await migrate(DEFAULT_POSTGRES_URL, schema);
      } finally {
        await blocker.end();
        await dropSchema(pg, schema);
      }
    });
  });

  describe("dropSchema()", () => {
    test("drops the schema idempotently", async () => {
      const testSchema = "test_drop_schema_idempotent";
      await migrate(DEFAULT_POSTGRES_URL, testSchema);
      await dropSchema(pg, testSchema);
      await dropSchema(pg, testSchema);

      const schemaExists = await pg.unsafe<{ exists: boolean }[]>(
        `
        SELECT EXISTS (
          SELECT 1
          FROM information_schema.schemata
          WHERE schema_name = $1
        )`,
        [testSchema],
      );
      expect(schemaExists[0]?.exists).toBe(false);
    });
  });
});
