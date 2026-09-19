import {
  WorkerConfig,
  findConfigFile,
  loadConfig,
  loadConfigFromPath,
} from "./config.js";
import { CLIError, exit } from "./errors.js";
import { createModuleLoader } from "./module-loader.js";
import { trackCommand } from "./telemetry.js";
import {
  getConfigTemplate,
  HELLO_WORLD_RUNNER,
  HELLO_WORLD_WORKFLOW,
  POSTGRES_CLIENT,
  POSTGRES_PROD_SQLITE_DEV_CLIENT,
  SQLITE_CLIENT,
} from "./templates.js";
import * as p from "@clack/prompts";
import { consola } from "consola";
import { config as loadDotenv, parse as parseDotenv } from "dotenv";
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
import {
  addDependency,
  addDependencyCommand,
  detectPackageManager,
} from "nypm";
import { OpenWorkflow } from "openworkflow";
import { Backend, isWorkflow, Workflow } from "openworkflow/internal";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const workflowSources = new WeakMap<
  Workflow<unknown, unknown, unknown>,
  string
>();

type BackendChoice = "sqlite" | "postgres" | "both";

interface CommandOptions {
  config?: string;
  envFile?: string;
}

interface InitOptions extends CommandOptions {
  backend?: BackendChoice;
  yes?: boolean;
  skipInstall?: boolean;
}

interface InitDependencies {
  addDependency: typeof addDependency;
  note: typeof p.note;
}

const DEFAULT_INIT_DEPENDENCIES: InitDependencies = {
  addDependency,
  note: p.note,
};

interface DashboardOptions extends CommandOptions {
  port?: number;
}

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

/**
 * openworkflow init
 * @param options - Command options
 * @param services - Package installer and setup instructions output
 * @returns Resolves when setup finishes.
 */
