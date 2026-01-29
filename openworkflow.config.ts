import { backend } from "./openworkflow/client.js";
import { defineConfig } from "@openworkflow/cli";

export default defineConfig({
  backend,
  dirs: "./openworkflow",
});
