export const SQLITE_CONFIG = `import { BackendSqlite } from "@openworkflow/backend-sqlite";
import { defineConfig } from "openworkflow";

export default defineConfig({
  // Use SQLite as the backend
  backend: BackendSqlite.connect(":memory:"),

  // The directories where your workflows are defined
  dirs: "./openworkflow",
});
`;

export const POSTGRES_CONFIG = `import { BackendPostgres } from "@openworkflow/backend-postgres";
import { defineConfig } from "openworkflow";

export default defineConfig({
  // Use Postgres as the backend
  backend: await BackendPostgres.connect(process.env["OPENWORKFLOW_POSTGRES_URL"]),

  // The directories where your workflows are defined
  dirs: "./openworkflow",
});
`;

export const POSTGRES_PROD_SQLITE_DEV_CONFIG = `import { BackendPostgres } from "@openworkflow/backend-postgres";
import { BackendSqlite } from "@openworkflow/backend-sqlite";
import { defineConfig } from "openworkflow";

export default defineConfig({
  // Use Postgres as the backend in production, otherwise use SQLite
  backend:
    process.env["NODE_ENV"] === "production"
      ? await BackendPostgres.connect(process.env["OPENWORKFLOW_POSTGRES_URL"])
      : BackendSqlite.connect(":memory:"),

  // The directories where your workflows are defined
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
