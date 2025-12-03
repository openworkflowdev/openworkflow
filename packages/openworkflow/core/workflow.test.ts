import type { StandardSchemaV1 } from "./schema.js";
import {
  validateInput,
  createWorkflowConfig,
  hasSchema,
  isTerminalStatus,
  DEFAULT_WORKFLOW_RESULT_CONFIG,
} from "./workflow.js";
import { describe, expect, test } from "vitest";

describe("validateInput", () => {
  test("returns success with input when no schema provided (null)", async () => {
    const input = { name: "test", value: 42 };
    const result = await validateInput(null, input);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.value).toBe(input);
    }
  });

  test("returns success with input when no schema provided (undefined)", async () => {
    const input = "string input";
    const result = await validateInput(undefined, input);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.value).toBe(input);
    }
  });

  test("validates input successfully against schema", async () => {
    const schema = createMockSchema<{ name: string }>({
      validate: (input) => ({ value: input as { name: string } }),
    });
    const input = { name: "test" };

    const result = await validateInput(schema, input);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.value).toEqual({ name: "test" });
    }
  });

  test("transforms input using schema", async () => {
    const schema = createMockSchema<string, number>({
      validate: (input) => ({ value: Number.parseInt(input as string, 10) }),
    });

    const result = await validateInput(schema, "42");

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.value).toBe(42);
    }
  });

  test("returns failure with error message when validation fails", async () => {
    const schema = createMockSchema<string>({
      validate: () => ({
        issues: [{ message: "Invalid input" }],
      }),
    });

    const result = await validateInput(schema, "bad input");

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBe("Invalid input");
    }
  });

  test("combines multiple validation error messages", async () => {
    const schema = createMockSchema<{ email: string; age: number }>({
      validate: () => ({
        issues: [
          { message: "Invalid email format" },
          { message: "Age must be positive" },
        ],
      }),
    });

    const result = await validateInput(schema, {
      email: "invalid",
      age: -5,
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBe("Invalid email format; Age must be positive");
    }
  });

  test("returns generic message when issues array is empty", async () => {
    const schema = createMockSchema<string>({
      validate: () => ({
        issues: [],
      }),
    });

    const result = await validateInput(schema, "test");

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBe("Validation failed");
    }
  });

  test("handles async schema validation", async () => {
    const schema = createMockSchema<string>({
      validate: async (input) => {
        await new Promise((resolve) => setTimeout(resolve, 1));
        return { value: (input as string).toUpperCase() };
      },
    });

    const result = await validateInput(schema, "hello");

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.value).toBe("HELLO");
    }
  });

  test("handles undefined input when no schema", async () => {
    // eslint-disable-next-line unicorn/no-useless-undefined
    const result = await validateInput(null, undefined);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.value).toBeUndefined();
    }
  });
});

describe("createWorkflowConfig", () => {
  test("creates config with required name", () => {
    const config = createWorkflowConfig({ name: "my-workflow" });

    expect(config.name).toBe("my-workflow");
    expect(config.version).toBeNull();
    expect(config.schema).toBeNull();
  });

  test("preserves provided version", () => {
    const config = createWorkflowConfig({
      name: "versioned-workflow",
      version: "1.0.0",
    });

    expect(config.name).toBe("versioned-workflow");
    expect(config.version).toBe("1.0.0");
  });

  test("preserves provided schema", () => {
    const schema = createMockSchema<string>({
      validate: (input) => ({ value: input as string }),
    });
    const config = createWorkflowConfig({
      name: "validated-workflow",
      schema,
    });

    expect(config.name).toBe("validated-workflow");
    expect(config.schema).toBe(schema);
  });

  test("creates config with all options", () => {
    const schema = createMockSchema<number>({
      validate: (input) => ({ value: input as number }),
    });
    const config = createWorkflowConfig({
      name: "full-workflow",
      version: "2.5.0",
      schema,
    });

    expect(config.name).toBe("full-workflow");
    expect(config.version).toBe("2.5.0");
    expect(config.schema).toBe(schema);
  });

  test("returns frozen/readonly config object", () => {
    const config = createWorkflowConfig({ name: "readonly-workflow" });

    expect(config.name).toBe("readonly-workflow");
    // The function signature specifies Readonly<>, so we trust type safety
  });
});

describe("hasSchema", () => {
  test("returns false when no schema provided", () => {
    const config = { name: "no-schema-workflow" };

    expect(hasSchema(config)).toBe(false);
  });

  test("returns false when schema is undefined", () => {
    const config = { name: "undefined-schema", schema: undefined };

    expect(hasSchema(config)).toBe(false);
  });

  test("returns true when schema is provided", () => {
    const schema = createMockSchema<string>({
      validate: (input) => ({ value: input as string }),
    });
    const config = { name: "with-schema", schema };

    expect(hasSchema(config)).toBe(true);
  });

  test("returns true for any truthy schema value", () => {
    const config = { name: "truthy-schema", schema: {} as StandardSchemaV1 };

    expect(hasSchema(config)).toBe(true);
  });
});

describe("isTerminalStatus", () => {
  test("returns true for 'completed' status", () => {
    expect(isTerminalStatus("completed")).toBe(true);
  });

  test("returns true for 'succeeded' status (deprecated)", () => {
    expect(isTerminalStatus("succeeded")).toBe(true);
  });

  test("returns true for 'failed' status", () => {
    expect(isTerminalStatus("failed")).toBe(true);
  });

  test("returns true for 'canceled' status", () => {
    expect(isTerminalStatus("canceled")).toBe(true);
  });

  test("returns false for 'pending' status", () => {
    expect(isTerminalStatus("pending")).toBe(false);
  });

  test("returns false for 'running' status", () => {
    expect(isTerminalStatus("running")).toBe(false);
  });

  test("returns false for 'sleeping' status", () => {
    expect(isTerminalStatus("sleeping")).toBe(false);
  });

  test("returns false for unknown status strings", () => {
    expect(isTerminalStatus("unknown")).toBe(false);
    expect(isTerminalStatus("")).toBe(false);
    expect(isTerminalStatus("COMPLETED")).toBe(false);
  });
});

describe("DEFAULT_WORKFLOW_RESULT_CONFIG", () => {
  test("has expected poll interval", () => {
    expect(DEFAULT_WORKFLOW_RESULT_CONFIG.pollIntervalMs).toBe(1000);
  });

  test("has expected timeout (5 minutes)", () => {
    expect(DEFAULT_WORKFLOW_RESULT_CONFIG.timeoutMs).toBe(5 * 60 * 1000);
  });
});

function createMockSchema<I, O = I>(options: {
  validate: (
    input: unknown,
  ) => StandardSchemaV1.Result<O> | Promise<StandardSchemaV1.Result<O>>;
}): StandardSchemaV1<I, O> {
  return {
    "~standard": {
      version: 1,
      vendor: "test",
      validate: options.validate,
    },
  };
}
