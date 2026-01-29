import { WorkerConfig, loadConfig } from "./config.js";
import { CLIError } from "./errors.js";
import {
  CONFIG,
  HELLO_WORLD_RUNNER,
  HELLO_WORLD_WORKFLOW,
  POSTGRES_CLIENT,
  POSTGRES_PROD_SQLITE_DEV_CLIENT,
  SQLITE_CLIENT,
} from "./templates.js";
import * as p from "@clack/prompts";
import { consola } from "consola";
import { config as loadDotenv } from "dotenv";
import { createJiti } from "jiti";
import { spawn } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { addDependency, detectPackageManager } from "nypm";
import { OpenWorkflow } from "openworkflow";
import { isWorkflow, Workflow } from "openworkflow/internal";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

type BackendChoice = "sqlite" | "postgres" | "both";

/**
 * openworkflow -V | --version
 * @returns the version string, or "-" if it cannot be determined
 */
export function getVersion(): string {
  const paths = [
    path.join(__dirname, "package.json"), // dev: package.json
    path.join(__dirname, "..", "package.json"), // prod: dist/../package.json
  ];

  for (const pkgPath of paths) {
    if (existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as {
          version?: string;
        };
        if (pkg.version) return pkg.version;
      } catch {
        // ignore
      }
    }
  }

  return "-";
}

/** openworkflow init */
export async function init(): Promise<void> {
  p.intro("Initializing OpenWorkflow...");

  const { configFile } = await loadConfigWithEnv();
  let configFileToDelete: string | null = null;

  if (configFile) {
    const shouldOverride = await p.confirm({
      message: `Config file already exists at ${configFile}. Override it?`,
      initialValue: false,
    });

    if (!shouldOverride || p.isCancel(shouldOverride)) {
      p.cancel("Setup canceled.");
      // eslint-disable-next-line unicorn/no-process-exit
      process.exit(0);
    }

    configFileToDelete = configFile;
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
    p.cancel("Setup canceled.");
    // eslint-disable-next-line unicorn/no-process-exit
    process.exit(0);
  }

  const spinner = p.spinner();

  // detect package manager & install packages
  spinner.start("Detecting package manager...");
  const pm = await detectPackageManager(process.cwd());
  const packageManager = pm?.name ?? "your package manager";
  spinner.stop(`Using ${packageManager}`);

  const packageJson = readPackageJsonForDoctor();
  if (!packageJson) {
    throw new CLIError(
      "No package.json found.",
      "Please create a package.json file first by running `npm init` or `npm init -y`.",
    );
  }

  const configFileName = getConfigFileName(packageJson);
  const clientFileName = getClientFileName(packageJson);
  const exampleWorkflowFileName = getExampleWorkflowFileName(packageJson);
  const runFileName = getRunFileName(packageJson);

  const shouldSetup = await p.confirm({
    message: "Install packages and set up project files?",
    initialValue: true,
  });

  if (p.isCancel(shouldSetup)) {
    p.cancel("Setup canceled.");
    // eslint-disable-next-line unicorn/no-process-exit
    process.exit(0);
  }

  if (!shouldSetup) {
    p.outro("Setup skipped.");
    return;
  }

  if (configFileToDelete) {
    unlinkSync(configFileToDelete);
  }

  {
    const dependencies = getDependenciesToInstall(backendChoice);
    spinner.start(`Installing ${dependencies.join(", ")}...`);
    await addDependency(dependencies, { silent: true });
    spinner.stop(`Installed ${dependencies.join(", ")}`);
  }

  {
    const devDependencies = getDevDependenciesToInstall();
    spinner.start(`Installing ${devDependencies.join(", ")}...`);
    await addDependency(devDependencies, { silent: true, dev: true });
    spinner.stop(`Installed ${devDependencies.join(", ")}`);
  }

  createClientFile(backendChoice, clientFileName);
  createExampleWorkflow(exampleWorkflowFileName);
  createRunFile(runFileName);

  if (backendChoice === "sqlite" || backendChoice === "both") {
    updateGitignoreForSqlite();
  }

  if (backendChoice === "postgres" || backendChoice === "both") {
    updateEnvForPostgres();
  }

  addWorkerScriptToPackageJson();

  // write config file last, so canceling earlier doesn't leave a config file
  // which would prevent re-running init
  createConfigFile(configFileName);

  // wrap up
  p.note(
    "➡️ Start a worker:\n$ npx @openworkflow/cli worker start\n\n➡️ Run the example workflow:\n$ node openworkflow/hello-world.run.js\n   (or: npx tsx openworkflow/hello-world.run.ts)\n\n➡️ View the dashboard:\n$ npx @openworkflow/cli dashboard",
    "Next steps",
  );
  p.outro("✅ Setup complete!");
}

