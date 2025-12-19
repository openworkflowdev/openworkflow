import { defineWorkflow } from "openworkflow";

export interface GreetingInput {
  name: string;
}

export interface GreetingOutput {
  message: string;
}

// A workflow with a named export (greetingWorkflow)
export const greetingWorkflow = defineWorkflow<GreetingInput, GreetingOutput>(
  { name: "greeting", version: "1.0.0" },
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
