import {
  DEFAULT_POSTGRES_URL,
  DEFAULT_SCHEMA,
  newPostgresMaxOne,
  migrate,
} from "../postgres.js";

const pg = newPostgresMaxOne(DEFAULT_POSTGRES_URL);
await migrate(pg, DEFAULT_SCHEMA);
await pg.end();
