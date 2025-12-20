#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));

// get the version of the current package to ensure we call the matching CLI
const packageJsonPath = path.join(__dirname, "../../package.json");
const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8")) as {
  version: string;
};
const version = packageJson.version;

// capture all args passed to npx openworkflow (e.g., "init", "worker start")
const args = process.argv.slice(2);

// build the command, using tsx to run local TypeScript CLI if in dev and
// otherwise using npx to run the published CLI package
const cliScriptFilePath = path.resolve(__dirname, "../../../cli/index.ts");
const isMonorepo = existsSync(cliScriptFilePath);

if (isMonorepo) {
  console.log(
    "⚠️ Running OpenWorkflow CLI from local source (monorepo development mode)\n",
  );
}

const command = isMonorepo
  ? // `npx tsx ../../../cli/index.ts ...args`
    ["tsx", cliScriptFilePath, ...args]
  : // `npx -y @openworkflow/cli@<version> ...args`
    // uses -y to skip the "Need to install @openworkflow/cli" prompt
    ["-y", `@openworkflow/cli@${version}`, ...args];

// spawn the CLI the command to run the actual CLI package
const result = spawnSync(
  // eslint-disable-next-line sonarjs/no-os-command-from-path
  "npx",
  command,
  {
    stdio: "inherit",
    shell: true,
  },
);

// exit with the same status code as the CLI
process.exit(result.status ?? 0);
