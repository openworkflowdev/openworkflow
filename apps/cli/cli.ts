#!/usr/bin/env node
/* v8 ignore file -- @preserve */
import {
  dashboard,
  doctor,
  getVersion,
  init,
  workerStart,
} from "./commands.js";
import { withErrorHandling } from "./errors.js";
import {
  initializeTelemetry,
  shutdownTelemetry,
  trackCommand,
} from "./telemetry.js";
import { Command, CommanderError, Option } from "commander";

// openworkflow
const program = new Command();
initializeTelemetry(program);
program
  .name("openworkflow")
  .description("OpenWorkflow CLI - learn more at https://openworkflow.dev")
  .usage("<command> [options]")
  .exitOverride()
  .version(getVersion())
  .option("--no-telemetry", "disable telemetry");

// init
program
  .command("init")
  .description("initialize OpenWorkflow")
  .addOption(
    new Option("--backend <backend>", "backend to configure").choices([
      "sqlite",
      "postgres",
      "both",
    ]),
  )
  .option(
    "-y, --yes",
    "skip prompts (requires --backend; does not allow overwrites)",
  )
  .option(
    "--skip-install",
    "create project files without installing dependencies",
  )
  .option("--config <path>", "path to OpenWorkflow config file")
  .option("--env-file <path>", "load environment variables from file")
  .action(
    withErrorHandling((options: Parameters<typeof init>[0]) => init(options)),
  );

// doctor
program
  .command("doctor")
  .description("check worker prerequisites")
  .option("--config <path>", "path to OpenWorkflow config file")
  .option("--env-file <path>", "load environment variables from file")
  .action(withErrorHandling(doctor));

// worker
const workerCmd = program.command("worker").description("manage workers");

// worker start
workerCmd
  .command("start")
  .description("start a worker to process workflows")
  .option(
    "-c, --concurrency <number>",
    "number of concurrent workflows to process",
    Number.parseInt,
  )
  .option("--config <path>", "path to OpenWorkflow config file")
  .option("--env-file <path>", "load environment variables from file")
  .action(withErrorHandling(workerStart));

// dashboard
program
  .command("dashboard")
  .description("start the dashboard to view workflow runs")
  .option(
    "-p, --port <number>",
    "custom port for the dashboard server",
    Number.parseInt,
  )
  .option("--config <path>", "path to OpenWorkflow config file")
  .option("--env-file <path>", "load environment variables from file")
  .action(withErrorHandling(dashboard));

try {
  await program.parseAsync(process.argv);
} catch (error) {
  if (!(error instanceof CommanderError)) throw error;
  process.exitCode = error.exitCode;
  trackCommand();
} finally {
  await shutdownTelemetry();
}
