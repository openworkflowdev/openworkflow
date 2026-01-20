import { defineWorkflow } from "openworkflow";

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
