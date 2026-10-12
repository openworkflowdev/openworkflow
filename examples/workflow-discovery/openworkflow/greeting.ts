import { defineWorkflow } from "openworkflow";

export interface GreetingInput {
  name: string;
}

export interface GreetingOutput {
  message: string;
}

// A workflow with a named export (greetingWorkflow)
export const greetingWorkflow = defineWorkflow<GreetingInput, GreetingOutput>(
  {
    name: "greeting",
    schedules: [
      {
        cron: "*/10 * * * * *", // every 10s while worker is running
        input: { name: "scheduled visitor" },
      },
    ],
  },
  async ({ input, step }) => {
    const greeting = await step.run({ name: "generate-greeting" }, () => {
      return `Hello, ${input.name}!`;
    });

    const message = await step.run({ name: "format-message" }, () => {
      const formatted = `${greeting} Welcome to OpenWorkflow.`;
      console.log(formatted); // this will log every 10s
      return formatted;
    });

    return { message };
  },
);
