import { defineConfig } from "@openworkflow/cli";
import { BackendSqlite } from "openworkflow/sqlite";

const sqliteFileName = "/tmp/openworkflow_example_workflow_discovery.db";

export default defineConfig({
  backend: BackendSqlite.connect(sqliteFileName),
  dirs: "./openworkflow",
});
