import { BackendPostgres } from "@openworkflow/backend-postgres";
import { BackendSqlite } from "@openworkflow/backend-sqlite";
import { OpenWorkflow } from "openworkflow";

const isProduction = process.env["NODE_ENV"] === "production";
const databaseUrl = process.env["DATABASE_URL"];

// Use Postgres in production (configured with DATABASE_URL), otherwise use
// in-memory SQLite
const backend =
  isProduction && databaseUrl
    ? await BackendPostgres.connect(databaseUrl)
    : BackendSqlite.connect(":memory:");

const ow = new OpenWorkflow({ backend });

export default { ow };