// oxlint-disable-next-line complexity
export async function init(
  options: InitOptions = {},
  services: InitDependencies = DEFAULT_INIT_DEPENDENCIES,
): Promise<void> {
  if (options.yes && !options.backend) {
    throw new CLIError("--backend is required with --yes.");
  }
  if (!options.yes && !process.stdin.isTTY) {
    throw new CLIError(
      "Interactive setup requires a terminal. Pass --backend sqlite|postgres|both --yes.",
    );
  }
  p.intro("Initializing OpenWorkflow...");

  const configFile = findConfigWithEnv(options);
  let configFileToDelete: string | null = null;

  if (configFile && existsSync(configFile)) {
    if (options.yes) {
      throw new CLIError(
        `Config file already exists at ${configFile}. --yes does not allow overwrites.`,
      );
    }
    const shouldOverride = await p.confirm({
      message: `Config file already exists at ${configFile}. Override it?`,
      initialValue: false,
    });

    if (!shouldOverride || p.isCancel(shouldOverride)) return cancelSetup();

    configFileToDelete = configFile;
  }

  const backendChoice =
    options.backend ??
    (await p.select<BackendChoice>({
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
    }));

  if (typeof backendChoice === "symbol") return cancelSetup();
  trackCommand(backendChoice);

  const spinner = p.spinner();

  // detect package manager & install packages
  spinner.start("Detecting package manager...");
  const pm = await detectPackageManager(process.cwd());
  const packageManager = pm?.name ?? "npm";
  spinner.stop(`Using ${packageManager}`);

  const packageJson = readPackageJsonForDoctor();
  if (!packageJson) {
    throw new CLIError(
      "No package.json found.",
      "Please create a package.json file first by running `npm init` or `npm init -y`.",
    );
  }

  const configArg = options.config
    ? ` --config '${options.config.replaceAll("'", String.raw`'\''`)}'`
    : "";
  const workerCommand = `npx @openworkflow/cli worker start${configArg}`;
  validateInitManifest(packageJson, workerCommand);

  const configFileName = options.config ?? getConfigFileName(packageJson);
  const clientFileName = getClientFileName(packageJson);
  const exampleWorkflowFileName = getExampleWorkflowFileName(packageJson);
  const runFileName = getRunFileName(packageJson);
  const runCommand = runFileName.endsWith(".ts")
    ? `npx tsx openworkflow/${runFileName}`
    : `node openworkflow/${runFileName}`;

  const shouldSetup =
    options.yes ??
    (await p.confirm({
      message: options.skipInstall
        ? "Set up project files?"
        : "Install packages and set up project files?",
      initialValue: true,
    }));

  if (p.isCancel(shouldSetup)) return cancelSetup();

  if (!shouldSetup) {
    p.outro("Setup skipped.");
    return;
  }

  const dependencies = getDependenciesToInstall(backendChoice);
  const devDependencies = getDevDependenciesToInstall();
  if (options.skipInstall) {
    services.note(
      [
        addDependencyCommand(packageManager, dependencies),
        addDependencyCommand(packageManager, devDependencies, { dev: true }),
      ].join("\n"),
      "Install dependencies before running OpenWorkflow",
    );
  } else {
    spinner.start(`Installing ${dependencies.join(", ")}...`);
    await services.addDependency(dependencies, {
      silent: true,
      packageManager,
    });
    spinner.stop(`Installed ${dependencies.join(", ")}`);
    spinner.start(`Installing ${devDependencies.join(", ")}...`);
    await services.addDependency(devDependencies, {
      silent: true,
      dev: true,
      packageManager,
    });
    spinner.stop(`Installed ${devDependencies.join(", ")}`);
  }

  if (configFileToDelete) {
    unlinkSync(configFileToDelete);
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

  addWorkerScriptToPackageJson(workerCommand);

  // write config file last, so canceling earlier doesn't leave a config file
  // which would prevent re-running init
  createConfigFile(configFileName);

  // wrap up
  services.note(
    `➡️ Start a worker:\n$ ${workerCommand}\n\n➡️ Run the example workflow:\n$ ${runCommand}\n\n➡️ View the dashboard:\n$ npx @openworkflow/cli dashboard${configArg}`,
    "Next steps",
  );
  p.outro("✅ Setup complete!");
}

// Validate the manifest fields that init reads or updates.
function validateInitManifest(manifest: unknown, workerCommand: string): void {
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
    throw new CLIError("Invalid package.json: expected an object.");
  }

  for (const key of ["scripts", "dependencies", "devDependencies"]) {
    const field = (manifest as Record<string, unknown>)[key];
    if (field === undefined) continue;
    if (
      field === null ||
      typeof field !== "object" ||
      Array.isArray(field) ||
      Object.values(field).some((value) => typeof value !== "string")
    ) {
      throw new CLIError(
        `Invalid package.json: ${key} must be an object containing string values.`,
      );
    }
  }

  const { scripts } = manifest as PackageJsonForDoctor;
  const worker = scripts?.["worker"];
  if (
    worker !== undefined &&
    worker !== "npx @openworkflow/cli worker start" &&
    worker !== workerCommand
  ) {
    throw new CLIError("Setup would overwrite package.json scripts.worker.");
  }
}

/**
 * openworkflow doctor
 * @param options - Command options
 */
export async function doctor(options: CommandOptions = {}): Promise<void> {
  consola.start("Running OpenWorkflow doctor...");
  const timer = setTimeout(() => {
    consola.error("Doctor timed out after 30 seconds.");
    void exit(1);
  }, 30_000);

  const { config, configFile } = await loadConfigWithEnv(options);
  if (!configFile) {
    throw new CLIError(
      "No config file found.",
      "Run `npx @openworkflow/cli init` to create a config file.",
    );
  }
  const backend = config.backend;
  let cleanupFailed = false;

  try {
    await checkBackendConnection(backend);
    if (config.worker?.concurrency !== undefined) {
      assertPositiveInteger("concurrency", config.worker.concurrency);
    }
    consola.log("");
    consola.info(`Config file: ${path.relative(process.cwd(), configFile)}`);

    const backendName = backend.constructor.name.replace("Backend", "");
    consola.log(`  • Backend: ${backendName}`);

    // discover directories
    const dirs = [...new Set(getWorkflowDirectories(config))];
    consola.log(`  • Workflow directories: ${dirs.join(", ")}`);

    // discover files
    const configFileDir = path.dirname(configFile);
    const { workflows } = await discoverWorkflowsInDirs(
      dirs,
      configFileDir,
      config.ignorePatterns ?? [],
    );
    assertNoDuplicateWorkflows(workflows);
    printDiscoveredWorkflows(workflows);
  } finally {
    // Imported configs can omit the backend despite the declared config type.
    // oxlint-disable-next-line typescript/no-unnecessary-condition
    if (typeof backend?.stop === "function") {
      try {
        await backend.stop();
      } catch (error) {
        cleanupFailed = true;
        consola.error(`Backend cleanup failed: ${String(error)}`);
      }
    }
  }

  clearTimeout(timer);
  if (cleanupFailed) await exit(1);
  consola.log("");
  consola.success("Configuration looks good!");
  await exit(0);
}

