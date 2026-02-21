import postgres from "postgres";

export const DEFAULT_POSTGRES_URL =
  "postgresql://postgres:postgres@localhost:5432/postgres";

// The default schema to use for OpenWorkflow data.
export const DEFAULT_SCHEMA = "openworkflow";

export type Postgres = ReturnType<typeof postgres>;
export type PostgresOptions = Parameters<typeof postgres>[1];

const SCHEMA_NAME_PATTERN = /^[a-zA-Z_]\w*$/;
const MAX_POSTGRES_IDENTIFIER_BYTES = 63;

/**
 * newPostgres creates a new Postgres client.
 * @param url - Database connection URL
 * @param options - Postgres client options
 * @returns A Postgres client
 */
export function newPostgres(url: string, options?: PostgresOptions) {
  return postgres(url, { ...options, transform: postgres.toCamel });
}

/**
 * newPostgresMaxOne creates a new Postgres client with a maximum pool size of
 * one, which is useful for migrations.
 * @param url - Database connection URL
 * @param options - Postgres client options
 * @returns A Postgres client
 */
export function newPostgresMaxOne(url: string, options?: PostgresOptions) {
  return newPostgres(url, { ...options, max: 1 });
}

/**
 * migrations returns the list of migration SQL statements.
 * @param schema - Schema name
 * @returns Migration SQL statements
 */
