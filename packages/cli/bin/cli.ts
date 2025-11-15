#!/usr/bin/env -S tsx

import { serveCommand } from "../serve.js";
import { Command } from "commander";

const program = new Command();

program
  .name("ow")
  .description("OpenWorkflow CLI")
  .version("0.1.0")
  .addCommand(serveCommand)
  .parse();