export type WorkerStartOptions = WorkerConfig & CommandOptions;

/**
 * openworkflow worker start
 * @param options - Worker config and command options
 */
export async function workerStart(
  options: WorkerStartOptions = {},
): Promise<void> {
  consola.start("Starting worker...");

  const { config, configFile } = await loadConfigWithEnv(options);
  if (!configFile) {
    throw new CLIError(
      "No config file found.",
      "Run `npx @openworkflow/cli init` to create a config file.",
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
    await checkBackendConnection(backend);

    // discover and import workflows
    const dirs = getWorkflowDirectories(config);
    consola.info(`Discovering workflows from: ${dirs.join(", ")}`);

    const configFileDir = path.dirname(configFile);
    const { files, workflows } = await discoverWorkflowsInDirs(
      dirs,
      configFileDir,
      config.ignorePatterns ?? [],
    );
    consola.info(`Found ${String(files.length)} workflow file(s)`);

    consola.success(
      `Loaded ${String(workflows.length)} workflow(s): ${workflows.map((w) => w.spec.name).join(", ")}`,
    );

    assertNoDuplicateWorkflows(workflows);

    const workerOptions = mergeDefinedOptions(config.worker, {
      concurrency: options.concurrency,
    });
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
    try {
      await gracefulShutdown();
    } catch (cleanupError) {
      consola.warn(`Backend cleanup failed: ${String(cleanupError)}`);
    }
    throw error;
  }
}

interface DashboardSpawnOptions {
  command: string;
  args: string[];
  spawnOptions: {
    stdio: "inherit";
    env: NodeJS.ProcessEnv;
  };
}

/**
 * openworkflow dashboard
 * Starts the dashboard by delegating to `@openworkflow/dashboard` via npx.
 * @param port - Optional dashboard port.
 * @returns Spawn configuration for launching the dashboard process.
 */
export function getDashboardSpawnOptions(port?: number): DashboardSpawnOptions {
  return {
    command: "npx",
    args: ["@openworkflow/dashboard"],
    spawnOptions: {
      stdio: "inherit",
      env:
        port === undefined
          ? process.env
          : { ...process.env, PORT: String(port) },
    },
  };
}

/**
 * Validate dashboard port option.
 * @param port - Optional dashboard port.
 * @returns Validated dashboard port.
 * @throws {CLIError} If the provided port is not an integer in the 1-65535 range.
 */
export function validateDashboardPort(port?: number): number | undefined {
  if (port === undefined) {
    return undefined;
  }

  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new CLIError(
      "Invalid dashboard port.",
      "Use an integer between 1 and 65535, for example `--port 3001`.",
    );
  }

  return port;
}

/**
 * Start the dashboard process.
 * @param options - Dashboard command options.
 * @returns Resolves when the dashboard process exits.
 */
