import { loadConfig } from "@openworkflow/cli/internal";
import type { Backend } from "openworkflow/internal";

/**
 * Get the configured backend from the nearest openworkflow.config.*.
 * @returns The configured backend instance
 */
export async function getBackend(): Promise<Backend> {
  const { config, configFile } = await loadConfig();
  if (!configFile) {
    throw new Error(
      "No openworkflow.config.* found. Run `npx @openworkflow/cli init` to create one.",
    );
  }

  return config.backend;
}
