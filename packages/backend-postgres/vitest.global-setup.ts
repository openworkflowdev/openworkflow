import {
  migrate,
  newPostgresMaxOne,
  DEFAULT_SCHEMA,
  DEFAULT_DATABASE_URL,
} from "./postgres.js";

/** Run database migrations once before Postgres backend tests. */
export async function setup() {
  const pg = newPostgresMaxOne(DEFAULT_DATABASE_URL);
  await migrate(pg, DEFAULT_SCHEMA);
  await pg.end();
}
