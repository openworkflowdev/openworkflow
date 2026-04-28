#!/usr/bin/env node
import path from "node:path";
import { fileURLToPath } from "node:url";

// simple wrapper to load the dashboard server since the index.mjs file does not
// have a shebang line
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const serverPath = path.join(__dirname, ".output", "server", "index.mjs");

await import(serverPath);
