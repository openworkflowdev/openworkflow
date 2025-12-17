import { GreetingInput, GreetingOutput } from "./greeting.js";
import { defineWorkflow } from "openworkflow/internal";

// A workflow with a default export
export default defineWorkflow<GreetingInput, GreetingOutput>(
  { name: "greeting-default", version: "1.0.0" },
  async ({ input, step }) => {
    const greeting = await step.run({ name: "generate-greeting" }, () => {
      return `Hello, ${input.name}!`;
    });

    const message = await step.run({ name: "format-message" }, () => {
      return `${greeting} Welcome to OpenWorkflow.`;
    });

    return { message };
  },
);
