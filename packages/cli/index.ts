import { init, workerStart } from "./commands.js";
import { withErrorHandling } from "./errors.js";
import { Command } from "commander";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const program = new Command();
program
  .name("ow")
  .alias("openworkflow")
  .version(getPackageJsonVersion())
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

/**
 * Gets the version from package.json, looking in both the current and parent
 * directory to handle dist/ subfolder
 * @returns Package version
 */
function getPackageJsonVersion(): string {
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const require = createRequire(import.meta.url);
  const pkgPath = existsSync(path.join(__dirname, "package.json"))
    ? "./package.json"
    : "../package.json";
  // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
  return require(pkgPath).version as string;
}
