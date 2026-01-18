import { BackendSqlite } from "@openworkflow/backend-sqlite";
import { defineConfig } from "@openworkflow/cli";

// eslint-disable-next-line sonarjs/publicly-writable-directories
const sqliteFileName = "/tmp/openworkflow_example_workflow_discovery.db";

export default defineConfig({
  backend: BackendSqlite.connect(sqliteFileName),
  dirs: "./openworkflow",
});