export async function dashboard(options: DashboardOptions = {}): Promise<void> {
  const port = validateDashboardPort(options.port);
  consola.start("Starting dashboard...");

  const { configFile } = await loadConfigWithEnv(options);
  if (!configFile) {
    throw new CLIError(
      "No config file found.",
      "Run `npx @openworkflow/cli init` to create a config file before starting the dashboard.",
    );
  }
  consola.info(`Using config: ${configFile}`);

  const spawnConfig = getDashboardSpawnOptions(port);
  const child = spawn(
    spawnConfig.command,
    spawnConfig.args,
    spawnConfig.spawnOptions,
  );

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
 * Show a canceled-setup message and exit the process with status 0.
 * @returns Never resolves because the process exits.
 */
function cancelSetup(): Promise<never> {
  p.cancel("Setup canceled.");
  return exit(0);
}

/**
 * Exercise backend initialization, connectivity, and workflow table access.
 * @param backend - Configured backend
 */
async function checkBackendConnection(
  backend: Backend | undefined,
): Promise<void> {
  if (
    typeof backend?.listWorkflowRuns !== "function" ||
    typeof backend.stop !== "function"
  ) {
    throw new CLIError(
      "Missing or invalid backend.",
      "Set config.backend to a connected OpenWorkflow backend.",
    );
  }
  try {
    await backend.listWorkflowRuns({ limit: 1 });
  } catch (error) {
    throw new CLIError(
      "Failed to access backend.",
      error instanceof Error ? error.message : String(error),
    );
  }
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
    const key = JSON.stringify([name, version]);

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
 * Print discovered workflows to the console.
 * @param workflows - Array of discovered workflows
 */
function printDiscoveredWorkflows(
  workflows: Workflow<unknown, unknown, unknown>[],
): void {
  consola.log("");
  consola.info(
    `Found ${String(workflows.length)} workflow${workflows.length === 1 ? "" : "s"}:`,
  );
  for (const workflow of workflows) {
    const name = workflow.spec.name;
    const version = workflow.spec.version;
    const versionStr = version ? ` (${version})` : "";
    consola.log(`  • ${name}${versionStr} — ${workflowSources.get(workflow)}`);
  }
}

const WORKFLOW_EXTENSIONS = ["ts", "mts", "cts", "js", "mjs", "cjs"] as const;
const DEFAULT_IGNORE_PATTERNS = ["**/*.run.*"];

/**
 * Normalize a path for glob matching.
 * @param filePath - Path to normalize
 * @returns Normalized path
 */
function normalizeForGlobMatch(filePath: string): string {
  return filePath.split(path.sep).join("/");
}

/**
 * Escape a single character for regex usage.
 * @param char - Character to escape
 * @returns Escaped character
 */
function escapeRegexChar(char: string): string {
  return /[-/\\^$+?.()|[\]{}]/.test(char) ? `\\${char}` : char;
}

interface GlobToken {
  regexFragment: string;
  nextIndex: number;
}

/**
 * Handle "*" and "**" glob tokens.
 * @param pattern - Glob pattern
 * @param index - Current index
 * @returns Regex fragment and next index
 */
function handleAsteriskToken(pattern: string, index: number): GlobToken {
  const next = pattern[index + 1];
  if (next === "*") {
    const nextIndex = pattern[index + 2] === "/" ? index + 3 : index + 2;
    return {
      regexFragment: pattern[index + 2] === "/" ? "(?:.*/)?" : ".*",
      nextIndex,
    };
  }

  return { regexFragment: "[^/]*", nextIndex: index + 1 };
}

/**
 * Convert a glob pattern to a RegExp.
 * @param pattern - Glob pattern
 * @returns Regex to match the glob
 */
function globToRegExp(pattern: string): RegExp {
  let regex = "^";
  let index = 0;

  while (index < pattern.length) {
    const char = pattern[index];
    if (!char) break;

    switch (char) {
      case "*": {
        const { regexFragment, nextIndex } = handleAsteriskToken(
          pattern,
          index,
        );
        regex += regexFragment;
        index = nextIndex;
        break;
      }
      case "?": {
        regex += "[^/]";
        index += 1;
        break;
      }
      default: {
        regex += escapeRegexChar(char);
        index += 1;
      }
    }
  }

  regex += "$";
  return new RegExp(regex);
}

/**
 * Check whether a file or directory path matches ignore patterns.
 * @param filePath - Absolute path, with a trailing separator for directories
 * @param baseDir - Base directory for relative matching
 * @param matchers - Compiled regex matchers
 * @returns Whether the file should be ignored
 */
function isIgnoredFile(
  filePath: string,
  baseDir: string,
  matchers: RegExp[],
): boolean {
  if (matchers.length === 0) return false;

  const relativePath = normalizeForGlobMatch(path.relative(baseDir, filePath));
  const fileName = path.basename(filePath);
  const isDirectory = filePath.endsWith(path.sep);

  return matchers.some(
    (matcher) =>
      matcher.test(relativePath) ||
      matcher.test(fileName) ||
      (isDirectory &&
        (matcher.test(`${relativePath}/`) || matcher.test(`${fileName}/`))),
  );
}

/**
 * Discover workflow files from directories. Recursively scans directories for
 * workflow files with supported extensions (.ts, .js, .mjs, .cjs).
 * @param dirs - Directory or directories to scan for workflow files
 * @param baseDir - Base directory to resolve relative paths from
 * @param ignorePatterns - Glob patterns to ignore
 * @returns Array of absolute file paths
 */
export function discoverWorkflowFiles(
  dirs: string[],
  baseDir: string,
  ignorePatterns: string[] = [],
): string[] {
  const discoveredFiles: string[] = [];
  const patterns = [...DEFAULT_IGNORE_PATTERNS, ...ignorePatterns];
  const matchers = patterns.map((pattern) => globToRegExp(pattern));

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
      throw new CLIError(
        `Cannot read workflow directory: ${absoluteDir}`,
        `${String(error)}\nCorrect config.dirs or make the directory readable.`,
      );
    }

    for (const entry of entries) {
      const fullPath = path.join(absoluteDir, entry.name);
      if (entry.isDirectory()) {
        if (!isIgnoredFile(`${fullPath}${path.sep}`, baseDir, matchers)) {
          scanDirectory(fullPath);
        }
      } else if (
        entry.isFile() &&
        WORKFLOW_EXTENSIONS.some((ext: string) =>
          entry.name.endsWith(`.${ext}`),
        ) &&
        !/\.d\.(?:ts|mts|cts)$/.test(entry.name) &&
        !isIgnoredFile(fullPath, baseDir, matchers)
      ) {
        discoveredFiles.push(fullPath);
      }
    }
  }

  for (const dir of dirs) {
    scanDirectory(dir);
  }

  return [...new Set(discoveredFiles)];
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

  for (const file of files) {
    // import the module
    let module: Record<string, unknown>;
    try {
      const jiti = createModuleLoader(file);
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
        workflows.push(value);
        workflowSources.set(value, path.relative(process.cwd(), file));
        consola.debug(
          `Found workflow "${value.spec.name}" in ${file} (${key})`,
        );
      }
    }
  }

  return [...new Set(workflows)];
}

