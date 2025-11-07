import postgres from "postgres";

export const DEFAULT_DATABASE_URL =
  "postgresql://postgres:postgres@localhost:5432/postgres";

// The default schema to use for OpenWorkflow data. This type is more for
// documentation than for practical use. The only time we allow schema
// customization is during testing, specifically for testing migrations.
// Everywhere else uses the "openworkflow" schema directly for prepared
// statements.
export const DEFAULT_SCHEMA = "openworkflow";

export type Postgres = ReturnType<typeof postgres>;
export type PostgresOptions = Parameters<typeof postgres>[1];

/**
 * newPostgres creates a new Postgres client.
 */
export function newPostgres(url: string, options?: PostgresOptions) {
  return postgres(url, { ...options, transform: postgres.toCamel });
}

/**
 * newPostgresMaxOne creates a new Postgres client with a maximum pool size of
 * one, which is useful for migrations.
 */
export function newPostgresMaxOne(url: string, options?: PostgresOptions) {
  return newPostgres(url, { ...options, max: 1 });
}

/**
 * migrations returns the list of migration SQL statements.
 */
export function migrations(schema: string): string[] {
  return [
    // 0 - init
    `BEGIN;

    CREATE SCHEMA IF NOT EXISTS ${schema};

    CREATE TABLE IF NOT EXISTS "${schema}"."openworkflow_migrations" (
      "version" BIGINT NOT NULL PRIMARY KEY
    );

    INSERT INTO "${schema}"."openworkflow_migrations" ("version")
    VALUES (0)
    ON CONFLICT DO NOTHING;

    COMMIT;`,

    // 1 - add workflow_runs and step_attempts tables
    `BEGIN;

    CREATE TABLE IF NOT EXISTS "${schema}"."workflow_runs" (
      "namespace_id" TEXT NOT NULL,
      "id" TEXT NOT NULL,
      --
      "workflow_name" TEXT NOT NULL,
      "version" TEXT,
      "status" TEXT NOT NULL,
      "idempotency_key" TEXT,
      "context" JSONB,
      "input" JSONB,
      "output" JSONB,
      "error" JSONB,
      "attempts" SMALLINT NOT NULL,
      "parent_step_attempt_namespace_id" TEXT,
      "parent_step_attempt_id" TEXT,
      "worker_id" TEXT,
      "available_at" TIMESTAMPTZ,
      "started_at" TIMESTAMPTZ,
      "finished_at" TIMESTAMPTZ,
      "created_at" TIMESTAMPTZ NOT NULL,
      "updated_at" TIMESTAMPTZ NOT NULL,
      PRIMARY KEY ("namespace_id", "id")
    );

    CREATE TABLE IF NOT EXISTS "${schema}"."step_attempts" (
      "namespace_id" TEXT NOT NULL,
      "id" TEXT NOT NULL,
      --
      "workflow_run_id" TEXT NOT NULL,
      "step_name" TEXT NOT NULL,
      "kind" TEXT NOT NULL,
      "status" TEXT NOT NULL,
      "output" JSONB,
      "error" JSONB,
      "child_workflow_run_namespace_id" TEXT,
      "child_workflow_run_id" TEXT,
      "started_at" TIMESTAMPTZ,
      "finished_at" TIMESTAMPTZ,
      "created_at" TIMESTAMPTZ NOT NULL,
      "updated_at" TIMESTAMPTZ NOT NULL,
      PRIMARY KEY ("namespace_id", "id")
    );

    INSERT INTO "${schema}"."openworkflow_migrations" ("version")
    VALUES (1)
    ON CONFLICT DO NOTHING;
    
    COMMIT;`,

    // 2 - foreign keys
    `BEGIN;

    ALTER TABLE "${schema}"."step_attempts"
    ADD CONSTRAINT "step_attempts_workflow_run_fk"
    FOREIGN KEY ("namespace_id", "workflow_run_id")
    REFERENCES "${schema}"."workflow_runs" ("namespace_id", "id")
    ON DELETE CASCADE
    NOT VALID;

    ALTER TABLE "${schema}"."workflow_runs"
    ADD CONSTRAINT "workflow_runs_parent_step_attempt_fk"
    FOREIGN KEY ("parent_step_attempt_namespace_id", "parent_step_attempt_id")
    REFERENCES "${schema}"."step_attempts" ("namespace_id", "id")
    ON DELETE SET NULL
    NOT VALID;

    ALTER TABLE "${schema}"."step_attempts"
    ADD CONSTRAINT "step_attempts_child_workflow_run_fk"
    FOREIGN KEY ("child_workflow_run_namespace_id", "child_workflow_run_id")
    REFERENCES "${schema}"."workflow_runs" ("namespace_id", "id")
    ON DELETE SET NULL
    NOT VALID;

    INSERT INTO "${schema}"."openworkflow_migrations" ("version")
    VALUES (2)
    ON CONFLICT DO NOTHING;

    COMMIT;`,

    // 3 - validate foreign keys
    `BEGIN;

    ALTER TABLE "${schema}"."step_attempts"
    VALIDATE CONSTRAINT "step_attempts_workflow_run_fk";
    
    ALTER TABLE "${schema}"."workflow_runs" VALIDATE CONSTRAINT
    "workflow_runs_parent_step_attempt_fk";

    ALTER TABLE "${schema}"."step_attempts"
    VALIDATE CONSTRAINT "step_attempts_child_workflow_run_fk";

    INSERT INTO "${schema}"."openworkflow_migrations" ("version")
    VALUES (3)
    ON CONFLICT DO NOTHING;

    COMMIT;`,

    // 4 - indexes
    `BEGIN;

    CREATE INDEX IF NOT EXISTS "workflow_runs_status_available_at_created_at_idx"
    ON "${schema}"."workflow_runs" ("namespace_id", "status", "available_at", "created_at");

    CREATE INDEX IF NOT EXISTS "workflow_runs_workflow_name_idempotency_key_created_at_idx"
    ON "${schema}"."workflow_runs" ("namespace_id", "workflow_name", "idempotency_key", "created_at");

    CREATE INDEX IF NOT EXISTS "workflow_runs_parent_step_idx"
    ON "${schema}"."workflow_runs" ("parent_step_attempt_namespace_id", "parent_step_attempt_id")
    WHERE parent_step_attempt_namespace_id IS NOT NULL AND parent_step_attempt_id IS NOT NULL;

    CREATE INDEX IF NOT EXISTS "workflow_runs_created_at_desc_idx"
    ON "${schema}"."workflow_runs" ("namespace_id", "created_at" DESC);

    CREATE INDEX IF NOT EXISTS "workflow_runs_status_created_at_desc_idx"
    ON "${schema}"."workflow_runs" ("namespace_id", "status", "created_at" DESC);

    CREATE INDEX IF NOT EXISTS "workflow_runs_workflow_name_status_created_at_desc_idx"
    ON "${schema}"."workflow_runs" ("namespace_id", "workflow_name", "status", "created_at" DESC);

    CREATE INDEX IF NOT EXISTS "step_attempts_workflow_run_created_at_idx"
    ON "${schema}"."step_attempts" ("namespace_id", "workflow_run_id", "created_at");

    CREATE INDEX IF NOT EXISTS "step_attempts_workflow_run_step_name_created_at_idx"
    ON "${schema}"."step_attempts" ("namespace_id", "workflow_run_id", "step_name", "created_at");

    CREATE INDEX IF NOT EXISTS "step_attempts_child_workflow_run_idx"
    ON "${schema}"."step_attempts" ("child_workflow_run_namespace_id", "child_workflow_run_id")
    WHERE child_workflow_run_namespace_id IS NOT NULL AND child_workflow_run_id IS NOT NULL;

    INSERT INTO "${schema}"."openworkflow_migrations"("version")
    VALUES (4)
    ON CONFLICT DO NOTHING;

    COMMIT;`,
  ];
}

