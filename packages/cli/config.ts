import path from "node:path";
import { OpenWorkflow } from "openworkflow";

export async function resolveConfig(): Promise<Config> {
  const configPath = path.resolve(process.cwd(), "openworkflow.config.ts");
  const config = (await import(configPath)) as { default: Config };
  return config.default;
}

export interface Config {
  ow: OpenWorkflow;
  port: number;
}
