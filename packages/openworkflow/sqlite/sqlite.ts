import { randomUUID } from "node:crypto";

/**
 * Common database interface that both Node and Bun SQLite drivers satisfy.
 */
export interface Database {
  exec(sql: string): void;
  prepare(sql: string): {
    run(...params: unknown[]): { changes: number };
    get(...params: unknown[]): unknown;
    all(...params: unknown[]): unknown[];
  };
  close(): void;
}

/**
 * newDatabase creates a new SQLite database connection.
 * Uses node:sqlite in Node.js or bun:sqlite in Bun.
 * @param path - Database file path (or ":memory:") for testing
 * @returns SQLite database connection
 */
export function newDatabase(path: string): Database {
  let db: Database;

  const isBun = (globalThis as { Bun?: unknown }).Bun !== undefined;

  if (isBun) {
    /* v8 ignore start -- Bun tests are run in CI via ci.bun.yaml */
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { Database: BunDatabase } = require("bun:sqlite") as {
      Database: new (path: string) => Database;
    };
    db = new BunDatabase(path);
    /* v8 ignore stop */
  } else {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { DatabaseSync } = require("node:sqlite") as {
      DatabaseSync: new (path: string) => Database;
    };
    db = new DatabaseSync(path);
  }

  // Only enable WAL mode for file-based databases
  if (path !== ":memory:") {
    db.exec("PRAGMA journal_mode = WAL;");
  }
  db.exec("PRAGMA foreign_keys = ON;");
  return db;
}

/**
 * migrations returns the list of migration SQL statements.
 * @returns Migration SQL statements
 */
export function migrations(): string[] {
  return [
    // 0 - init
    `BEGIN;

    CREATE TABLE IF NOT EXISTS "openworkflow_migrations" (
      "version" INTEGER NOT NULL PRIMARY KEY
    );

    INSERT OR IGNORE INTO "openworkflow_migrations" ("version")
    VALUES (0);

    COMMIT;`,

    // 1 - add workflow_runs and step_attempts tables
    `BEGIN;

    PRAGMA defer_foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS "workflow_runs" (
      "namespace_id" TEXT NOT NULL,
      "id" TEXT NOT NULL,
      --
      "workflow_name" TEXT NOT NULL,
      "version" TEXT,
      "status" TEXT NOT NULL,
      "idempotency_key" TEXT,
      "config" TEXT NOT NULL,
      "context" TEXT,
      "input" TEXT,
      "output" TEXT,
      "error" TEXT,
      "attempts" INTEGER NOT NULL,
      "parent_step_attempt_namespace_id" TEXT,
      "parent_step_attempt_id" TEXT,
      "worker_id" TEXT,
      "available_at" TEXT,
      "deadline_at" TEXT,
      "started_at" TEXT,
      "finished_at" TEXT,
      "created_at" TEXT NOT NULL,
      "updated_at" TEXT NOT NULL,
      PRIMARY KEY ("namespace_id", "id"),
      FOREIGN KEY ("parent_step_attempt_namespace_id", "parent_step_attempt_id")
        REFERENCES "step_attempts" ("namespace_id", "id")
        ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS "step_attempts" (
      "namespace_id" TEXT NOT NULL,
      "id" TEXT NOT NULL,
      --
      "workflow_run_id" TEXT NOT NULL,
      "step_name" TEXT NOT NULL,
      "kind" TEXT NOT NULL,
      "status" TEXT NOT NULL,
      "config" TEXT NOT NULL,
      "context" TEXT,
      "output" TEXT,
      "error" TEXT,
      "child_workflow_run_namespace_id" TEXT,
      "child_workflow_run_id" TEXT,
      "started_at" TEXT,
      "finished_at" TEXT,
      "created_at" TEXT NOT NULL,
      "updated_at" TEXT NOT NULL,
      PRIMARY KEY ("namespace_id", "id"),
      FOREIGN KEY ("namespace_id", "workflow_run_id")
        REFERENCES "workflow_runs" ("namespace_id", "id")
        ON DELETE CASCADE,
      FOREIGN KEY ("child_workflow_run_namespace_id", "child_workflow_run_id")
        REFERENCES "workflow_runs" ("namespace_id", "id")
        ON DELETE SET NULL
    );

    INSERT OR IGNORE INTO "openworkflow_migrations" ("version")
    VALUES (1);

    COMMIT;`,

    // 2 - foreign keys
    `BEGIN;

    -- Foreign keys are defined in migration 1 since SQLite requires them during table creation
    -- This migration exists for version parity with PostgreSQL backend

    INSERT OR IGNORE INTO "openworkflow_migrations" ("version")
    VALUES (2);

    COMMIT;`,

    // 3 - validate foreign keys
    `BEGIN;

    -- Foreign key validation happens automatically in SQLite when PRAGMA foreign_keys = ON
    -- This migration exists for version parity with PostgreSQL backend

    INSERT OR IGNORE INTO "openworkflow_migrations" ("version")
    VALUES (3);

    COMMIT;`,

    // 4 - indexes
    `BEGIN;

    CREATE INDEX IF NOT EXISTS "workflow_runs_status_available_at_created_at_idx"
    ON "workflow_runs" ("namespace_id", "status", "available_at", "created_at");

    CREATE INDEX IF NOT EXISTS "workflow_runs_workflow_name_idempotency_key_created_at_idx"
    ON "workflow_runs" ("namespace_id", "workflow_name", "idempotency_key", "created_at");

    CREATE INDEX IF NOT EXISTS "workflow_runs_parent_step_idx"
    ON "workflow_runs" ("parent_step_attempt_namespace_id", "parent_step_attempt_id")
    WHERE parent_step_attempt_namespace_id IS NOT NULL AND parent_step_attempt_id IS NOT NULL;

    CREATE INDEX IF NOT EXISTS "workflow_runs_created_at_desc_idx"
    ON "workflow_runs" ("namespace_id", "created_at" DESC);

    CREATE INDEX IF NOT EXISTS "workflow_runs_status_created_at_desc_idx"
    ON "workflow_runs" ("namespace_id", "status", "created_at" DESC);

    CREATE INDEX IF NOT EXISTS "workflow_runs_workflow_name_status_created_at_desc_idx"
    ON "workflow_runs" ("namespace_id", "workflow_name", "status", "created_at" DESC);

    CREATE INDEX IF NOT EXISTS "step_attempts_workflow_run_created_at_idx"
    ON "step_attempts" ("namespace_id", "workflow_run_id", "created_at");

    CREATE INDEX IF NOT EXISTS "step_attempts_workflow_run_step_name_created_at_idx"
    ON "step_attempts" ("namespace_id", "workflow_run_id", "step_name", "created_at");

    CREATE INDEX IF NOT EXISTS "step_attempts_child_workflow_run_idx"
    ON "step_attempts" ("child_workflow_run_namespace_id", "child_workflow_run_id")
    WHERE child_workflow_run_namespace_id IS NOT NULL AND child_workflow_run_id IS NOT NULL;

    INSERT OR IGNORE INTO "openworkflow_migrations" ("version")
    VALUES (4);

    COMMIT;`,
  ];
}

