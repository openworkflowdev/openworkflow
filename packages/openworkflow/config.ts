import { Backend } from "./backend.js";
import { WorkerOptions } from "./worker.js";

export interface OpenWorkflowConfig {
  backend: Backend;
  worker?: WorkerConfig;
}

export type WorkerConfig = Pick<WorkerOptions, "concurrency">;

/**
 * Create a typed OpenWorkflow configuration.
 * @param config - the config
 * @returns the config
 */
export function defineConfig(config: OpenWorkflowConfig): OpenWorkflowConfig {
  return config;
}
