import { DEFAULT_SCHEMA, migrations, migrationSetup } from "../postgres.js";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const squawk = fileURLToPath(import.meta.resolve("squawk-cli/js/bin/squawk"));

for (const [version, migration] of migrations(DEFAULT_SCHEMA).entries()) {
  const result = spawnSync(
    process.execPath,
    [
      squawk,
      "--pg-version=14",
      `--stdin-filepath=migration-${String(version)}.sql`,
      ...process.argv.slice(2),
    ],
    {
      input: `${migrationSetup}\n${migration}`,
      stdio: ["pipe", "inherit", "inherit"],
    },
  );

  if (result.error) throw result.error;
  if (result.status !== 0) process.exitCode = result.status ?? 1;
}