/**
 * Discover workflow files and import workflows with common error handling.
 * @param dirs - Workflow directories
 * @param baseDir - Base directory for relative paths
 * @param ignorePatterns - Glob patterns to ignore
 * @returns Files and workflows
 */
async function discoverWorkflowsInDirs(
  dirs: string[],
  baseDir: string,
  ignorePatterns: string[] = [],
): Promise<{
  files: string[];
  workflows: Workflow<unknown, unknown, unknown>[];
}> {
  const files = discoverWorkflowFiles(dirs, baseDir, ignorePatterns);

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

  if (backendChoice === "postgres" || backendChoice === "both") {
    dependencies.push("postgres");
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
  const configDestPath = path.resolve(process.cwd(), configFileName);
  const relativeClientPath = path
    .relative(
      path.dirname(configDestPath),
      path.join(process.cwd(), "openworkflow/client.js"),
    )
    .replaceAll(path.sep, "/");
  const clientImport = relativeClientPath.startsWith("../")
    ? relativeClientPath
    : `./${relativeClientPath}`;

  // mkdir if the user specified a config file, and they want it in a dir
  mkdirSync(path.dirname(configDestPath), { recursive: true });

  writeFileSync(configDestPath, getConfigTemplate(clientImport), "utf8");
  spinner.stop(`Config written to ${configDestPath}`);
}

/**
 * Write a file under the `openworkflow/` project directory, skipping when a
 * file with the same name already exists. Progress is surfaced via the clack
 * spinner using the provided label (e.g. "client file").
 * @param label - Lowercase label describing the file (used in spinner text)
 * @param fileName - Filename to write inside `openworkflow/`
 * @param content - File contents to write when the file does not exist
 */
function writeWorkflowFileIfMissing(
  label: string,
  fileName: string,
  content: string,
): void {
  const spinner = p.spinner();
  const workflowsDir = path.join(process.cwd(), "openworkflow");
  if (!existsSync(workflowsDir)) {
    mkdirSync(workflowsDir, { recursive: true });
  }
  const destPath = path.join(workflowsDir, fileName);
  if (existsSync(destPath)) {
    spinner.start(`Checking ${label}...`);
    const capitalized = label.charAt(0).toUpperCase() + label.slice(1);
    spinner.stop(`${capitalized} already exists at ${destPath}`);
    return;
  }

  spinner.start(`Creating ${label}...`);
  writeFileSync(destPath, content, "utf8");
  spinner.stop(`Created ${label} at ${destPath}`);
}

/**
 * Create hello-world runner file.
 * @param runFileName - The runner filename to write
 */
function createRunFile(runFileName: string): void {
  writeWorkflowFileIfMissing(
    "hello-world runner",
    runFileName,
    HELLO_WORLD_RUNNER,
  );
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
  writeWorkflowFileIfMissing(
    "client file",
    clientFileName,
    getClientTemplate(backendChoice),
  );
}

/**
 * Create example workflow.
 * @param exampleWorkflowFileName - The example workflow filename to write
 */
function createExampleWorkflow(exampleWorkflowFileName: string): void {
  writeWorkflowFileIfMissing(
    "example (hello-world) workflow",
    exampleWorkflowFileName,
    HELLO_WORLD_WORKFLOW,
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
  const added = ensureGitignoreEntry(gitignorePath, "openworkflow/backend.db*");
  spinner.stop(
    added
      ? "Added openworkflow/backend.db* to .gitignore"
      : "openworkflow/backend.db* already in .gitignore",
  );
}

/**
 * Add worker script to package.json.
 * @param workerCommand - Worker command including any custom config path.
 */
function addWorkerScriptToPackageJson(workerCommand: string): void {
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
    packageJson.scripts["worker"] = workerCommand;

    writeFileSync(
      packageJsonPath,
      `${JSON.stringify(packageJson, null, 2)}\n`,
      "utf8",
    );

    spinner.stop('Added "worker" script to package.json');
  } catch {
    spinner.stop("Failed to update package.json");
    consola.warn("Could not add worker script to package.json");
  }
}

/**
 * Append a line if the file does not already contain the desired entry.
 * Creates the file if it doesn't exist.
 * @param filePath - Path to the file
 * @param line - Line to append (without a trailing newline)
 * @param matchesExisting - Predicate that checks whether the file contents
 * already contain the desired entry
 * @returns Whether the line was appended
 */
function appendLineIfMissing(
  filePath: string,
  line: string,
  matchesExisting: (content: string) => boolean,
): boolean {
  const content = existsSync(filePath) ? readFileSync(filePath, "utf8") : "";

  if (matchesExisting(content)) {
    return false;
  }

  const separator = content === "" || content.endsWith("\n") ? "" : "\n";
  writeFileSync(filePath, `${content}${separator}${line}\n`, "utf8");
  return true;
}

/**
 * Ensure a specific entry exists in a .gitignore file. Creates the file if it
 * doesn't exist, appends the entry if not present.
 * @param gitignorePath - Path to the .gitignore file
 * @param entry - The entry to add (e.g. "openworkflow/backend.db*")
 * @returns Whether the entry was appended
 */
function ensureGitignoreEntry(gitignorePath: string, entry: string): boolean {
  return appendLineIfMissing(gitignorePath, entry, (content) =>
    content.split("\n").some((line) => line.trim() === entry),
  );
}

/**
 * Add OPENWORKFLOW_POSTGRES_URL to .env file.
 */
function updateEnvForPostgres(): void {
  const envPath = path.join(process.cwd(), ".env");
  const spinner = p.spinner();
  spinner.start("Updating .env...");
  const added = ensureEnvEntry(
    envPath,
    "OPENWORKFLOW_POSTGRES_URL",
    "postgresql://user:password@localhost:5432/openworkflow",
  );
  spinner.stop(
    added
      ? "Added OPENWORKFLOW_POSTGRES_URL to .env"
      : "OPENWORKFLOW_POSTGRES_URL already in .env",
  );
}

/**
 * Find the config and load its environment without importing it.
 * @param options - Config and environment file paths
 * @returns Config path, if found.
 */
function findConfigWithEnv(options: CommandOptions) {
  const { envFile } = options;
  const configPath = options.config
    ? path.resolve(options.config)
    : findConfigFile();
  const baseDir = configPath ? path.dirname(configPath) : process.cwd();
  const { error } = loadDotenv({
    path: envFile ?? path.join(baseDir, ".env"),
    quiet: true,
  });
  if (envFile !== undefined && error) {
    throw new CLIError(
      `Failed to load environment file: ${envFile}`,
      error.message,
    );
  }
  return configPath;
}

// Load the environment before importing config for commands that use it.
async function loadConfigWithEnv(options: CommandOptions) {
  const configPath = findConfigWithEnv(options);
  try {
    const loaded = await loadConfigFromPath(
      configPath ?? "openworkflow.config.ts",
    );
    trackCommand(loaded.config.backend);
    return loaded;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new CLIError("Failed to load OpenWorkflow config.", message);
  }
}

interface PackageJsonForDoctor {
  scripts?: Record<string, string>;
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
 * Pick the script file extension for generated files based on whether the
 * project uses TypeScript.
 * @param packageJson - Parsed package.json (or null if missing)
 * @returns ".ts" when TypeScript is a dependency, otherwise ".js"
 */
function getScriptExtension(
  packageJson: Readonly<PackageJsonForDoctor> | null,
): ".ts" | ".js" {
  return packageJson && hasDependency(packageJson, "typescript")
    ? ".ts"
    : ".js";
}

/**
 * Determine the config filename to write during init.
 * @param packageJson - Parsed package.json (or null if missing)
 * @returns The config file name to create
 */
export function getConfigFileName(
  packageJson: Readonly<PackageJsonForDoctor> | null,
): string {
  return `openworkflow.config${getScriptExtension(packageJson)}`;
}

/**
 * Determine the example workflow filename to write during init.
 * @param packageJson - Parsed package.json (or null if missing)
 * @returns The example workflow file name to create
 */
export function getExampleWorkflowFileName(
  packageJson: Readonly<PackageJsonForDoctor> | null,
): string {
  return `hello-world${getScriptExtension(packageJson)}`;
}

/**
 * Determine the hello-world runner filename to write during init.
 * @param packageJson - Parsed package.json (or null if missing)
 * @returns The runner file name to create
 */
export function getRunFileName(
  packageJson: Readonly<PackageJsonForDoctor> | null,
): string {
  return `hello-world.run${getScriptExtension(packageJson)}`;
}

/**
 * Determine the client filename to write during init.
 * @param packageJson - Parsed package.json (or null if missing)
 * @returns The client file name to create
 */
export function getClientFileName(
  packageJson: Readonly<PackageJsonForDoctor> | null,
): string {
  return `client${getScriptExtension(packageJson)}`;
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
 * Ensure a specific environment variable exists in a .env file. Creates the
 * file if it doesn't exist, appends the variable if not present.
 * @param envPath - Path to the .env file
 * @param key - The environment variable key (e.g. "OPENWORKFLOW_POSTGRES_URL")
 * @param value - The default value for the environment variable
 * @returns Whether the entry was appended
 */
function ensureEnvEntry(envPath: string, key: string, value: string): boolean {
  return appendLineIfMissing(envPath, `${key}=${value}`, (content) =>
    Object.hasOwn(parseDotenv(content), key),
  );
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
