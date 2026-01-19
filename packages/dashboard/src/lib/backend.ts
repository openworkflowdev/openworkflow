import { loadConfig } from "@openworkflow/cli/internal";
import type { Backend } from "openworkflow/internal";

let cachedBackend: Backend | null = null;

/**
 * Get the configured backend from the project root's openworkflow.config.*.
 * The backend is cached to avoid reloading the config on every request.
 * @returns The configured backend instance
 */
export async function getBackend(): Promise<Backend> {
  if (cachedBackend) {
    return cachedBackend;
  }

  const { config, configFile } = await loadConfig("../.."); // project root
  if (!configFile) {
    throw new Error(
      "No openworkflow.config.* found. Run `ow init` to create one.",
    );
  }

  cachedBackend = config.backend;
  return config.backend;
}
