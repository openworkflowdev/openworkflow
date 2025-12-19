import { Backend } from "./backend.js";
import { WorkerOptions } from "./worker.js";
import { existsSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

export interface OpenWorkflowConfig {
  backend: Backend;
  worker?: WorkerConfig;
  /**
   * Directory or directories to scan for workflow files. All `.ts`, `.js`,
   * `.mjs`, and `.cjs` files in these directories (recursively) will be loaded.
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

interface LoadedConfig {
  config: OpenWorkflowConfig;
  configFile: string | undefined;
}

const CONFIG_NAME = "openworkflow.config";
const CONFIG_EXTENSIONS = ["js", "mjs", "cjs"] as const;

/**
 * Load the OpenWorkflow config at openworkflow.config.{js,mjs,cjs}.
 * @param rootDir - Optional root directory to search from (defaults to
 * process.cwd())
 * @returns The loaded configuration and metadata
 */
export async function loadConfig(rootDir?: string): Promise<LoadedConfig> {
  const cwd = rootDir ?? process.cwd();

  for (const ext of CONFIG_EXTENSIONS) {
    const fileName = `${CONFIG_NAME}.${ext}`;
    const filePath = path.join(cwd, fileName);

    if (existsSync(filePath)) {
      try {
        const fileUrl = pathToFileURL(filePath).href;

        const mod = (await import(fileUrl)) as
          | { default?: OpenWorkflowConfig }
          | OpenWorkflowConfig;
        const config =
          (mod as { default?: OpenWorkflowConfig }).default ??
          (mod as OpenWorkflowConfig);

        return {
          config,
          configFile: filePath,
        };
      } catch (error: unknown) {
        throw new Error(
          `Failed to load config file ${filePath}: ${String(error)}`,
        );
      }
    }
  }

  return {
    // not great, but meant to match the c12 api since that is what was used in
    // the initial implementation of loadConfig
    // this can be easily refactored later
    config: {} as unknown as OpenWorkflowConfig,
    configFile: undefined, // no config found
  };
}