export function migrations(schema: string): string[] {
  assertValidSchemaName(schema);
  const quotedSchema = quoteIdentifier(schema);

  return [
    // 0 - init
    `BEGIN;

    CREATE SCHEMA IF NOT EXISTS ${quotedSchema};

    CREATE TABLE IF NOT EXISTS ${quotedSchema}."openworkflow_migrations" (
      "version" BIGINT NOT NULL PRIMARY KEY
    );

    INSERT INTO ${quotedSchema}."openworkflow_migrations" ("version")
    VALUES (0)
    ON CONFLICT DO NOTHING;

    COMMIT;`,

    // 1 - add workflow_runs and step_attempts tables
    `BEGIN;

    CREATE TABLE IF NOT EXISTS ${quotedSchema}."workflow_runs" (
      "namespace_id" TEXT NOT NULL,
      "id" TEXT NOT NULL,
      --
      "workflow_name" TEXT NOT NULL,
      "version" TEXT,
      "status" TEXT NOT NULL,
      "idempotency_key" TEXT,
      "config" JSONB NOT NULL,
      "context" JSONB,
      "input" JSONB,
      "output" JSONB,
      "error" JSONB,
      "attempts" INTEGER NOT NULL,
      "parent_step_attempt_namespace_id" TEXT,
      "parent_step_attempt_id" TEXT,
      "worker_id" TEXT,
      "available_at" TIMESTAMPTZ,
      "deadline_at" TIMESTAMPTZ,
      "started_at" TIMESTAMPTZ,
      "finished_at" TIMESTAMPTZ,
      "created_at" TIMESTAMPTZ NOT NULL,
      "updated_at" TIMESTAMPTZ NOT NULL,
      PRIMARY KEY ("namespace_id", "id")
    );

    CREATE TABLE IF NOT EXISTS ${quotedSchema}."step_attempts" (
      "namespace_id" TEXT NOT NULL,
      "id" TEXT NOT NULL,
      --
      "workflow_run_id" TEXT NOT NULL,
      "step_name" TEXT NOT NULL,
      "kind" TEXT NOT NULL,
      "status" TEXT NOT NULL,
      "config" JSONB NOT NULL,
      "context" JSONB,
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

    INSERT INTO ${quotedSchema}."openworkflow_migrations" ("version")
    VALUES (1)
    ON CONFLICT DO NOTHING;
    
    COMMIT;`,

    // 2 - foreign keys
    `BEGIN;

    ALTER TABLE ${quotedSchema}."step_attempts"
    ADD CONSTRAINT "step_attempts_workflow_run_fk"
    FOREIGN KEY ("namespace_id", "workflow_run_id")
    REFERENCES ${quotedSchema}."workflow_runs" ("namespace_id", "id")
    ON DELETE CASCADE
    NOT VALID;

    ALTER TABLE ${quotedSchema}."workflow_runs"
    ADD CONSTRAINT "workflow_runs_parent_step_attempt_fk"
    FOREIGN KEY ("parent_step_attempt_namespace_id", "parent_step_attempt_id")
    REFERENCES ${quotedSchema}."step_attempts" ("namespace_id", "id")
    ON DELETE SET NULL
    NOT VALID;

    ALTER TABLE ${quotedSchema}."step_attempts"
    ADD CONSTRAINT "step_attempts_child_workflow_run_fk"
    FOREIGN KEY ("child_workflow_run_namespace_id", "child_workflow_run_id")
    REFERENCES ${quotedSchema}."workflow_runs" ("namespace_id", "id")
    ON DELETE SET NULL
    NOT VALID;

    INSERT INTO ${quotedSchema}."openworkflow_migrations" ("version")
    VALUES (2)
    ON CONFLICT DO NOTHING;

    COMMIT;`,

    // 3 - validate foreign keys
    `BEGIN;

    ALTER TABLE ${quotedSchema}."step_attempts"
    VALIDATE CONSTRAINT "step_attempts_workflow_run_fk";
    
    ALTER TABLE ${quotedSchema}."workflow_runs" VALIDATE CONSTRAINT
    "workflow_runs_parent_step_attempt_fk";

    ALTER TABLE ${quotedSchema}."step_attempts"
    VALIDATE CONSTRAINT "step_attempts_child_workflow_run_fk";

    INSERT INTO ${quotedSchema}."openworkflow_migrations" ("version")
    VALUES (3)
    ON CONFLICT DO NOTHING;

    COMMIT;`,

    // 4 - indexes
    `BEGIN;

    CREATE INDEX IF NOT EXISTS "workflow_runs_status_available_at_created_at_idx"
    ON ${quotedSchema}."workflow_runs" ("namespace_id", "status", "available_at", "created_at");

    CREATE INDEX IF NOT EXISTS "workflow_runs_workflow_name_idempotency_key_created_at_idx"
    ON ${quotedSchema}."workflow_runs" ("namespace_id", "workflow_name", "idempotency_key", "created_at");

    CREATE INDEX IF NOT EXISTS "workflow_runs_parent_step_idx"
    ON ${quotedSchema}."workflow_runs" ("parent_step_attempt_namespace_id", "parent_step_attempt_id")
    WHERE parent_step_attempt_namespace_id IS NOT NULL AND parent_step_attempt_id IS NOT NULL;

    CREATE INDEX IF NOT EXISTS "workflow_runs_created_at_desc_idx"
    ON ${quotedSchema}."workflow_runs" ("namespace_id", "created_at" DESC);

    CREATE INDEX IF NOT EXISTS "workflow_runs_status_created_at_desc_idx"
    ON ${quotedSchema}."workflow_runs" ("namespace_id", "status", "created_at" DESC);

    CREATE INDEX IF NOT EXISTS "workflow_runs_workflow_name_status_created_at_desc_idx"
    ON ${quotedSchema}."workflow_runs" ("namespace_id", "workflow_name", "status", "created_at" DESC);

    CREATE INDEX IF NOT EXISTS "step_attempts_workflow_run_created_at_idx"
    ON ${quotedSchema}."step_attempts" ("namespace_id", "workflow_run_id", "created_at");

    CREATE INDEX IF NOT EXISTS "step_attempts_workflow_run_step_name_created_at_idx"
    ON ${quotedSchema}."step_attempts" ("namespace_id", "workflow_run_id", "step_name", "created_at");

    CREATE INDEX IF NOT EXISTS "step_attempts_child_workflow_run_idx"
    ON ${quotedSchema}."step_attempts" ("child_workflow_run_namespace_id", "child_workflow_run_id")
    WHERE child_workflow_run_namespace_id IS NOT NULL AND child_workflow_run_id IS NOT NULL;

    INSERT INTO ${quotedSchema}."openworkflow_migrations"("version")
    VALUES (4)
    ON CONFLICT DO NOTHING;

    COMMIT;`,

    // 5 - workflow concurrency columns and indexes
    `BEGIN;

    ALTER TABLE ${quotedSchema}."workflow_runs"
    ADD COLUMN IF NOT EXISTS "concurrency_key" TEXT;

    ALTER TABLE ${quotedSchema}."workflow_runs"
    ADD COLUMN IF NOT EXISTS "concurrency_limit" INTEGER;

    CREATE INDEX IF NOT EXISTS "workflow_runs_concurrency_active_idx"
    ON ${quotedSchema}."workflow_runs" (
      "namespace_id",
      "workflow_name",
      "version",
      "concurrency_key",
      "status",
      "available_at"
    )
    WHERE "concurrency_limit" IS NOT NULL;

    INSERT INTO ${quotedSchema}."openworkflow_migrations"("version")
    VALUES (5)
    ON CONFLICT DO NOTHING;

    COMMIT;`,
  ];
}

