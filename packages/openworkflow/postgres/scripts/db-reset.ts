import {
  DEFAULT_POSTGRES_URL,
  DEFAULT_SCHEMA,
  newPostgresMaxOne,
  dropSchema,
  migrate,
} from "../postgres.js";

const pg = newPostgresMaxOne(DEFAULT_POSTGRES_URL);
try {
  await dropSchema(pg, DEFAULT_SCHEMA);
} finally {
  await pg.end();
}
await migrate(DEFAULT_POSTGRES_URL, DEFAULT_SCHEMA);
