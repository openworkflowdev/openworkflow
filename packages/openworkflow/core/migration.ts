export const MIGRATION_WAIT_TIMEOUT_MS = 5 * 60 * 1000;

/**
 * Return pending SQL batches in migration order. Each array position is a
 * version; -- statement-breakpoint separates batches that must execute
 * independently.
 * @param migrations - Versioned migration SQL
 * @param version - Last applied version, or -1 for a new database
 * @returns SQL batches to execute sequentially
 */
export function pendingStatements(
  migrations: readonly string[],
  version: number,
): string[] {
  return migrations
    .slice(version + 1)
    .flatMap((sql) => sql.split("-- statement-breakpoint"));
}