/** openworkflow doctor */
export async function doctor(): Promise<void> {
  consola.start("Running OpenWorkflow doctor...");

  const { config, configFile } = await loadConfigWithEnv();
  if (!configFile) {
    throw new CLIError(
      "No config file found.",
      "Run `ow init` to create a config file.",
    );
  }
  const backend = config.backend;

  try {
    consola.log("");
    consola.info(`Config file: ${configFile}`);

    const backendName = backend.constructor.name.replace("Backend", "");
    consola.log(`  • Backend: ${backendName}`);

    const packageJson = readPackageJsonForDoctor();
    if (packageJson) {
      warnIfMissingBackendPackage(backendName, packageJson);
      warnIfMissingTsconfig(packageJson);
    }

    // discover directories
    const dirs = getWorkflowDirectories(config);
    consola.log(`  • Workflow directories: ${dirs.join(", ")}`);

    // discover files
    const configFileDir = path.dirname(configFile);
    const { files, workflows } = await discoverWorkflowsInDirs(
      dirs,
      configFileDir,
    );
    consola.log("");
    consola.info(`Found ${String(files.length)} workflow file(s):`);
    for (const file of files) {
      consola.log(`  • ${file}`);
    }

    printDiscoveredWorkflows(workflows);
    warnAboutDuplicateWorkflows(workflows);

    consola.log("");
    consola.success("Configuration looks good!");
  } finally {
    await backend.stop();
  }
}

/**
 * openworkflow worker start
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
  const backend = config.backend;
  const ow = new OpenWorkflow({ backend });

  let worker: ReturnType<typeof ow.newWorker> | null = null;
  let shuttingDown = false;

  /** Stop the worker on process shutdown. */
  async function gracefulShutdown(): Promise<void> {
    if (shuttingDown) return;
    shuttingDown = true;

    consola.warn("Shutting down worker...");
    try {
      await worker?.stop();
    } finally {
      await backend.stop();
    }
    consola.success("Worker stopped");
  }

  try {
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

    // register discovered workflows
    for (const workflow of workflows) {
      ow.implementWorkflow(workflow.spec, workflow.fn);
    }

    worker = ow.newWorker(workerOptions);

    process.on("SIGINT", () => void gracefulShutdown());
    process.on("SIGTERM", () => void gracefulShutdown());

    await worker.start();
    consola.success("Worker started.");
  } catch (error) {
    await gracefulShutdown();
    throw error;
  }
}

/**
 * openworkflow dashboard
 * Starts the dashboard by delegating to `@openworkflow/dashboard` via npx.
 */
