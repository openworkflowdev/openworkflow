import { DEFAULT_SCHEMA, migrations } from "../postgres.js";
import { execSync } from "node:child_process";
import { unlinkSync, writeFileSync } from "node:fs";

const sql = migrations(DEFAULT_SCHEMA).join("\n\n");
writeFileSync("squawk.sql", sql);

try {
  // eslint-disable-next-line sonarjs/no-os-command-from-path
  execSync("npx squawk squawk.sql", { stdio: "inherit" });
} catch {
  // ignore - squawk will produce its own error output
} finally {
  unlinkSync("squawk.sql");
  console.log("");
}
