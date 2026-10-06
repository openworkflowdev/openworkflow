import { DEFAULT_POSTGRES_URL, DEFAULT_SCHEMA, migrate } from "../postgres.js";

await migrate(DEFAULT_POSTGRES_URL, DEFAULT_SCHEMA);