/**
 * migrate applies pending migrations to the database. Does nothing if the
 * database is already up to date.
 * @param pg - Postgres client
 * @param schema - Schema name
 * @returns Promise resolved when migrations complete
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
 * @param pg - Postgres client
 * @param schema - Schema name
 * @returns Promise resolved when the schema is dropped
 */
export async function dropSchema(pg: Postgres, schema: string) {
  assertValidSchemaName(schema);
  await pg.unsafe(`DROP SCHEMA IF EXISTS ${quoteIdentifier(schema)} CASCADE;`);
}

/**
 * getCurrentVersion returns the current migration version of the database.
 * @param pg - Postgres client
 * @param schema - Schema name
 * @returns Current migration version
 */
async function getCurrentMigrationVersion(
  pg: Postgres,
  schema: string,
): Promise<number> {
  assertValidSchemaName(schema);

  // check if migrations table exists
  const existsRes = await pg.unsafe<{ exists: boolean }[]>(
    `
    SELECT EXISTS (
      SELECT 1
      FROM information_schema.tables
      WHERE table_schema = $1
      AND table_name = 'openworkflow_migrations'
    )`,
    [schema],
  );
  if (!existsRes[0]?.exists) return -1;

  // get current version
  const quotedSchema = quoteIdentifier(schema);
  const currentVersionRes = await pg.unsafe<{ version: number }[]>(
    `SELECT MAX("version") AS "version" FROM ${quotedSchema}."openworkflow_migrations";`,
  );
  return currentVersionRes[0]?.version ?? -1;
}

/**
 * assertValidSchemaName validates Postgres schema names used by OpenWorkflow.
 * @param schema - Schema name to validate
 * @throws {Error} If the schema name is not a valid Postgres identifier
 */
export function assertValidSchemaName(schema: string): void {
  if (!SCHEMA_NAME_PATTERN.test(schema)) {
    throw new Error(
      `Invalid schema name "${schema}". Use a Postgres identifier (letters, numbers, underscores; cannot start with a number).`,
    );
  }

  if (Buffer.byteLength(schema, "utf8") > MAX_POSTGRES_IDENTIFIER_BYTES) {
    throw new Error(
      `Invalid schema name "${schema}". Postgres identifiers must be at most ${String(MAX_POSTGRES_IDENTIFIER_BYTES)} bytes.`,
    );
  }
}

/**
 * quoteIdentifier returns a SQL-quoted identifier.
 * @param identifier - Identifier that has already been validated
 * @returns Quoted identifier
 */
function quoteIdentifier(identifier: string): string {
  return `"${identifier}"`;
}
