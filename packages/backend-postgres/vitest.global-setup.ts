import {
  migrate,
  newPostgresMaxOne,
  DEFAULT_SCHEMA,
  DEFAULT_DATABASE_URL,
} from "./postgres.js";

export async function setup() {
  // hack to run migrations once before all tests instead of having tests trying
  // to do migrations in parallel causing "pg_class_relname_nsp_index" error
  const pg = newPostgresMaxOne(DEFAULT_DATABASE_URL);
  await migrate(pg, DEFAULT_SCHEMA);
  await pg.end();
}
