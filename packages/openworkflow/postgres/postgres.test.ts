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
    test("runs database migrations idempotently", async () => {
      const schema = "test_migrate_idempotent";
      await dropSchema(pg, schema);
      await migrate(pg, schema);
      await migrate(pg, schema);
    });

    test("adds workflow concurrency columns and index", async () => {
      const schema = "test_concurrency_columns";
      await dropSchema(pg, schema);
      await migrate(pg, schema);

      try {
        const columns = await pg<
          {
            columnName: string;
          }[]
        >`
          SELECT column_name AS "columnName"
          FROM information_schema.columns
          WHERE table_schema = ${schema}
            AND table_name = 'workflow_runs'
            AND column_name IN ('concurrency_key', 'concurrency_limit')
          ORDER BY column_name ASC
        `;
        expect(columns.map((column) => column.columnName)).toEqual([
          "concurrency_key",
          "concurrency_limit",
        ]);

        /* cspell:disable */
        const indexes = await pg<
          {
            indexName: string;
          }[]
        >`
          SELECT indexname AS "indexName"
          FROM pg_indexes
          WHERE schemaname = ${schema}
            AND tablename = 'workflow_runs'
            AND indexname = 'workflow_runs_concurrency_active_idx'
        `;
        /* cspell:enable */
        expect(indexes).toHaveLength(1);
      } finally {
        await dropSchema(pg, schema);
      }
    });
  });

  describe("dropSchema()", () => {
    test("drops the schema idempotently", async () => {
      const testSchema = "test_drop_schema_idempotent";
      await migrate(pg, testSchema);
      await dropSchema(pg, testSchema);
      await dropSchema(pg, testSchema);
    });
  });
});