export async function dashboard(): Promise<void> {
  consola.start("Starting dashboard...");

  const { configFile } = await loadConfigWithEnv();
  if (!configFile) {
    throw new CLIError(
      "No config file found.",
      "Run `ow init` to create a config file before starting the dashboard.",
    );
  }
  consola.info(`Using config: ${configFile}`);

  // eslint-disable-next-line sonarjs/no-os-command-from-path
  const child = spawn("npx", ["@openworkflow/dashboard"], {
    stdio: "inherit",
  });

  await new Promise<void>((resolve, reject) => {
    /** remove signal handlers after the child exits */
    function cleanupSignalHandlers(): void {
      process.off("SIGINT", signalHandler);
      process.off("SIGTERM", signalHandler);
    }

    child.on("error", (error) => {
      cleanupSignalHandlers();
      reject(
        new CLIError(
          "Failed to start dashboard.",
          `Could not spawn npx: ${error.message}`,
        ),
      );
    });

    child.on("exit", (code) => {
      cleanupSignalHandlers();
      if (code === 0 || code === null) {
        resolve();
      } else {
        reject(
          new CLIError(
            "Dashboard exited with an error.",
            `Exit code: ${String(code)}`,
          ),
        );
      }
    });

    /**
     * Graceful shutdown on signals.
     * @param signal - Signal
     */
    function signalHandler(signal: NodeJS.Signals): void {
      child.kill(signal);
    }
    process.on("SIGINT", signalHandler);
    process.on("SIGTERM", signalHandler);
  });
}

// -----------------------------------------------------------------------------

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
      `Duplicate workflow detected: "${duplicate.name}"${versionStr}`,
    );
    consola.warn(
      "Multiple files export a workflow with the same name and version.",
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
  consola.log("");
  consola.info(`Discovered ${String(workflows.length)} workflow(s):`);
  for (const workflow of workflows) {
    const name = workflow.spec.name;
    const version = workflow.spec.version ?? "unversioned";
    const versionStr =
      version === "unversioned" ? "" : ` (version: ${version})`;
    consola.log(`  • ${name}${versionStr}`);
  }
}

const WORKFLOW_EXTENSIONS = ["ts", "mts", "cts", "js", "mjs", "cjs"] as const;

/**
 * Discover workflow files from directories. Recursively scans directories for
 * workflow files with supported extensions (.ts, .js, .mjs, .cjs).
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
        WORKFLOW_EXTENSIONS.some((ext: string) =>
          entry.name.endsWith(`.${ext}`),
        ) &&
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
    const extensionsStr = WORKFLOW_EXTENSIONS.map(
      (ext: string) => `*.${ext}`,
    ).join(", ");
    throw new CLIError(
      "No workflow files found.",
      `No workflow files found in: ${dirs.join(", ")}\n` +
        `Make sure your workflow files (${extensionsStr}) exist in these directories.`,
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
/**
 * Get the client template for a backend choice.
 * @param backendChoice - The selected backend choice
 * @returns The client template string
 */
function getClientTemplate(backendChoice: BackendChoice): string {
  switch (backendChoice) {
    case "sqlite": {
      return SQLITE_CLIENT;
    }
    case "postgres": {
      return POSTGRES_CLIENT;
    }
    case "both": {
      return POSTGRES_PROD_SQLITE_DEV_CLIENT;
    }
  }
}

/**
 * Get the dependencies to install for a backend choice.
 * @param backendChoice - The selected backend choice
 * @returns Array of dependency package names to install
 */
function getDependenciesToInstall(backendChoice: BackendChoice): string[] {
  const dependencies = ["openworkflow"];

  if (backendChoice === "sqlite" || backendChoice === "both") {
    dependencies.push("@openworkflow/backend-sqlite");
  }

  if (backendChoice === "postgres" || backendChoice === "both") {
    dependencies.push("@openworkflow/backend-postgres");
  }

  return dependencies;
}

/**
 * Get the dev dependencies to install.
 * @returns Array of dev dependency package names to install
 */
function getDevDependenciesToInstall(): string[] {
  return ["@openworkflow/cli"];
}

/**
 * Create config file.
 * @param configFileName - The config file name to write
 */
