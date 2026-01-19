import { BackendPostgres } from "@openworkflow/backend-postgres";
import { defineConfig } from "@openworkflow/cli";

export default defineConfig({
  backend: await BackendPostgres.connect(
    "postgresql://postgres:postgres@localhost:5432/postgres",
  ),
  dirs: "./openworkflow",
});
