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
import { Command } from "commander";

// openworkflow
const program = new Command();
program
  .name("openworkflow")
  .description("OpenWorkflow CLI - learn more at https://openworkflow.dev")
  .version(getVersion());

// init
program
  .command("init")
  .description("initialize OpenWorkflow")
  .action(withErrorHandling(init));

// doctor
program
  .command("doctor")
  .description("check configuration and list available workflows")
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
  .action(withErrorHandling(workerStart));

// dashboard
program
  .command("dashboard")
  .description("start the dashboard to view workflow runs")
  .action(withErrorHandling(dashboard));

await program.parseAsync(process.argv);