/**
 * migrate applies pending migrations to the database. Does nothing if the
 * database is already up to date.
 */
export async function migrate(pg: Postgres, schema: string) {
  const currentMigrationVersion = await getCurrentMigrationVersion(pg, schema);

  for (const [i, migrationSql] of migrations(schema).entries()) {
    if (i <= currentMigrationVersion) continue; // already applied

    await pg.unsafe(migrationSql);
  }
}

/**
 * dropSchema drops the specified schema from the database.
 */
export async function dropSchema(pg: Postgres, schema: string) {
  await pg.unsafe(`DROP SCHEMA IF EXISTS ${schema} CASCADE;`);
}

/**
 * getCurrentVersion returns the current migration version of the database.
 */
async function getCurrentMigrationVersion(
  pg: Postgres,
  schema: string,
): Promise<number> {
  // check if migrations table exists
  const existsRes = await pg.unsafe<{ exists: boolean }[]>(`
    SELECT EXISTS (
      SELECT 1
      FROM information_schema.tables
      WHERE table_schema = '${schema}'
      AND table_name = 'openworkflow_migrations'
    )`);
  if (!existsRes[0]?.exists) return -1;

  // get current version
  const currentVersionRes = await pg.unsafe<{ version: number }[]>(
    `SELECT MAX("version") AS "version" FROM "${schema}"."openworkflow_migrations";`,
  );
  return currentVersionRes[0]?.version ?? -1;
}
