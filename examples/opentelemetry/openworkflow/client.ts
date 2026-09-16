import { OpenWorkflow } from "openworkflow";
import { BackendSqlite } from "openworkflow/sqlite";

export const backend = BackendSqlite.connect(":memory:");
export const ow = new OpenWorkflow({ backend });
