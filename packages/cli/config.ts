import { loadConfig as loadC12Config } from "c12";
import type { Backend, WorkerOptions } from "openworkflow";

export interface OpenWorkflowConfig {
  backend: Backend;
  worker?: WorkerConfig;
}

export type WorkerConfig = Pick<WorkerOptions, "concurrency">;

/**
 * Load openworkflow.config.ts (or other extension; see
 * https://github.com/unjs/c12)
 * @param rootDir - Root directory to search from
 * @returns Loaded config (and metadata)
 */
export async function loadConfig(rootDir?: string) {
  const cwd = rootDir ?? process.cwd();

  return await loadC12Config<OpenWorkflowConfig>({
    cwd,
    name: "openworkflow",
  });
}
