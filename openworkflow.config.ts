import { BackendPostgres } from "@openworkflow/backend-postgres";
import { OpenWorkflow } from "openworkflow";

const backend = await BackendPostgres.connect(
  "postgresql://postgres:postgres@localhost:5432/postgres",
);
const ow = new OpenWorkflow({ backend });

export default {
  ow,
  port: 3000,
};
