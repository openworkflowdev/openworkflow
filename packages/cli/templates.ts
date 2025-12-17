export const SQLITE_CONFIG = `import { BackendSqlite } from "@openworkflow/backend-sqlite";
import { defineConfig } from "openworkflow";

// Use in-memory SQLite for development and testing
const backend = BackendSqlite.connect(":memory:");

export default defineConfig({
  backend,
  dirs: "./openworkflow",
});
`;

export const POSTGRES_CONFIG = `import { BackendPostgres } from "@openworkflow/backend-postgres";
import { defineConfig } from "openworkflow";

const databaseUrl = process.env["DATABASE_URL"];

if (!databaseUrl) {
  throw new Error("DATABASE_URL environment variable is required");
}

const backend = await BackendPostgres.connect(databaseUrl);

export default defineConfig({
  backend,
  dirs: "./openworkflow",
});
`;

export const POSTGRES_PROD_SQLITE_DEV_CONFIG = `import { BackendPostgres } from "@openworkflow/backend-postgres";
import { BackendSqlite } from "@openworkflow/backend-sqlite";
import { defineConfig } from "openworkflow";

const isProduction = process.env["NODE_ENV"] === "production";
const databaseUrl = process.env["DATABASE_URL"];

// Use Postgres in production (configured with DATABASE_URL), otherwise use
// in-memory SQLite
const backend =
  isProduction && databaseUrl
    ? await BackendPostgres.connect(databaseUrl)
    : BackendSqlite.connect(":memory:");

export default defineConfig({
  backend,
  dirs: "./openworkflow",
});
`;

export const HELLO_WORLD_WORKFLOW = `import { defineWorkflow } from "openworkflow/internal";

export interface HelloWorldInput {
  name?: string;
}

export interface HelloWorldOutput {
  greeting: string;
}

export const helloWorld = defineWorkflow<HelloWorldInput, HelloWorldOutput>(
  { name: "hello-world" },
  async ({ input, step }) => {
    const greeting = await step.run({ name: "greet" }, () => {
      const name = input.name ?? "World";
      return \`Hello, \${name}!\`;
    });
    
    console.log(greeting);
    
    return { greeting };
  },
);
`;
