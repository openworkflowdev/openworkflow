#!/usr/bin/env node
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// simple wrapper to load the dashboard server since the index.mjs file does not
// have a shebang line
const __dirname = dirname(fileURLToPath(import.meta.url));
const serverPath = join(__dirname, ".output", "server", "index.mjs");

await import(serverPath);
