export const SQLITE_CONFIG = `import { BackendSqlite } from "@openworkflow/backend-sqlite";
import { defineConfig } from "@openworkflow/cli";

export default defineConfig({
  // Use SQLite as the backend
  backend: BackendSqlite.connect("openworkflow/backend.db"),

  // The directories where your workflows are defined
  dirs: "./openworkflow",
});
`;

export const POSTGRES_CONFIG = `import { BackendPostgres } from "@openworkflow/backend-postgres";
import { defineConfig } from "@openworkflow/cli";

export default defineConfig({
  // Use Postgres as the backend
  backend: await BackendPostgres.connect(
    process.env["OPENWORKFLOW_POSTGRES_URL"],
  ),

  // The directories where your workflows are defined
  dirs: "./openworkflow",
});
`;

export const POSTGRES_PROD_SQLITE_DEV_CONFIG = `import { BackendPostgres } from "@openworkflow/backend-postgres";
import { BackendSqlite } from "@openworkflow/backend-sqlite";
import { defineConfig } from "@openworkflow/cli";

export default defineConfig({
  // Use Postgres as the backend in production, otherwise use SQLite
  backend:
    process.env["NODE_ENV"] === "production"
      ? await BackendPostgres.connect(process.env["OPENWORKFLOW_POSTGRES_URL"])
      : BackendSqlite.connect("openworkflow/backend.db"),

  // The directories where your workflows are defined
  dirs: "./openworkflow",
});
`;

export const HELLO_WORLD_WORKFLOW = `import { defineWorkflow } from "openworkflow";

/**
 * Example workflow that greets the world.
 * 
 * This workflow is auto-discovered by the CLI worker.
 * To trigger it, use ow.runWorkflow() from your app:
 * 
 *   import { helloWorld } from "./openworkflow/hello-world.js";
 *   const handle = await ow.runWorkflow(helloWorld.spec, {});
 *   const result = await handle.result();
 */
export const helloWorld = defineWorkflow(
  { name: "hello-world" },
  async ({ step }) => {
    const greeting = await step.run({ name: "greet" }, () => {
      return "Hello, World!";
    });

    await step.sleep("wait-a-bit", "1s");

    return { greeting };
  },
);
`;