/**
 * migrate applies pending migrations to the database. Does nothing if the
 * database is already up to date.
 * @param db - SQLite database
 */
export function migrate(db: Database): void {
  const currentMigrationVersion = getCurrentMigrationVersion(db);

  for (const [i, migrationSql] of migrations().entries()) {
    if (i <= currentMigrationVersion) continue; // already applied

    db.exec(migrationSql);
  }
}

/**
 * getCurrentMigrationVersion returns the current migration version of the database.
 * @param db - SQLite database
 * @returns Current migration version
 */
function getCurrentMigrationVersion(db: Database): number {
  // check if migrations table exists
  const existsStmt = db.prepare(`
    SELECT COUNT(*) as count
    FROM sqlite_master
    WHERE type = 'table' AND name = 'openworkflow_migrations'
  `);
  const existsResult = existsStmt.get() as { count: number } | undefined;
  if (!existsResult || existsResult.count === 0) return -1;

  // get current version
  const versionStmt = db.prepare(
    `SELECT MAX("version") AS "version" FROM "openworkflow_migrations";`,
  );
  const versionResult = versionStmt.get() as { version: number } | undefined;
  return versionResult?.version ?? -1;
}

/**
 * Helper to generate UUIDs (SQLite doesn't have built-in UUID generation)
 * @returns A UUID string
 */
export function generateUUID(): string {
  return randomUUID();
}

/**
 * Helper to get current timestamp in ISO8601 format
 * @returns ISO8601 timestamp string
 */
export function now(): string {
  return new Date().toISOString();
}

/**
 * Helper to add milliseconds to a date and return ISO8601 string
 * @param date - ISO8601 date string
 * @param ms - Milliseconds to add
 * @returns Updated ISO8601 date string
 */
export function addMilliseconds(date: string, ms: number): string {
  const d = new Date(date);
  d.setMilliseconds(d.getMilliseconds() + ms);
  return d.toISOString();
}

/**
 * Helper to serialize JSON for SQLite storage
 * @param value - Value to serialize
 * @returns JSON string or null
 */
export function toJSON(value: unknown): string | null {
  return value === null || value === undefined ? null : JSON.stringify(value);
}

/**
 * Helper to deserialize JSON from SQLite storage
 * @param value - JSON string or null
 * @returns Parsed value
 */
export function fromJSON(value: string | null): unknown {
  return value === null ? null : JSON.parse(value);
}

/**
 * Helper to convert Date to ISO8601 string for SQLite
 * @param date - Date or null
 * @returns ISO8601 date string or null
 */
export function toISO(date: Date | null): string | null {
  return date ? date.toISOString() : null;
}

/**
 * Helper to convert ISO8601 string from SQLite to Date
 * @param dateStr - ISO8601 date string or null
 * @returns Date or null
 */
export function fromISO(dateStr: string | null): Date | null {
  return dateStr ? new Date(dateStr) : null;
}
