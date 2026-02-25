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

    test("applies all migrations when migrations table has no version rows", async () => {
      const schema = "test_empty_migration_rows";
      const executedMigrations: string[] = [];

      const fakePg = {
        unsafe: (query: string) => {
          if (query.includes("SELECT EXISTS")) {
            return Promise.resolve([{ exists: true }]);
          }
          if (query.includes('MAX("version")')) {
            return Promise.resolve([{ version: null }]);
          }
          executedMigrations.push(query);
          return Promise.resolve([]);
        },
      } as unknown as Postgres;

      await migrate(fakePg, schema);

      expect(executedMigrations.length).toBe(migrations(schema).length);
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
