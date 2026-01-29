import { BackendPostgres } from "@openworkflow/backend-postgres";
import { OpenWorkflow } from "openworkflow";

export const backend = await BackendPostgres.connect(
  "postgresql://postgres:postgres@localhost:5432/postgres",
);
export const ow = new OpenWorkflow({ backend });
