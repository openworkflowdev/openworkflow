import { createJiti } from "jiti";
import { existsSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { WorkerOptions } from "openworkflow";
import type { Backend } from "openworkflow/internal";

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
  /**
   * Glob patterns to ignore when discovering workflow files.
   * Patterns are matched against paths relative to the config directory.
   * @example ["**\\/*.run.*"]
   * @example ["**\\/*.test.*", "**\\/__fixtures__/**"]
   */
  ignorePatterns?: string[];
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
const CONFIG_EXTENSIONS = ["ts", "mts", "cts", "js", "mjs", "cjs"] as const;
const jiti = createJiti(import.meta.url);

/**
 * Load the OpenWorkflow config at openworkflow.config.{ts,mts,cts,js,mjs,cjs}.
 * Searches up the directory tree from the starting directory to find the
 * nearest config file.
 * @param startDir - Optional starting directory to search from (defaults to
 * process.cwd()). Will search this directory and all parent directories.
 * @returns The loaded configuration and metadata
 */
export async function loadConfig(startDir?: string): Promise<LoadedConfig> {
  let currentDir = path.resolve(startDir ?? process.cwd());

  // search up the directory tree
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  while (true) {
    for (const ext of CONFIG_EXTENSIONS) {
      const fileName = `${CONFIG_NAME}.${ext}`;
      const filePath = path.join(currentDir, fileName);

      if (existsSync(filePath)) {
        try {
          const fileUrl = pathToFileURL(filePath).href;

          const config = await jiti.import<OpenWorkflowConfig>(fileUrl, {
            default: true,
          });

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

    const parentDir = path.dirname(currentDir);
    if (parentDir === currentDir) {
      // reached filesystem root without finding config
      break;
    }

    currentDir = parentDir;
  }

  return {
    // not great, but meant to match the c12 api since that is what was used in
    // the initial implementation of loadConfig
    // this can be easily refactored later
    config: {} as unknown as OpenWorkflowConfig,
    configFile: undefined, // no config found
  };
}
