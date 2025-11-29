import {
  configExists,
  CONFIG_TEMPLATE,
  loadConfig,
  resolveConfigPath,
  WorkerConfig,
} from "./config.js";
import { CLIError } from "./errors.js";
import chalk from "chalk";
import { writeFileSync } from "node:fs";

export function init(): void {
  console.log("Initializing OpenWorkflow...");

  const configPath = resolveConfigPath();

  if (configExists()) {
    throw new CLIError(
      "Config already exists.",
      `Delete ${configPath} first to reinitialize.`,
    );
  }

  writeFileSync(configPath, CONFIG_TEMPLATE, "utf8");

  console.log(chalk.green(`Created ${configPath}`));
  console.log("Next steps:");
  console.log("  1. npm install openworkflow @openworkflow/backend-postgres");
  console.log("  2. Update DATABASE_URL in your config or environment");
  console.log("  3. Start a worker: ow worker start");
}

export async function workerStart(cliOptions: WorkerConfig): Promise<void> {
  console.log("Starting worker...");

  const config = await loadConfig();
  const worker = config.ow.newWorker({ ...config.worker, ...cliOptions });

  let shuttingDown = false;
  async function gracefulShutdown(): Promise<void> {
    if (shuttingDown) return;
    shuttingDown = true;

    console.log(chalk.yellow("Shutting down worker..."));
    await worker.stop();
    console.log(chalk.green("Worker stopped"));
  }
  process.on("SIGINT", () => void gracefulShutdown());
  process.on("SIGTERM", () => void gracefulShutdown());

  await worker.start();
  console.log(chalk.green("Worker started."));
}
