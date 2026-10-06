import { pendingStatements } from "./migration.js";
import { describe, expect, test } from "vitest";

describe("pendingStatements", () => {
  const migrations = [
    "BEGIN;\nCREATE TABLE runs (id INT);\nCOMMIT;",
    "CREATE INDEX runs_id_idx ON runs (id);\n-- statement-breakpoint\nSELECT 1;",
    "ALTER TABLE runs ADD COLUMN output TEXT;",
  ];

  test("preserves SQL and batch order for a new database", () => {
    expect(pendingStatements(migrations, -1)).toEqual([
      "BEGIN;\nCREATE TABLE runs (id INT);\nCOMMIT;",
      "CREATE INDEX runs_id_idx ON runs (id);\n",
      "\nSELECT 1;",
      "ALTER TABLE runs ADD COLUMN output TEXT;",
    ]);
  });

  test("skips every batch in applied migration versions", () => {
    expect(pendingStatements(migrations, 1)).toEqual([
      "ALTER TABLE runs ADD COLUMN output TEXT;",
    ]);
  });

  test("returns no batches when all migrations are applied", () => {
    expect(pendingStatements(migrations, 2)).toEqual([]);
  });
});
