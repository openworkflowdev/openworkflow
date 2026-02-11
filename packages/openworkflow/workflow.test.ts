import {
  computeFailedWorkflowRunUpdate,
  defineWorkflow,
  defineWorkflowSpec,
  isWorkflow,
  RetryPolicy,
} from "./workflow.js";
import { describe, expect, test } from "vitest";

describe("defineWorkflowSpec", () => {
  test("returns spec (passthrough)", () => {
    const spec = { name: "test-workflow" };
    const definedSpec = defineWorkflowSpec(spec);

    expect(definedSpec).toStrictEqual(spec);
  });
});

describe("defineWorkflow", () => {
  test("returns workflow with spec and fn", () => {
    // eslint-disable-next-line unicorn/consistent-function-scoping
    function fn() {
      return { result: "done" };
    }

    const spec = { name: "test-workflow" };
    const workflow = defineWorkflow(spec, fn);

    expect(workflow).toStrictEqual({
      spec,
      fn,
    });
  });
});

describe("isWorkflow", () => {
  test("returns true for valid workflow objects", () => {
    const workflow = defineWorkflow({ name: "test" }, () => "done");
    expect(isWorkflow(workflow)).toBe(true);
  });

  test("returns false for null", () => {
    expect(isWorkflow(null)).toBe(false);
  });

  test("returns false for undefined", () => {
    // eslint-disable-next-line unicorn/no-useless-undefined
    expect(isWorkflow(undefined)).toBe(false);
  });

  test("returns false for primitives", () => {
    expect(isWorkflow("string")).toBe(false);
    expect(isWorkflow(123)).toBe(false);
    expect(isWorkflow(true)).toBe(false);
  });

  test("returns false for objects without spec", () => {
    expect(isWorkflow({ fn: () => "result" })).toBe(false);
  });

  test("returns false for objects without fn", () => {
    expect(isWorkflow({ spec: { name: "test" } })).toBe(false);
  });

  test("returns false for objects with invalid spec", () => {
    expect(isWorkflow({ spec: null, fn: () => "result" })).toBe(false);
    expect(isWorkflow({ spec: "invalid", fn: () => "result" })).toBe(false);
  });

  test("returns false for objects with invalid fn", () => {
    expect(isWorkflow({ spec: { name: "test" }, fn: "not-a-function" })).toBe(
      false,
    );
  });
});

// --- type checks below -------------------------------------------------------
// they're unused but useful to ensure that the types work as expected for both
// defineWorkflowSpec and defineWorkflow

const inferredTypesSpec = defineWorkflowSpec({
  name: "inferred-types",
});
defineWorkflow(inferredTypesSpec, async ({ step }) => {
  await step.run({ name: "step-1" }, () => {
    return "success";
  });

  return { result: "done" };
});

const explicitInputTypeSpec = defineWorkflowSpec<{ name: string }>({
  name: "explicit-input-type",
});
defineWorkflow(explicitInputTypeSpec, async ({ step }) => {
  await step.run({ name: "step-1" }, () => {
    return "success";
  });

  return { result: "done" };
});

const explicitInputAndOutputTypesSpec = defineWorkflowSpec<
  { name: string },
  { result: string }
>({
  name: "explicit-input-and-output-types",
});
defineWorkflow(explicitInputAndOutputTypesSpec, async ({ step }) => {
  await step.run({ name: "step-1" }, () => {
    return "success";
  });

  return { result: "done" };
});

describe("computeFailedWorkflowRunUpdate", () => {
  const policy: RetryPolicy = {
    initialInterval: "1s",
    backoffCoefficient: 2,
    maximumInterval: "10s",
    maximumAttempts: 3,
  };

  test("reschedules with backoff when retry is allowed", () => {
    const now = new Date("2026-01-01T00:00:00.000Z");

    const result = computeFailedWorkflowRunUpdate(
      policy,
      1,
      null,
      { message: "boom" },
      now,
    );

    expect(result.status).toBe("pending");
    expect(result.availableAt?.toISOString()).toBe("2026-01-01T00:00:01.000Z");
    expect(result.finishedAt).toBeNull();
    expect(result.error).toEqual({ message: "boom" });
  });

  test("fails permanently when next retry would exceed deadline", () => {
    const now = new Date("2026-01-01T00:00:00.000Z");

    const result = computeFailedWorkflowRunUpdate(
      policy,
      1,
      new Date("2026-01-01T00:00:01.000Z"),
      { message: "boom" },
      now,
    );

    expect(result.status).toBe("failed");
    expect(result.availableAt).toBeNull();
    expect(result.finishedAt).toBe(now);
    expect(result.error).toEqual({ message: "boom" });
  });

  test("fails when maximum attempts has been reached", () => {
    const now = new Date("2026-01-01T00:00:00.000Z");

    const result = computeFailedWorkflowRunUpdate(
      policy,
      3,
      null,
      { message: "boom" },
      now,
    );

    expect(result.status).toBe("failed");
    expect(result.availableAt).toBeNull();
    expect(result.finishedAt).toBe(now);
    expect(result.error).toEqual({ message: "boom" });
  });
});
