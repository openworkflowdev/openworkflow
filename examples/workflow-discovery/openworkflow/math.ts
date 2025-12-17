import { defineWorkflow } from "openworkflow/internal";

interface AddNumbersInput {
  a: number;
  b: number;
}

interface AddNumbersOutput {
  result: number;
}

// One of two exported workflows
export const addWorkflow = defineWorkflow<AddNumbersInput, AddNumbersOutput>(
  { name: "add-numbers", version: "1.0.0" },
  async ({ input, step }) => {
    const result = await step.run({ name: "add" }, () => {
      return input.a + input.b;
    });

    return { result };
  },
);

interface MultiplyInput {
  a: number;
  b: number;
}

interface MultiplyOutput {
  result: number;
}

// The second of two exported workflows
export const multiplyWorkflow = defineWorkflow<MultiplyInput, MultiplyOutput>(
  { name: "multiply-numbers", version: "1.0.0" },
  async ({ input, step }) => {
    const result = await step.run({ name: "multiply" }, () => {
      return input.a * input.b;
    });

    return { result };
  },
);
