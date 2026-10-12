import { migrate, DEFAULT_SCHEMA } from "./postgres.js";
import {
  teardownSharedTestPool,
  TEST_POSTGRES_URL,
} from "./test-backend.testsuite.js";

/** Run database migrations once before Postgres backend tests. */
export async function setup() {
  await migrate(TEST_POSTGRES_URL, DEFAULT_SCHEMA);
}

/** Close the shared connection pool after all tests complete. */
export async function teardown() {
  await teardownSharedTestPool();
}
