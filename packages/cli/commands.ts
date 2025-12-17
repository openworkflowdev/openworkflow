import { CLIError } from "./errors.js";
import * as p from "@clack/prompts";
import { consola } from "consola";
import { createJiti } from "jiti";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { addDependency, detectPackageManager } from "nypm";
import { OpenWorkflow, WorkerConfig } from "openworkflow";
import { isWorkflow, loadConfig, Workflow } from "openworkflow/internal";

/** Initialize OpenWorkflow in the current project. */
export async function init(): Promise<void> {
  p.intro("OpenWorkflow");

  const { configFile } = await loadConfig();

  if (configFile) {
    throw new CLIError(
      "Config already exists.",
      `Delete ${configFile} first to reinitialize.`,
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
    "templates/openworkflow.config.ts",
  );
  const configTemplate = readFileSync(configTemplatePath, "utf8");
  const configDestPath = path.join(process.cwd(), "openworkflow.config.ts");

  writeFileSync(configDestPath, configTemplate, "utf8");
  spinner.stop(`Config written to ${configDestPath}`);

  // wrap up
  p.note(`➡️ Start a worker with:\n$ ow worker start`, "Next steps");
  p.outro("Done!");
}

/**
 * Start a worker using the project config.
 * @param cliOptions - Worker config overrides
 */
export async function workerStart(cliOptions: WorkerConfig): Promise<void> {
  consola.start("Starting worker...");

  const { config, configFile } = await loadConfig();
  if (!configFile) {
    throw new CLIError(
      "No config file found.",
      "Run `ow init` to create a config file.",
    );
  }

  // discover and import workflows
  let dirs: string[];
  if (config.dirs) {
    dirs = Array.isArray(config.dirs) ? config.dirs : [config.dirs];
  } else {
    dirs = ["./openworkflow"];
  }
  consola.info(`Discovering workflows from: ${dirs.join(", ")}`);

  const configFileDir = path.dirname(configFile);
  const files = discoverWorkflowFiles(dirs, configFileDir);
  if (files.length === 0) {
    throw new CLIError(
      "No workflows found.",
      `No workflow files found in: ${dirs.join(", ")}\n` +
        `Make sure your workflow files export workflows created with defineWorkflow().`,
    );
  }
  consola.info(`Found ${String(files.length)} workflow file(s)`);

  const workflows = await importWorkflows(files);
  if (workflows.length === 0) {
    throw new CLIError(
      "No workflows found.",
      `No workflows exported in: ${dirs.join(", ")}\n` +
        `Make sure your workflow files export workflows created with defineWorkflow().`,
    );
  }
  consola.success(
    `Loaded ${String(workflows.length)} workflow(s): ${workflows.map((w) => w.spec.name).join(", ")}`,
  );

  const ow = new OpenWorkflow({ backend: config.backend });

  // register discovered workflows
  for (const workflow of workflows) {
    ow.implementWorkflow(workflow.spec, workflow.fn);
  }

  const worker = ow.newWorker({ ...config.worker, ...cliOptions });

  let shuttingDown = false;

  /** Stop the worker on process shutdown. */
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

/**
 * Discover workflow files from directories.
 * Recursively scans directories for .ts and .js files.
 * @param dirs - Directory or directories to scan for workflow files
 * @param baseDir - Base directory to resolve relative paths from
 * @returns Array of absolute file paths
 */
function discoverWorkflowFiles(dirs: string[], baseDir: string): string[] {
  const discoveredFiles: string[] = [];

  /**
   * Recursively scan a directory for workflow files.
   * @param dir - Directory to scan
   */
  function scanDirectory(dir: string): void {
    const absoluteDir = path.isAbsolute(dir) ? dir : path.resolve(baseDir, dir);

    let entries;
    try {
      entries = readdirSync(absoluteDir, { withFileTypes: true });
    } catch (error) {
      // doesn't exist or can't be read, skip
      const errMessage = error instanceof Error ? error.message : String(error);
      consola.debug(`Failed to read directory: ${absoluteDir} - ${errMessage}`);
      return;
    }

    for (const entry of entries) {
      const fullPath = path.join(absoluteDir, entry.name);
      if (entry.isDirectory()) {
        scanDirectory(fullPath);
      } else if (
        entry.isFile() &&
        (entry.name.endsWith(".ts") || entry.name.endsWith(".js")) &&
        !entry.name.endsWith(".d.ts")
      ) {
        discoveredFiles.push(fullPath);
      }
    }
  }

  for (const dir of dirs) {
    scanDirectory(dir);
  }

  return discoveredFiles;
}

/**
 * Import workflow files and extract workflow exports.
 * Supports both named exports and default exports.
 * @param files - Array of absolute file paths to import
 * @returns Array of discovered workflows
 */
async function importWorkflows(
  files: string[],
): Promise<Workflow<unknown, unknown, unknown>[]> {
  const workflows: Workflow<unknown, unknown, unknown>[] = [];
  const jiti = createJiti(import.meta.url);

  for (const file of files) {
    // import the module
    let module: Record<string, unknown>;
    try {
      module = await jiti.import(pathToFileURL(file).href);
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      throw new CLIError(
        `Failed to import workflow file: ${file}`,
        `Error: ${errorMessage}`,
      );
    }

    // extract workflow exports (named and default)
    for (const [key, value] of Object.entries(module)) {
      if (isWorkflow(value)) {
        const workflow = value as Workflow<unknown, unknown, unknown>;
        workflows.push(workflow);
        consola.debug(
          `Found workflow "${workflow.spec.name}" in ${file} (${key})`,
        );
      }
    }
  }

  return workflows;
}
