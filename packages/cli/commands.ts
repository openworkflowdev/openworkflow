import { CLIError } from "./errors.js";
import {
  HELLO_WORLD_WORKFLOW,
  POSTGRES_CONFIG,
  POSTGRES_PROD_SQLITE_DEV_CONFIG,
  SQLITE_CONFIG,
} from "./templates.js";
import * as p from "@clack/prompts";
import { consola } from "consola";
import { createJiti } from "jiti";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { addDependency, detectPackageManager } from "nypm";
import { OpenWorkflow, WorkerConfig } from "openworkflow";
import { isWorkflow, loadConfig, Workflow } from "openworkflow/internal";

type BackendChoice = "sqlite" | "postgres" | "both";

/** Initialize OpenWorkflow in the current project. */
export async function init(): Promise<void> {
  p.intro("Initializing OpenWorkflow...");

  const { configFile } = await loadConfig();

  if (configFile) {
    throw new CLIError(
      "Config already exists.",
      `Delete ${configFile} first to reinitialize.`,
    );
  }

  const backendChoice = (await p.select({
    message: "Select a backend for OpenWorkflow:",
    options: [
      {
        value: "sqlite",
        label: "SQLite",
        hint: "Recommended for testing and development",
      },
      {
        value: "postgres",
        label: "PostgreSQL",
        hint: "Recommended for production",
      },
      {
        value: "both",
        label: "Both",
        hint: "SQLite for dev, PostgreSQL for production",
      },
    ],
    initialValue: "sqlite",
  })) as BackendChoice;

  if (p.isCancel(backendChoice)) {
    p.cancel("Setup cancelled.");
    // eslint-disable-next-line unicorn/no-process-exit
    process.exit(0);
  }

  const spinner = p.spinner();

  // detect package manager & install packages
  spinner.start("Detecting package manager...");
  const pm = await detectPackageManager(process.cwd());
  const packageManager = pm?.name ?? "your package manager";
  spinner.stop(`Using ${packageManager}`);

  const shouldInstall = await p.confirm({
    message: `Install OpenWorkflow?`,
    initialValue: true,
  });

  if (p.isCancel(shouldInstall)) {
    p.cancel("Setup cancelled.");
    // eslint-disable-next-line unicorn/no-process-exit
    process.exit(0);
  }

  if (shouldInstall) {
    const packages = ["openworkflow"];

    if (backendChoice === "sqlite" || backendChoice === "both") {
      packages.push("@openworkflow/backend-sqlite");
    }

    if (backendChoice === "postgres" || backendChoice === "both") {
      packages.push("@openworkflow/backend-postgres");
    }

    spinner.start(`Installing ${packages.join(", ")}...`);
    await addDependency(packages, { silent: true });
    spinner.stop(`Installed ${packages.join(", ")}`);
  }

  // write config file (last, so canceling earlier doesn't leave a config file
  // which would prevent re-running init)
  spinner.start("Writing config...");

  let configTemplate: string;
  switch (backendChoice) {
    case "sqlite": {
      configTemplate = SQLITE_CONFIG;
      break;
    }
    case "postgres": {
      configTemplate = POSTGRES_CONFIG;
      break;
    }
    case "both": {
      configTemplate = POSTGRES_PROD_SQLITE_DEV_CONFIG;
      break;
    }
  }

  const configDestPath = path.join(process.cwd(), "openworkflow.config.js");
  writeFileSync(configDestPath, configTemplate, "utf8");
  spinner.stop(`Config written to ${configDestPath}`);

  // create openworkflow dir and add hello_world.ts
  spinner.start("Creating example (hello-world) workflow...");

  const workflowsDir = path.join(process.cwd(), "openworkflow");
  if (!existsSync(workflowsDir)) {
    mkdirSync(workflowsDir, { recursive: true });
  }

  const helloWorldDestPath = path.join(workflowsDir, "hello-world.ts");
  writeFileSync(helloWorldDestPath, HELLO_WORLD_WORKFLOW, "utf8");
  spinner.stop(
    `Created example (hello-world) workflow at ${helloWorldDestPath}`,
  );

  // add worker script to package.json
  spinner.start("Adding worker script to package.json...");

  const packageJsonPath = path.join(process.cwd(), "package.json");
  if (existsSync(packageJsonPath)) {
    try {
      const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8")) as {
        scripts?: Record<string, string>;
      };

      packageJson.scripts ??= {};
      packageJson.scripts["worker"] = "ow worker start";

      writeFileSync(
        packageJsonPath,
        JSON.stringify(packageJson, null, 2) + "\n",
        "utf8",
      );

      spinner.stop('Added "worker" script to package.json');
    } catch {
      spinner.stop("Failed to update package.json");
      consola.warn("Could not add worker script to package.json");
    }
  } else {
    spinner.stop("No package.json found");
    consola.warn("No package.json found - skipping script injection");
  }

  // wrap up
  p.note(
    `➡️ Start a worker with:\n$ ${packageManager === "npm" ? "npm run" : packageManager} worker\n\nOr directly with:\n$ ow worker start`,
    "Next steps",
  );
  p.outro("✅ Setup complete!");
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
