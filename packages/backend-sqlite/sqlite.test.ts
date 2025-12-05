import { Database, newDatabase, migrations, migrate } from "./sqlite.js";
import { randomUUID } from "node:crypto";
import { unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

// Helper to get the current migration version (exported for testing)
// Note: This function exists in sqlite.ts but isn't exported, so we'll
// test it indirectly through migrate() and by checking the migrations table
function getMigrationVersion(db: Database): number {
  const existsStmt = db.prepare(`
    SELECT COUNT(*) as count
    FROM sqlite_master
    WHERE type = 'table' AND name = 'openworkflow_migrations'
  `);
  const existsResult = existsStmt.get() as { count: number } | undefined;
  if (!existsResult || existsResult.count === 0) return -1;

  const versionStmt = db.prepare(
    `SELECT MAX("version") AS "version" FROM "openworkflow_migrations";`,
  );
  const versionResult = versionStmt.get() as { version: number } | undefined;
  return versionResult?.version ?? -1;
}

describe("sqlite", () => {
  let db: Database;
  let dbPath: string;

  beforeEach(() => {
    // Use a unique file path for each test to ensure isolation
    dbPath = path.join(tmpdir(), `test_${randomUUID()}.db`);
    db = newDatabase(dbPath);
  });

  afterEach(() => {
    db.close();
    // Clean up the test database file
    try {
      unlinkSync(dbPath);
    } catch {
      // Ignore cleanup errors
    }
  });

  describe("migrations()", () => {
    test("returns migration SQL statements with correct table names", () => {
      const migs = migrations();
      expect(migs.length).toBeGreaterThan(0);

      // Check that migrations reference the openworkflow_migrations table
      for (const mig of migs) {
        expect(mig).toContain("openworkflow_migrations");
      }

      // Verify first migration creates the migrations table
      expect(migs[0]).toContain(
        'CREATE TABLE IF NOT EXISTS "openworkflow_migrations"',
      );
      expect(migs[0]).toContain('"version"');
    });

    test("migrations create workflow_runs and step_attempts tables", () => {
      const migs = migrations();

      // Migration 1 should create workflow_runs and step_attempts
      const migration1 = migs[1];
      expect(migration1).toContain(
        'CREATE TABLE IF NOT EXISTS "workflow_runs"',
      );
      expect(migration1).toContain(
        'CREATE TABLE IF NOT EXISTS "step_attempts"',
      );
    });
  });

  describe("migrate()", () => {
    test("runs database migrations idempotently", () => {
      // First migration
      migrate(db);
      const version1 = getMigrationVersion(db);
      expect(version1).toBeGreaterThanOrEqual(0);

      // Second migration - should not cause errors
      migrate(db);
      const version2 = getMigrationVersion(db);
      expect(version2).toBe(version1); // Version should not change

      // Third migration - should still work
      migrate(db);
      const version3 = getMigrationVersion(db);
      expect(version3).toBe(version1);
    });

    test("tracks migration versions correctly", () => {
      // Before migration, version should be -1 (table doesn't exist)
      let version = getMigrationVersion(db);
      expect(version).toBe(-1);

      // After migration, version should be the latest migration version
      migrate(db);
      version = getMigrationVersion(db);

      const allMigrations = migrations();
      const expectedLatestVersion = allMigrations.length - 1;
      expect(version).toBe(expectedLatestVersion);
    });

    test("applies migrations incrementally", () => {
      // Create the migrations table manually with version 0
      db.exec(`
        CREATE TABLE IF NOT EXISTS "openworkflow_migrations" (
          "version" INTEGER NOT NULL PRIMARY KEY
        );
        INSERT OR IGNORE INTO "openworkflow_migrations" ("version")
        VALUES (0);
      `);

      let version = getMigrationVersion(db);
      expect(version).toBe(0);

      // Run migrate - should apply remaining migrations
      migrate(db);
      version = getMigrationVersion(db);

      const allMigrations = migrations();
      const expectedLatestVersion = allMigrations.length - 1;
      expect(version).toBe(expectedLatestVersion);
    });

    test("creates all required tables after migration", () => {
      migrate(db);

      // Check that migrations table exists
      const migrationsCheck = db
        .prepare(
          `
        SELECT COUNT(*) as count
        FROM sqlite_master
        WHERE type = 'table' AND name = 'openworkflow_migrations'
      `,
        )
        .get() as { count: number };
      expect(migrationsCheck.count).toBe(1);

      // Check that workflow_runs table exists
      const workflowRunsCheck = db
        .prepare(
          `
        SELECT COUNT(*) as count
        FROM sqlite_master
        WHERE type = 'table' AND name = 'workflow_runs'
      `,
        )
        .get() as { count: number };
      expect(workflowRunsCheck.count).toBe(1);

      // Check that step_attempts table exists
      const stepAttemptsCheck = db
        .prepare(
          `
        SELECT COUNT(*) as count
        FROM sqlite_master
        WHERE type = 'table' AND name = 'step_attempts'
      `,
        )
        .get() as { count: number };
      expect(stepAttemptsCheck.count).toBe(1);
    });
  });

  describe("migration version tracking", () => {
    test("migrations table stores version numbers correctly", () => {
      migrate(db);

      const versionStmt = db.prepare(
        `SELECT "version" FROM "openworkflow_migrations" ORDER BY "version";`,
      );
      const versions = versionStmt.all() as { version: number }[];

      // Should have all migration versions from 0 to latest
      const allMigrations = migrations();
      const expectedLatestVersion = allMigrations.length - 1;

      expect(versions.length).toBe(expectedLatestVersion + 1);
      for (let i = 0; i <= expectedLatestVersion; i++) {
        const version = versions[i];
        expect(version).toBeDefined();
        expect(version?.version).toBe(i);
      }
    });

    test("migrations can be run multiple times safely with INSERT OR IGNORE", () => {
      migrate(db);
      const versionAfterFirst = getMigrationVersion(db);

      // Run migrations again
      migrate(db);
      const versionAfterSecond = getMigrationVersion(db);

      expect(versionAfterSecond).toBe(versionAfterFirst);

      // Check that version entries aren't duplicated
      const versionStmt = db.prepare(
        `SELECT COUNT(*) as count FROM "openworkflow_migrations";`,
      );
      const countResult = versionStmt.get() as { count: number };
      const allMigrations = migrations();
      const expectedCount = allMigrations.length;
      expect(countResult.count).toBe(expectedCount);
    });
  });
});
