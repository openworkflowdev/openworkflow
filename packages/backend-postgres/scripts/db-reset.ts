import {
  DEFAULT_POSTGRES_URL,
  DEFAULT_SCHEMA,
  newPostgresMaxOne,
  dropSchema,
  migrate,
} from "../postgres.js";

const pg = newPostgresMaxOne(DEFAULT_POSTGRES_URL);
await dropSchema(pg, DEFAULT_SCHEMA);
await migrate(pg, DEFAULT_SCHEMA);
await pg.end();
