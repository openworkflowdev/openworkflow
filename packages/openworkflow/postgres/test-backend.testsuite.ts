import { BackendPostgres } from "./backend.js";
import {
  DEFAULT_POSTGRES_URL,
  newPostgres,
  type Postgres,
} from "./postgres.js";
import { randomUUID } from "node:crypto";

const SHARED_POOL = Symbol.for("openworkflow.postgres.pool");

/**
 * ProcessWithSharedTestPool extends the NodeJS.Process type to include a
 * shared Postgres pool at the SHARED_POOL symbol.
 */
type ProcessWithSharedTestPool = NodeJS.Process & {
  [SHARED_POOL]?: Postgres | undefined;
};

/**
 * Returns the shared Postgres pool for the current process.
 * @returns Shared Postgres pool
 */
function getSharedPool(): Postgres {
  const processWithSharedTestPool = process as ProcessWithSharedTestPool;
  const sharedPool = processWithSharedTestPool[SHARED_POOL];

  if (sharedPool) {
    return sharedPool;
  }

  const nextSharedPool = newPostgres(DEFAULT_POSTGRES_URL);
  processWithSharedTestPool[SHARED_POOL] = nextSharedPool;

  return nextSharedPool;
}

/**
 * Creates a BackendPostgres for a single test namespace while reusing a
 * process-wide Postgres pool.
 * @returns Backend instance for an isolated test namespace
 */
export async function createTestBackend(): Promise<BackendPostgres> {
  const backend = BackendPostgres.fromPool(getSharedPool(), {
    namespaceId: randomUUID(),
  });

  return await Promise.resolve(backend);
}

/**
 * Closes the shared connection pool when the current process is done with it.
 * @returns Promise resolved when the pool is closed
 */
export async function teardownSharedTestPool(): Promise<void> {
  const processWithSharedTestPool = process as ProcessWithSharedTestPool;
  const sharedPool = processWithSharedTestPool[SHARED_POOL];

  if (sharedPool) {
    await sharedPool.end();
    processWithSharedTestPool[SHARED_POOL] = undefined;
  }
}