function createConfigFile(configFileName: string): void {
  const spinner = p.spinner();
  spinner.start("Writing config...");
  const configDestPath = path.join(process.cwd(), configFileName);
  writeFileSync(configDestPath, CONFIG, "utf8");
  spinner.stop(`Config written to ${configDestPath}`);
}

/**
 * Create hello-world runner file.
 * @param runFileName - The runner filename to write
 */
function createRunFile(runFileName: string): void {
  const spinner = p.spinner();
  const workflowsDir = path.join(process.cwd(), "openworkflow");
  if (!existsSync(workflowsDir)) {
    mkdirSync(workflowsDir, { recursive: true });
  }
  const runDestPath = path.join(workflowsDir, runFileName);
  if (existsSync(runDestPath)) {
    spinner.start("Checking hello-world runner...");
    spinner.stop(`Hello-world runner already exists at ${runDestPath}`);
    return;
  }

  spinner.start("Creating hello-world runner...");
  writeFileSync(runDestPath, HELLO_WORLD_RUNNER, "utf8");
  spinner.stop(`Created hello-world runner at ${runDestPath}`);
}

/**
 * Create client file.
 * @param backendChoice - The selected backend choice
 * @param clientFileName - The client filename to write
 */
function createClientFile(
  backendChoice: BackendChoice,
  clientFileName: string,
): void {
  const spinner = p.spinner();
  const workflowsDir = path.join(process.cwd(), "openworkflow");
  if (!existsSync(workflowsDir)) {
    mkdirSync(workflowsDir, { recursive: true });
  }
  const clientDestPath = path.join(workflowsDir, clientFileName);
  if (existsSync(clientDestPath)) {
    spinner.start("Checking client file...");
    spinner.stop(`Client file already exists at ${clientDestPath}`);
    return;
  }

  spinner.start("Creating client file...");
  const clientTemplate = getClientTemplate(backendChoice);
  writeFileSync(clientDestPath, clientTemplate, "utf8");
  spinner.stop(`Created client file at ${clientDestPath}`);
}

/**
 * Create example workflow.
 * @param exampleWorkflowFileName - The example workflow filename to write
 */
function createExampleWorkflow(exampleWorkflowFileName: string): void {
  const spinner = p.spinner();
  const workflowsDir = path.join(process.cwd(), "openworkflow");
  if (!existsSync(workflowsDir)) {
    mkdirSync(workflowsDir, { recursive: true });
  }
  const helloWorldDestPath = path.join(workflowsDir, exampleWorkflowFileName);
  if (existsSync(helloWorldDestPath)) {
    spinner.start("Checking example (hello-world) workflow...");
    spinner.stop(
      `Example (hello-world) workflow already exists at ${helloWorldDestPath}`,
    );
    return;
  }

  spinner.start("Creating example (hello-world) workflow...");
  writeFileSync(helloWorldDestPath, HELLO_WORLD_WORKFLOW, "utf8");
  spinner.stop(
    `Created example (hello-world) workflow at ${helloWorldDestPath}`,
  );
}

/**
 * Update .gitignore for SQLite.
 */
function updateGitignoreForSqlite(): void {
  const workflowsDir = path.join(process.cwd(), "openworkflow");
  if (!existsSync(workflowsDir)) {
    mkdirSync(workflowsDir, { recursive: true });
  }

  const gitignorePath = path.join(process.cwd(), ".gitignore");
  const spinner = p.spinner();
  spinner.start("Updating .gitignore...");
  const result = ensureGitignoreEntry(gitignorePath, "openworkflow/backend.db");
  spinner.stop(
    result.added
      ? "Added openworkflow/backend.db to .gitignore"
      : "openworkflow/backend.db already in .gitignore",
  );
}

/**
 * Add worker script to package.json.
 */
function addWorkerScriptToPackageJson(): void {
  const packageJsonPath = path.join(process.cwd(), "package.json");
  if (!existsSync(packageJsonPath)) {
    return;
  }
  const spinner = p.spinner();
  spinner.start("Adding worker script to package.json...");
  try {
    const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8")) as {
      scripts?: Record<string, string>;
    };

    packageJson.scripts ??= {};
    packageJson.scripts["worker"] = "npx @openworkflow/cli worker start";

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
}

