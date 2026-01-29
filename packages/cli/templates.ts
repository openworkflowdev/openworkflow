export const SQLITE_CLIENT = `import { BackendSqlite } from "@openworkflow/backend-sqlite";
import { OpenWorkflow } from "openworkflow";

export const backend = BackendSqlite.connect("openworkflow/backend.db");
export const ow = new OpenWorkflow({ backend });
`;

export const POSTGRES_CLIENT = `import { BackendPostgres } from "@openworkflow/backend-postgres";
import { OpenWorkflow } from "openworkflow";

export const backend = await BackendPostgres.connect(
  process.env["OPENWORKFLOW_POSTGRES_URL"],
);
export const ow = new OpenWorkflow({ backend });
`;

export const POSTGRES_PROD_SQLITE_DEV_CLIENT = `import { BackendPostgres } from "@openworkflow/backend-postgres";
import { BackendSqlite } from "@openworkflow/backend-sqlite";
import { OpenWorkflow } from "openworkflow";

export const backend =
  process.env["NODE_ENV"] === "production"
    ? await BackendPostgres.connect(process.env["OPENWORKFLOW_POSTGRES_URL"])
    : BackendSqlite.connect("openworkflow/backend.db");
export const ow = new OpenWorkflow({ backend });
`;

export const CONFIG = `import { backend } from "./openworkflow/client.js";
import { defineConfig } from "@openworkflow/cli";

export default defineConfig({
  backend,
  dirs: "./openworkflow",
});
`;

export const HELLO_WORLD_WORKFLOW = `import { defineWorkflow } from "openworkflow";

/**
 * Example workflow that greets the world.
 *
 * This workflow is auto-discovered by the CLI worker.
 * To trigger it, use ow.runWorkflow() from your app:
 * \`\`\`ts
 * import { ow } from "./openworkflow/client.js";
 * import { helloWorld } from "./openworkflow/hello-world.js";
 * const handle = await ow.runWorkflow(helloWorld.spec, {});
 * const result = await handle.result();
 * \`\`\`
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
