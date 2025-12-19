import { CLIError } from "./errors.js";
import {
  HELLO_WORLD_WORKFLOW,
  POSTGRES_CONFIG,
  POSTGRES_PROD_SQLITE_DEV_CONFIG,
  SQLITE_CONFIG,
} from "./templates.js";
import * as p from "@clack/prompts";
import { consola } from "consola";
import { config as loadDotenv } from "dotenv";
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
import {
  isWorkflow,
  loadConfig,
  Workflow,
  type JsonValue,
  type StepAttempt,
  type WorkflowRun,
} from "openworkflow/internal";

export type BackendChoice = "sqlite" | "postgres" | "both";

/** Initialize OpenWorkflow in the current project. */
export async function init(): Promise<void> {
  p.intro("Initializing OpenWorkflow...");

  const { configFile } = await loadConfigWithEnv();

  if (configFile) {
    throw new CLIError(
      "Config already exists.",
      `Delete ${configFile} first to reinitialize.`,
    );
  }

  const backendChoice = await p.select<BackendChoice>({
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
  });

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
    const packages = getPackagesToInstall(backendChoice);
    spinner.start(`Installing ${packages.join(", ")}...`);
    await addDependency(packages, { silent: true });
    spinner.stop(`Installed ${packages.join(", ")}`);
  }

  // write config file (last, so canceling earlier doesn't leave a config file
  // which would prevent re-running init)
  spinner.start("Writing config...");

  const configTemplate = getConfigTemplate(backendChoice);

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
 * Check configuration and list discovered workflows.
 * Used for debugging discovery issues.
 */
export async function doctor(): Promise<void> {
  consola.start("Running OpenWorkflow doctor...");

  const { config, configFile } = await loadConfigWithEnv();
  if (!configFile) {
    throw new CLIError(
      "No config file found.",
      "Run `ow init` to create a config file.",
    );
  }
  consola.success(`Config file: ${configFile}`);

  // discover directories
  const dirs = getWorkflowDirectories(config);
  consola.info(`Workflow directories: ${dirs.join(", ")}`);

  // discover files
  const configFileDir = path.dirname(configFile);
  const { files, workflows } = await discoverWorkflowsInDirs(
    dirs,
    configFileDir,
  );
  consola.success(`Found ${String(files.length)} workflow file(s):`);
  for (const file of files) {
    consola.info(`  • ${file}`);
  }

  printDiscoveredWorkflows(workflows);
  warnAboutDuplicateWorkflows(workflows);

  consola.success("\n✅ Configuration looks good!");
}

/**
 * Get workflow directories from config.
 * @param config - The loaded config
 * @returns Array of workflow directory paths
 */
function getWorkflowDirectories(
  config: Awaited<ReturnType<typeof loadConfig>>["config"],
): string[] {
  if (config.dirs) {
    return Array.isArray(config.dirs) ? config.dirs : [config.dirs];
  }
  return ["./openworkflow"];
}

interface DuplicateWorkflow {
  name: string;
  version: string | null;
  count: number;
}

/**
 * Format a workflow identity string for error messages.
 * @param name - Workflow name
 * @param version - Optional workflow version
 * @returns Formatted identity string
 */
function formatWorkflowIdentity(name: string, version: string | null): string {
  return version ? `"${name}" (version: ${version})` : `"${name}"`;
}

/**
 * Find duplicate workflows by name + version.
 * @param workflows - Discovered workflows
 * @returns Array of duplicate metadata
 */
function findDuplicateWorkflows(
  workflows: Workflow<unknown, unknown, unknown>[],
): DuplicateWorkflow[] {
  const workflowKeys = new Map<string, DuplicateWorkflow>();
  const duplicates: DuplicateWorkflow[] = [];

  for (const workflow of workflows) {
    const name = workflow.spec.name;
    const version = workflow.spec.version ?? null;
    const key = version ? `${name}@${version}` : name;

    const existing = workflowKeys.get(key);
    if (existing) {
      existing.count += 1;
      if (existing.count === 2) {
        duplicates.push(existing);
      }
      continue;
    }

    workflowKeys.set(key, { name, version, count: 1 });
  }

  return duplicates;
}

