import { resolveConfig } from "./config.js";
import { Command } from "commander";

export const serveCommand = new Command("serve")
  .description("Start the OpenWorkflow server")
  .action(async () => {
    const { ow, port } = await resolveConfig();
    await ow.serve({ port });
  });
