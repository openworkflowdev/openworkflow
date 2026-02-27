import { helloWorld } from "./hello-world.js";
import { defineWorkflow } from "openworkflow";

/**
 * Example workflow that runs hello-world as a child workflow.
 */
export const helloWorldParent = defineWorkflow(
  { name: "hello-world-parent" },
  async ({ step, run }) => {
    console.log(`[run ${run.id}]`);

    const childResult = await step.runWorkflow(helloWorld.spec);

    return { childResult, parentMessage: "Hello from the parent workflow!" };
  },
);
