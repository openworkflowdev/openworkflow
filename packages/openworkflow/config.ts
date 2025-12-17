import { Backend } from "./backend.js";
import { WorkerOptions } from "./worker.js";
import { loadConfig as loadC12Config } from "c12";

export interface OpenWorkflowConfig {
  backend: Backend;
  worker?: WorkerConfig;
  /**
   * Directory or directories to scan for workflow files.
   * All `.ts` and `.js` files in these directories (recursively) will be loaded.
   * Workflow files should export workflows created with `defineWorkflow()`.
   * @example "./openworkflow"
   * @example ["./openworkflow", "./src/openworkflow", "./workflows"]
   */
  dirs?: string | string[];
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

/**
 * Load the OpenWorkflow config at openworkflow.config.ts (or other extension;
 * see https://github.com/unjs/c12)
 * @param rootDir - Optional root directory to search from (defaults to
 * process.cwd())
 * @returns The loaded configuration and metadata
 */
export async function loadConfig(rootDir?: string) {
  const cwd = rootDir ?? process.cwd();

  return await loadC12Config<OpenWorkflowConfig>({
    cwd,
    name: "openworkflow",
  });
}
