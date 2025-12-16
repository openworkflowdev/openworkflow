import { defineWorkflow, defineWorkflowSpec } from "./workflow.js";
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
