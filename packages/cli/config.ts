import { loadConfig as loadC12Config } from "c12";
import type { OpenWorkflow, WorkerOptions } from "openworkflow";

export interface OpenWorkflowConfig {
  ow: OpenWorkflow;
  worker?: WorkerConfig;
}

export type WorkerConfig = Pick<WorkerOptions, "concurrency">;

/**
 * Load openworkflow.config.ts (or other extension; see
 * https://github.com/unjs/c12)
 */
export async function loadConfig(
  rootDir?: string,
): Promise<OpenWorkflowConfig> {
  const cwd = rootDir ?? process.cwd();

  const { config } = await loadC12Config<OpenWorkflowConfig>({
    cwd,
    name: "openworkflow",
  });

  return config;
}