/**
 * Ensure a specific entry exists in a .gitignore file. Creates the file if it
 * doesn't exist, appends the entry if not present.
 * @param gitignorePath - Path to the .gitignore file
 * @param entry - The entry to add (e.g. "openworkflow/backend.db")
 * @returns Object indicating whether the entry was added or already existed
 */
function ensureGitignoreEntry(
  gitignorePath: string,
  entry: string,
): { added: boolean; created: boolean } {
  const fileExists = existsSync(gitignorePath);
  let content = "";

  if (fileExists) {
    content = readFileSync(gitignorePath, "utf8");
  }

  // check if entry already exists
  const lines = content.split("\n");
  const hasEntry = lines.some((line) => line.trim() === entry);

  if (hasEntry) {
    return { added: false, created: false };
  }

  // add entry to .gitignore
  let newContent: string;
  if (content === "") {
    newContent = `${entry}\n`;
  } else if (content.endsWith("\n")) {
    newContent = `${content}${entry}\n`;
  } else {
    newContent = `${content}\n${entry}\n`;
  }

  writeFileSync(gitignorePath, newContent, "utf8");

  return { added: true, created: !fileExists };
}

/**
 * Add OPENWORKFLOW_POSTGRES_URL to .env file.
 */
function updateEnvForPostgres(): void {
  const envPath = path.join(process.cwd(), ".env");
  const spinner = p.spinner();
  spinner.start("Updating .env...");
  const result = ensureEnvEntry(
    envPath,
    "OPENWORKFLOW_POSTGRES_URL",
    "postgresql://user:password@localhost:5432/openworkflow",
  );
  spinner.stop(
    result.added
      ? "Added OPENWORKFLOW_POSTGRES_URL to .env"
      : "OPENWORKFLOW_POSTGRES_URL already in .env",
  );
}

/**
 * Load CLI config after loading .env, and wrap errors for user-facing output.
 * @returns Loaded config and metadata.
 */
async function loadConfigWithEnv() {
  loadDotenv({ quiet: true });
  try {
    return await loadConfig();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new CLIError("Failed to load OpenWorkflow config.", message);
  }
}

