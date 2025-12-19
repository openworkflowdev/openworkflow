#!/usr/bin/env node
/* v8 ignore file -- @preserve */
import {
  doctor,
  init,
  workerStart,
  createRun,
  describeRun,
  listRuns,
} from "./commands.js";
import { withErrorHandling } from "./errors.js";
import { Command } from "commander";

// ow | openworkflow
const program = new Command();
program
  .name("ow")
  .alias("openworkflow")
  .description("OpenWorkflow CLI - learn more at https://openworkflow.dev");
program
  .command("init")
  .description("initialize OpenWorkflow")
  .action(withErrorHandling(init));
program
  .command("doctor")
  .description("check configuration and list workflows")
  .action(withErrorHandling(doctor));

// run (alias for workflow-runs create)
program
  .command("run [workflow]")
  .description("create a workflow run (alias for 'workflow-runs create')")
  .option("-i, --input <json>", "input data as JSON string")
  .option("-f, --file <path>", "path to a JSON file containing input data")
  .action(withErrorHandling(createRun));

// worker
const workerCmd = program.command("worker").description("manage workers");
workerCmd
  .command("start")
  .description("start a worker to process workflows")
  .option(
    "-c, --concurrency <number>",
    "number of concurrent workflows to process",
    Number.parseInt,
  )
  .action(withErrorHandling(workerStart));

// workflow-runs | runs
const workflowRunsCmd = program
  .command("workflow-runs")
  .alias("runs")
  .description("manage workflow runs");
workflowRunsCmd
  .command("create [workflow]")
  .description("create a workflow run") // aliased by 'run', keep them in sync
  .option("-i, --input <json>", "input data as JSON string")
  .option("-f, --file <path>", "path to a JSON file containing input data")
  .action(withErrorHandling(createRun));
workflowRunsCmd
  .command("list")
  .description("list workflow runs")
  .option("-l, --limit <number>", "number of runs to display", Number.parseInt)
  .option("-a, --after <cursor>", "pagination cursor for next page")
  .option("-b, --before <cursor>", "pagination cursor for previous page")
  .action(withErrorHandling(listRuns));
workflowRunsCmd
  .command("describe <run-id>")
  .description("describe a workflow run")
  .action(withErrorHandling(describeRun));

await program.parseAsync(process.argv);
