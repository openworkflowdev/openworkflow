import { init, workerStart } from "./commands.js";
import { withErrorHandling } from "./errors.js";
import { Command } from "commander";

const program = new Command();
program
  .name("ow")
  .alias("openworkflow")
  .description("OpenWorkflow CLI - learn more at https://openworkflow.dev");
program
  .command("init")
  .description("initialize OpenWorkflow")
  .action(withErrorHandling(init));
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

program.parse();
