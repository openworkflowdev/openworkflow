import {
  configExists,
  loadConfig,
  resolveConfigPath,
  WorkerConfig,
} from "./config.js";
import { CLIError } from "./errors.js";
import * as p from "@clack/prompts";
import { consola } from "consola";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { addDependency, detectPackageManager } from "nypm";

export async function init(): Promise<void> {
  p.intro("OpenWorkflow");

  const configPath = resolveConfigPath();

  if (configExists()) {
    throw new CLIError(
      "Config already exists.",
      `Delete ${configPath} first to reinitialize.`,
    );
  }

  const spinner = p.spinner();

  // detect package manager & install packages
  spinner.start("Detecting package manager...");
  const pm = await detectPackageManager(process.cwd());
  const packageManager = pm?.name ?? "your package manager";
  spinner.stop(`Using ${packageManager}`);

  const shouldInstall = await p.confirm({
    message: `Install OpenWorkflow in your ${packageManager} dependencies?`,
    initialValue: true,
  });

  if (p.isCancel(shouldInstall)) {
    p.cancel("Setup cancelled.");
    // eslint-disable-next-line unicorn/no-process-exit
    process.exit(0);
  }

  if (shouldInstall) {
    spinner.start(
      "Installing openworkflow, @openworkflow/backend-sqlite, @openworkflow/backend-postgres...",
    );
    await addDependency(
      [
        "openworkflow",
        "@openworkflow/backend-sqlite",
        "@openworkflow/backend-postgres",
      ],
      { silent: true },
    );
    spinner.stop(
      "Installed openworkflow, @openworkflow/backend-sqlite, @openworkflow/backend-postgres",
    );
  }

  // write config file (last, so canceling earlier doesn't leave a config file
  // which would prevent re-running init)
  spinner.start("Writing config...");

  const configTemplatePath = path.resolve(
    path.dirname(import.meta.url.replace("file://", "")),
    "templates/config.ts",
  );
  const configTemplate = readFileSync(configTemplatePath, "utf8");

  writeFileSync(configPath, configTemplate, "utf8");
  spinner.stop(`Config written to ${configPath}`);

  // wrap up
  p.note(`➡️ Start a worker with:\n$ ow worker start`, "Next steps");
  p.outro("Done!");
}

export async function workerStart(cliOptions: WorkerConfig): Promise<void> {
  consola.start("Starting worker...");

  const config = await loadConfig();
  const worker = config.ow.newWorker({ ...config.worker, ...cliOptions });

  let shuttingDown = false;
  async function gracefulShutdown(): Promise<void> {
    if (shuttingDown) return;
    shuttingDown = true;

    consola.warn("Shutting down worker...");
    await worker.stop();
    consola.success("Worker stopped");
  }
  process.on("SIGINT", () => void gracefulShutdown());
  process.on("SIGTERM", () => void gracefulShutdown());

  await worker.start();
  consola.success("Worker started.");
}