interface PackageJsonForDoctor {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

/**
 * Load package.json for doctor checks.
 * @returns Parsed package.json or null if unavailable.
 */
function readPackageJsonForDoctor(): PackageJsonForDoctor | null {
  const packageJsonPath = path.join(process.cwd(), "package.json");
  if (!existsSync(packageJsonPath)) {
    return null;
  }

  try {
    return JSON.parse(
      readFileSync(packageJsonPath, "utf8"),
    ) as PackageJsonForDoctor;
  } catch {
    consola.warn("Could not read package.json for dependency checks.");
    return null;
  }
}

/**
 * Determine the config filename to write during init.
 * @param packageJson - Parsed package.json (or null if missing)
 * @returns The config file name to create
 */
export function getConfigFileName(
  packageJson: Readonly<PackageJsonForDoctor> | null,
): string {
  if (packageJson && hasDependency(packageJson, "typescript")) {
    return "openworkflow.config.ts";
  }

  return "openworkflow.config.js";
}

/**
 * Determine the example workflow filename to write during init.
 * @param packageJson - Parsed package.json (or null if missing)
 * @returns The example workflow file name to create
 */
export function getExampleWorkflowFileName(
  packageJson: Readonly<PackageJsonForDoctor> | null,
): string {
  const configFileName = getConfigFileName(packageJson);
  const extension = path.extname(configFileName) || ".js";

  return `hello-world${extension}`;
}

/**
 * Determine the hello-world runner filename to write during init.
 * @param packageJson - Parsed package.json (or null if missing)
 * @returns The runner file name to create
 */
export function getRunFileName(
  packageJson: Readonly<PackageJsonForDoctor> | null,
): string {
  const configFileName = getConfigFileName(packageJson);
  const extension = path.extname(configFileName) || ".js";

  return `hello-world.run${extension}`;
}

/**
 * Determine the client filename to write during init.
 * @param packageJson - Parsed package.json (or null if missing)
 * @returns The client file name to create
 */
export function getClientFileName(
  packageJson: Readonly<PackageJsonForDoctor> | null,
): string {
  const configFileName = getConfigFileName(packageJson);
  const extension = path.extname(configFileName) || ".js";

  return `client${extension}`;
}

/**
 * Check whether a dependency is declared in package.json.
 * @param packageJson - Parsed package.json.
 * @param name - Dependency name to check.
 * @returns True when the dependency is listed.
 */
function hasDependency(
  packageJson: Readonly<PackageJsonForDoctor>,
  name: string,
): boolean {
  return Boolean(
    packageJson.dependencies?.[name] ?? packageJson.devDependencies?.[name],
  );
}

/**
 * Warn when the configured backend is missing its package.
 * @param backendName - Configured backend name.
 * @param packageJson - Parsed package.json.
 */
function warnIfMissingBackendPackage(
  backendName: string,
  packageJson: Readonly<PackageJsonForDoctor>,
): void {
  const backendNameLower = backendName.toLowerCase();

  if (
    backendNameLower.includes("postgres") &&
    !hasDependency(packageJson, "@openworkflow/backend-postgres")
  ) {
    consola.warn(
      "Backend is Postgres but @openworkflow/backend-postgres is not installed.",
    );
  }

  if (
    backendNameLower.includes("sqlite") &&
    !hasDependency(packageJson, "@openworkflow/backend-sqlite")
  ) {
    consola.warn(
      "Backend is SQLite but @openworkflow/backend-sqlite is not installed.",
    );
  }
}

/**
 * Warn when TypeScript is installed but tsconfig.json is missing.
 * @param packageJson - Parsed package.json.
 */
function warnIfMissingTsconfig(
  packageJson: Readonly<PackageJsonForDoctor>,
): void {
  if (!hasDependency(packageJson, "typescript")) {
    return;
  }

  const tsconfigPath = path.join(process.cwd(), "tsconfig.json");
  if (!existsSync(tsconfigPath)) {
    consola.warn("TypeScript is installed but no tsconfig.json was found.");
  }
}

/**
 * Ensure a specific environment variable exists in a .env file. Creates the file if it
 * doesn't exist, appends the variable if not present.
 * @param envPath - Path to the .env file
 * @param key - The environment variable key (e.g. "OPENWORKFLOW_POSTGRES_URL")
 * @param value - The default value for the environment variable
 * @returns Object indicating whether the entry was added or already existed
 */
function ensureEnvEntry(
  envPath: string,
  key: string,
  value: string,
): { added: boolean; created: boolean } {
  const fileExists = existsSync(envPath);
  let content = "";

  if (fileExists) {
    content = readFileSync(envPath, "utf8");
  }

  // check if key already exists (looking for KEY= at start of line)
  const lines = content.split("\n");
  const hasKey = lines.some((line) => {
    const trimmed = line.trim();
    return trimmed.startsWith(`${key}=`) || trimmed.startsWith(`${key} =`);
  });

  if (hasKey) {
    return { added: false, created: false };
  }

  // add entry to .env
  let newContent: string;
  const envEntry = `${key}=${value}`;
  if (content === "") {
    newContent = `${envEntry}\n`;
  } else if (content.endsWith("\n")) {
    newContent = `${content}${envEntry}\n`;
  } else {
    newContent = `${content}\n${envEntry}\n`;
  }

  writeFileSync(envPath, newContent, "utf8");

  return { added: true, created: !fileExists };
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
