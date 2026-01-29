import { defineWorkflow } from "openworkflow";

/**
 * Example workflow that greets the world.
 *
 * This workflow is auto-discovered by the CLI worker.
 * To trigger it, use ow.runWorkflow() from your app:
 * ```ts
 * import { ow } from "./openworkflow/client.js";
 * import { helloWorld } from "./openworkflow/hello-world.js";
 * const handle = await ow.runWorkflow(helloWorld.spec, {});
 * const result = await handle.result();
 * ```
 */
export const helloWorld = defineWorkflow(
  { name: "hello-world" },
  async ({ step }) => {
    const greeting = await step.run({ name: "greet" }, () => {
      return "Hello, World!";
    });

    await step.sleep("wait-a-bit", "1s");

    return { greeting };
  },
);
