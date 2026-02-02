import { OpenWorkflow } from "openworkflow";
import { BackendPostgres } from "openworkflow/postgres";

export const backend = await BackendPostgres.connect(
  "postgresql://postgres:postgres@localhost:5432/postgres",
);
export const ow = new OpenWorkflow({ backend });
