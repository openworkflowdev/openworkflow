import {
  migrate,
  newPostgresMaxOne,
  DEFAULT_SCHEMA,
  DEFAULT_POSTGRES_URL,
} from "./postgres.js";
import { teardownSharedTestPool } from "./test-backend.testsuite.js";

/** Run database migrations once before Postgres backend tests. */
export async function setup() {
  const pg = newPostgresMaxOne(DEFAULT_POSTGRES_URL);
  await migrate(pg, DEFAULT_SCHEMA);
  await pg.end();
}

/** Close the shared connection pool after all tests complete. */
export async function teardown() {
  await teardownSharedTestPool();
}
