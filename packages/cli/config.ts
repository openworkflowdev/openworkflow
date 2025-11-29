import { CLIError } from "./errors.js";
import { createJiti } from "jiti";
import { existsSync } from "node:fs";
import path from "node:path";
import type { OpenWorkflow, WorkerOptions } from "openworkflow";

export type WorkerConfig = Pick<WorkerOptions, "concurrency">;

export interface OpenWorkflowConfig {
  ow: OpenWorkflow;
  worker?: WorkerConfig;
}

const CONFIG_EXTENSIONS = ["ts", "js", "mjs", "cjs"];

/**
 * Resolve the path to the config file from the project root
 */
export function resolveConfigPath(rootDir?: string): string {
  const root = rootDir ?? process.cwd();
  for (const ext of CONFIG_EXTENSIONS) {
    const configPath = path.resolve(root, `openworkflow.config.${ext}`);
    if (existsSync(configPath)) {
      return configPath;
    }
  }
  return path.resolve(root, "openworkflow.config.ts");
}

/**
 * Check if a config file exists in the project root
 */
export function configExists(rootDir?: string): boolean {
  return existsSync(resolveConfigPath(rootDir));
}

/**
 * Load and validate openworkflow.config.ts (or other extension)
 */
export async function loadConfig(
  rootDir?: string,
): Promise<OpenWorkflowConfig> {
  const configPath = resolveConfigPath(rootDir);

  if (!existsSync(configPath)) {
    throw new CLIError(
      "Config file not found.",
      `Expected: openworkflow.config.{${CONFIG_EXTENSIONS.join(",")}}\nRun 'ow init' to create one.`,
    );
  }

  const jiti = createJiti(import.meta.url);
  const imported: { default?: unknown } = await jiti.import(configPath);
  if (!imported.default) {
    throw new CLIError(
      "Config missing default export.",
      `Add 'export default { ow }' to ${configPath}`,
    );
  }
  const config = imported.default;

  if (typeof config !== "object" || !("ow" in config)) {
    throw new CLIError(
      "Config missing 'ow' property.",
      `Add 'ow: new OpenWorkflow(...)' to your config export.`,
    );
  }

  return config as OpenWorkflowConfig;
}

export const CONFIG_TEMPLATE = `import { BackendPostgres } from "@openworkflow/backend-postgres";
import { OpenWorkflow } from "openworkflow";

const postgresUrl = process.env["DATABASE_URL"];

const backend = await BackendPostgres.connect(postgresUrl);
const ow = new OpenWorkflow({ backend });

export default { ow };`;