/**
 * Throw a CLIError if duplicate workflows are found.
 * @param workflows - Discovered workflows
 * @throws {CLIError} When duplicate workflows are found
 */
function assertNoDuplicateWorkflows(
  workflows: Workflow<unknown, unknown, unknown>[],
): void {
  const duplicates = findDuplicateWorkflows(workflows);
  if (duplicates.length === 0) return;

  const formatted = duplicates.map((duplicate) =>
    formatWorkflowIdentity(duplicate.name, duplicate.version),
  );
  const preview = formatted.slice(0, 3).join(", ");
  const remaining = duplicates.length - 3;
  const suffix = remaining > 0 ? ` (+${String(remaining)} more)` : "";

  throw new CLIError(
    `Duplicate workflow name${duplicates.length === 1 ? "" : "s"} detected: ${preview}${suffix}`,
    "Multiple workflow files export workflows with the same name and version. Each workflow must have a unique name and version combination.",
  );
}

/**
 * Warn about duplicate workflows without failing.
 * @param workflows - Discovered workflows
 */
function warnAboutDuplicateWorkflows(
  workflows: Workflow<unknown, unknown, unknown>[],
): void {
  const duplicates = findDuplicateWorkflows(workflows);
  for (const duplicate of duplicates) {
    const versionStr = duplicate.version
      ? ` (version: ${duplicate.version})`
      : "";
    consola.warn(
      `\n⚠️  Duplicate workflow detected: "${duplicate.name}"${versionStr}`,
    );
    consola.warn(
      "   Multiple files export a workflow with the same name and version.",
    );
  }
}

/**
 * Print discovered workflows to the console.
 * @param workflows - Array of discovered workflows
 */
function printDiscoveredWorkflows(
  workflows: Workflow<unknown, unknown, unknown>[],
): void {
  consola.success(`\nDiscovered ${String(workflows.length)} workflow(s):\n`);
  for (const workflow of workflows) {
    const name = workflow.spec.name;
    const version = workflow.spec.version ?? "unversioned";
    const versionStr =
      version === "unversioned" ? "" : ` (version: ${version})`;
    consola.info(`  ✓ ${name}${versionStr}`);
  }
}

/**
 * Discover workflow files from directories.
 * Recursively scans directories for .ts and .js files.
 * @param dirs - Directory or directories to scan for workflow files
 * @param baseDir - Base directory to resolve relative paths from
 * @returns Array of absolute file paths
 */
