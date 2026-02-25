import { helloWorld } from "./hello-world.js";
import { defineWorkflow } from "openworkflow";

/**
 * Example workflow that invokes hello-world as a child workflow.
 */
export const helloWorldParent = defineWorkflow(
  { name: "hello-world-parent" },
  async ({ step, run }) => {
    console.log(`[run ${run.id}]`);

    const childResult = await step.invokeWorkflow("hello-world-child", {
      workflow: helloWorld,
    });

    return { childResult, parentMessage: "Hello from the parent workflow!" };
  },
);