export function discoverWorkflowFiles(
  dirs: string[],
  baseDir: string,
): string[] {
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
export async function importWorkflows(
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

/**
 * Discover workflow files and import workflows with common error handling.
 * @param dirs - Workflow directories
 * @param baseDir - Base directory for relative paths
 * @returns Files and workflows
 */
async function discoverWorkflowsInDirs(
  dirs: string[],
  baseDir: string,
): Promise<{
  files: string[];
  workflows: Workflow<unknown, unknown, unknown>[];
}> {
  const files = discoverWorkflowFiles(dirs, baseDir);

  if (files.length === 0) {
    throw new CLIError(
      "No workflow files found.",
      `No workflow files found in: ${dirs.join(", ")}\n` +
        "Make sure your workflow files (*.ts or *.js) exist in these directories.",
    );
  }

  const workflows = await importWorkflows(files);

  if (workflows.length === 0) {
    throw new CLIError(
      "No workflows found.",
      `No workflows exported in: ${dirs.join(", ")}\n` +
        "Make sure your workflow files export workflows created with defineWorkflow().",
    );
  }

  return { files, workflows };
}

/**
 * Get the config template for a backend choice.
 * @param backendChoice - The selected backend choice
 * @returns The config template string
 */
export function getConfigTemplate(backendChoice: BackendChoice): string {
  switch (backendChoice) {
    case "sqlite": {
      return SQLITE_CONFIG;
    }
    case "postgres": {
      return POSTGRES_CONFIG;
    }
    case "both": {
      return POSTGRES_PROD_SQLITE_DEV_CONFIG;
    }
  }
}

/**
 * Get the packages to install for a backend choice.
 * @param backendChoice - The selected backend choice
 * @returns Array of package names to install
 */
export function getPackagesToInstall(backendChoice: BackendChoice): string[] {
  const packages = ["openworkflow"];

  if (backendChoice === "sqlite" || backendChoice === "both") {
    packages.push("@openworkflow/backend-sqlite");
  }

  if (backendChoice === "postgres" || backendChoice === "both") {
    packages.push("@openworkflow/backend-postgres");
  }

  return packages;
}

/**
 * Create a workflow run from the CLI.
 * @param workflowName - Optional workflow name. If not provided, user will be prompted to select one.
 * @param options - Run options including input data
 */
export async function createRun(
  workflowName: string | undefined,
  options: CreateRunOptions,
): Promise<void> {
  const { config, configFile } = await loadConfigWithEnv();

  if (!configFile) {
    throw new CLIError(
      "No config file found.",
      "Run `ow init` to create a config file.",
    );
  }

  // Parse input from --input or --file
  const input = parseInput(options);

  // Discover workflows
  const workflows = await discoverAllWorkflows(config, configFile);

  // Select workflow (interactively if not provided)
  const workflow = await selectWorkflow(workflows, workflowName);

  consola.start(`Creating workflow run for "${workflow.spec.name}"...`);

  // Create the workflow run
  const ow = new OpenWorkflow({ backend: config.backend });
  const run = await ow.runWorkflow(workflow.spec, input);

  consola.success(`Workflow run created!`);
  consola.info(`Run ID: ${run.workflowRun.id}`);
  consola.info(`Status: ${run.workflowRun.status}`);
  consola.box(
    `Describe this run with:\n$ ow runs describe ${run.workflowRun.id}`,
  );
}

/**
 * Start a worker using the project config.
 * @param cliOptions - Worker config overrides
 */
export async function workerStart(cliOptions: WorkerConfig): Promise<void> {
  consola.start("Starting worker...");

  const { config, configFile } = await loadConfigWithEnv();
  if (!configFile) {
    throw new CLIError(
      "No config file found.",
      "Run `ow init` to create a config file.",
    );
  }

  // discover and import workflows
  const dirs = getWorkflowDirectories(config);
  consola.info(`Discovering workflows from: ${dirs.join(", ")}`);

  const configFileDir = path.dirname(configFile);
  const { files, workflows } = await discoverWorkflowsInDirs(
    dirs,
    configFileDir,
  );
  consola.info(`Found ${String(files.length)} workflow file(s)`);

  consola.success(
    `Loaded ${String(workflows.length)} workflow(s): ${workflows.map((w) => w.spec.name).join(", ")}`,
  );

  assertNoDuplicateWorkflows(workflows);

  const workerOptions = mergeDefinedOptions(config.worker, cliOptions);
  if (workerOptions.concurrency !== undefined) {
    assertPositiveInteger("concurrency", workerOptions.concurrency);
  }

  const ow = new OpenWorkflow({ backend: config.backend });

  // register discovered workflows
  for (const workflow of workflows) {
    ow.implementWorkflow(workflow.spec, workflow.fn);
  }

  const worker = ow.newWorker(workerOptions);

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

export interface ListRunsOptions {
  /** Maximum number of runs to display. */
  limit?: number;
  /** Cursor for pagination (next page). */
  after?: string;
  /** Cursor for pagination (previous page). */
  before?: string;
}

/**
 * List workflow runs.
 * @param options - Pagination options
 */
export async function listRuns(options: ListRunsOptions): Promise<void> {
  const { config, configFile } = await loadConfigWithEnv();

  if (!configFile) {
    throw new CLIError(
      "No config file found.",
      "Run `ow init` to create a config file.",
    );
  }

  if (options.limit !== undefined) {
    assertPositiveInteger("limit", options.limit);
  }

  const params: { limit: number; after?: string; before?: string } = {
    limit: options.limit ?? 20,
  };
  if (options.after) {
    params.after = options.after;
  }
  if (options.before) {
    params.before = options.before;
  }

  const result = await config.backend.listWorkflowRuns(params);

  if (result.data.length === 0) {
    consola.info("No workflow runs found.");
    return;
  }

  consola.info(`Showing ${String(result.data.length)} workflow run(s):\n`);

  // Print header
  const header = formatRunRow("ID", "Workflow", "Status", "Created At");
  consola.log(header);
  consola.log("-".repeat(header.length));

  // Print rows
  for (const run of result.data) {
    const row = formatRunRow(
      run.id,
      formatWorkflowName(run),
      formatStatus(run.status),
      formatDate(run.createdAt),
    );
    consola.log(row);
  }

  // Pagination info
  if (result.pagination.next || result.pagination.prev) {
    consola.log("");
    if (result.pagination.next) {
      consola.info(`Next page: ow runs list --after ${result.pagination.next}`);
    }
    if (result.pagination.prev) {
      consola.info(
        `Previous page: ow runs list --before ${result.pagination.prev}`,
      );
    }
  }
}

/**
 * Describe a specific workflow run.
 * @param runId - The workflow run ID to describe
 */
export async function describeRun(runId: string): Promise<void> {
  const { config, configFile } = await loadConfigWithEnv();

  if (!configFile) {
    throw new CLIError(
      "No config file found.",
      "Run `ow init` to create a config file.",
    );
  }

  // Fetch run details
  const run = await config.backend.getWorkflowRun({ workflowRunId: runId });

  if (!run) {
    throw new CLIError(
      `Workflow run not found: ${runId}`,
      "Make sure the run ID is correct.",
    );
  }

  // Fetch step attempts
  const steps = await listAllStepAttempts(config.backend, runId);

  // Display run details
  printRunDetails(run);

  // Display input/output
  if (run.input !== null) {
    consola.log("\n📥 Input:");
    consola.log(formatJson(run.input));
  }

  if (run.output !== null) {
    consola.log("\n📤 Output:");
    consola.log(formatJson(run.output));
  }

  if (run.error) {
    consola.log("\n❌ Error:");
    consola.log(formatJson(run.error));
  }

  // Display steps timeline
  if (steps.length > 0) {
    consola.log("\n📋 Steps Timeline:");
    printStepsTimeline(steps);
  }
}

/**
 * Load CLI config after loading .env, and wrap errors for user-facing output.
 * @returns Loaded config and metadata.
 */
async function loadConfigWithEnv() {
  loadDotenv();
  try {
    return await loadConfig();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new CLIError("Failed to load OpenWorkflow config.", message);
  }
}

/**
 * Fetch all step attempts for a run using pagination.
 * @param backend - Backend instance from config
 * @param workflowRunId - Workflow run ID
 * @returns Full list of step attempts
 */
async function listAllStepAttempts(
  backend: Awaited<ReturnType<typeof loadConfig>>["config"]["backend"],
  workflowRunId: string,
): Promise<StepAttempt[]> {
  const steps: StepAttempt[] = [];
  let cursor: string | null = null;

  do {
    const params: { workflowRunId: string; limit: number; after?: string } = {
      workflowRunId,
      limit: 100,
    };
    if (cursor !== null) {
      params.after = cursor;
    }

    const result = await backend.listStepAttempts(params);

    steps.push(...result.data);
    cursor = result.pagination.next;
  } while (cursor);

  return steps;
}

/**
 * Print run details in a formatted box.
 * @param run - The workflow run
 */
function printRunDetails(run: WorkflowRun): void {
  const lines = [
    `🔖 Run ID: ${run.id}`,
    `📦 Workflow: ${formatWorkflowName(run)}`,
    `📊 Status: ${formatStatus(run.status)}`,
    `🕐 Created: ${formatDate(run.createdAt)}`,
  ];

  if (run.startedAt) {
    lines.push(`▶️  Started: ${formatDate(run.startedAt)}`);
  }

  if (run.finishedAt) {
    lines.push(`🏁 Finished: ${formatDate(run.finishedAt)}`);
    if (run.startedAt) {
      const durationMs = run.finishedAt.getTime() - run.startedAt.getTime();
      lines.push(`⏱️  Duration: ${formatDuration(durationMs)}`);
    }
  }

  if (run.workerId) {
    lines.push(`🔧 Worker: ${run.workerId}`);
  }

  consola.box(lines.join("\n"));
}

/**
 * Print steps timeline.
 * @param steps - Array of step attempts
 */
function printStepsTimeline(steps: StepAttempt[]): void {
  // Sort steps by creation time
  const sortedSteps = steps.toSorted(
    (a, b) => a.createdAt.getTime() - b.createdAt.getTime(),
  );

  const header = formatStepRow("Step", "Kind", "Status", "Duration");
  consola.log(header);
  consola.log("-".repeat(header.length));

  for (const step of sortedSteps) {
    const duration =
      step.startedAt && step.finishedAt
        ? formatDuration(step.finishedAt.getTime() - step.startedAt.getTime())
        : "-";

    const row = formatStepRow(
      step.stepName,
      step.kind,
      formatStatus(step.status),
      duration,
    );
    consola.log(row);
  }
}

/**
 * Format a workflow name with version.
 * @param run - The workflow run
 * @returns Formatted workflow name
 */
function formatWorkflowName(run: WorkflowRun): string {
  return run.version ? `${run.workflowName}@${run.version}` : run.workflowName;
}

/**
 * Format a date for display.
 * @param date - The date to format
 * @returns Formatted date string
 */
function formatDate(date: Date): string {
  return date.toLocaleString();
}

/**
 * Format a duration in milliseconds to human-readable string.
 * @param ms - Duration in milliseconds
 * @returns Formatted duration string
 */
function formatDuration(ms: number): string {
  if (ms < 1000) {
    return `${String(ms)}ms`;
  }

  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) {
    return `${String(seconds)}s`;
  }

  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  if (minutes < 60) {
    return `${String(minutes)}m ${String(remainingSeconds)}s`;
  }

  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return `${String(hours)}h ${String(remainingMinutes)}m`;
}

/**
 * Format status with emoji indicator.
 * @param status - The status string
 * @returns Status with emoji
 */
function formatStatus(status: string): string {
  const statusEmoji: Record<string, string> = {
    pending: "⏳ pending",
    running: "🔄 running",
    sleeping: "💤 sleeping",
    succeeded: "✅ succeeded",
    completed: "✅ completed",
    failed: "❌ failed",
    canceled: "🚫 canceled",
  };
  return statusEmoji[status] ?? status;
}

/**
 * Format a JSON value for display.
 * @param value - The JSON value
 * @returns Formatted JSON string
 */
function formatJson(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

/**
 * Format a run row for the table.
 * @param id - Run ID
 * @param workflow - Workflow name
 * @param status - Status string
 * @param createdAt - Creation date
 * @returns Formatted row string
 */
function formatRunRow(
  id: string,
  workflow: string,
  status: string,
  createdAt: string,
): string {
  const idCol = id.padEnd(24);
  const workflowCol = workflow.padEnd(24);
  const statusCol = status.padEnd(16);
  return `${idCol} ${workflowCol} ${statusCol} ${createdAt}`;
}

/**
 * Format a step row for the table.
 * @param name - Step name
 * @param kind - Step kind
 * @param status - Status string
 * @param duration - Duration string
 * @returns Formatted row string
 */
function formatStepRow(
  name: string,
  kind: string,
  status: string,
  duration: string,
): string {
  const nameCol = name.padEnd(24);
  const kindCol = kind.padEnd(12);
  const statusCol = status.padEnd(16);
  return `${nameCol} ${kindCol} ${statusCol} ${duration}`;
}

/**
 * Validate a numeric option is a positive integer.
 * @param name - Option name
 * @param value - Option value
 * @throws {CLIError} When the value is invalid
 */
function assertPositiveInteger(name: string, value: number): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new CLIError(
      `Invalid ${name}: ${String(value)}`,
      `${name} must be a positive integer.`,
    );
  }
}

/**
 * Merge CLI options into config, skipping undefined overrides.
 * @param base - Config options
 * @param overrides - CLI overrides
 * @returns Merged options
 */
function mergeDefinedOptions<T extends Record<string, unknown>>(
  base: T | undefined,
  overrides: Partial<T>,
): T {
  const merged = base ? { ...base } : ({} as T);

  for (const [key, value] of Object.entries(overrides)) {
    if (value !== undefined) {
      (merged as Record<string, unknown>)[key] = value;
    }
  }

  return merged;
}

export interface CreateRunOptions {
  /** JSON input string. */
  input?: string;
  /** Path to a JSON file containing input. */
  file?: string;
}

/**
 * Parse input from CLI options.
 * @param options - CLI options with input or file
 * @returns Parsed JSON input or undefined
 * @throws {CLIError} If both --input and --file are specified
 * @throws {CLIError} If --input contains invalid JSON
 * @throws {CLIError} If --file does not exist or contains invalid JSON
 */
function parseInput(options: CreateRunOptions): JsonValue | undefined {
  if (options.input && options.file) {
    throw new CLIError(
      "Cannot specify both --input and --file.",
      "Use one or the other to provide workflow input.",
    );
  }

  if (options.input) {
    try {
      return JSON.parse(options.input) as JsonValue;
    } catch {
      throw new CLIError(
        "Invalid JSON in --input.",
        "Make sure the input is valid JSON.",
      );
    }
  }

  if (options.file) {
    const filePath = path.resolve(options.file);
    if (!existsSync(filePath)) {
      throw new CLIError(
        `File not found: ${options.file}`,
        "Make sure the file exists and the path is correct.",
      );
    }

    try {
      const content = readFileSync(filePath, "utf8");
      return JSON.parse(content) as JsonValue;
    } catch {
      throw new CLIError(
        `Failed to parse JSON from file: ${options.file}`,
        "Make sure the file contains valid JSON.",
      );
    }
  }

  return undefined;
}

/**
 * Discover all workflows from the config.
 * @param config - The loaded config
 * @param configFile - Path to the config file
 * @returns Array of discovered workflows
 * @throws {CLIError} If no workflow files or exports are found
 */
async function discoverAllWorkflows(
  config: Awaited<ReturnType<typeof loadConfig>>["config"],
  configFile: string,
): Promise<Workflow<unknown, unknown, unknown>[]> {
  const dirs = getWorkflowDirectories(config);
  const { workflows } = await discoverWorkflowsInDirs(
    dirs,
    path.dirname(configFile),
  );

  assertNoDuplicateWorkflows(workflows);

  return workflows;
}

/**
 * Select a workflow, either by name or interactively.
 * @param workflows - Available workflows
 * @param workflowName - Optional workflow name
 * @returns Selected workflow
 */
async function selectWorkflow(
  workflows: Workflow<unknown, unknown, unknown>[],
  workflowName: string | undefined,
): Promise<Workflow<unknown, unknown, unknown>> {
  if (workflowName) {
    // Find by exact name or name@version
    const workflow = workflows.find((w) => {
      const name = w.spec.name;
      const version = w.spec.version;
      const key = version ? `${name}@${version}` : name;
      return name === workflowName || key === workflowName;
    });

    if (!workflow) {
      const availableNames = workflows
        .map((w) =>
          w.spec.version ? `${w.spec.name}@${w.spec.version}` : w.spec.name,
        )
        .join(", ");
      throw new CLIError(
        `Workflow not found: "${workflowName}"`,
        `Available workflows: ${availableNames}`,
      );
    }

    return workflow;
  }

  // Interactive selection
  const options = workflows.map((w) => {
    const name = w.spec.name;
    const version = w.spec.version;
    const label = version ? `${name}@${version}` : name;
    const option: {
      value: Workflow<unknown, unknown, unknown>;
      label: string;
      hint?: string;
    } = { value: w, label };
    if (version) {
      option.hint = `version: ${version}`;
    }
    return option;
  });

  const selected = await p.select({
    message: "Select a workflow to run:",
    options,
  });

  if (p.isCancel(selected)) {
    p.cancel("Run cancelled.");
    // eslint-disable-next-line unicorn/no-process-exit
    process.exit(0);
  }

  return selected;
}
