import type { StandardSchemaV1 } from "./core/schema.js";
import { WorkflowFunction } from "./execution.js";

/**
 * A workflow spec.
 */
export interface WorkflowSpec<Input, Output, RawInput> {
  /** The name of the workflow. */
  readonly name: string;
  /** The version of the workflow. */
  readonly version?: string;
  /** The schema used to validate inputs. */
  readonly schema?: StandardSchemaV1<RawInput, Input>;
  /** Phantom type carrier - won't exist at runtime. */
  readonly __types?: {
    output: Output;
  };
}

/**
 * Define a workflow spec.
 * @param spec - The workflow spec
 * @returns The workflow spec
 */
export function defineWorkflowSpec<Input, Output = unknown, RawInput = Input>(
  spec: WorkflowSpec<Input, Output, RawInput>,
): WorkflowSpec<Input, Output, RawInput> {
  return spec;
}

/**
 * Define a workflow spec.
 * @param spec - The workflow spec
 * @returns The workflow spec
 * @deprecated use `defineWorkflowSpec` instead
 */
export const declareWorkflow = defineWorkflowSpec;

/**
 * A workflow spec and implementation.
 */
export interface Workflow<Input, Output, RawInput> {
  /** The workflow spec. */
  readonly spec: WorkflowSpec<Input, Output, RawInput>;
  /** The workflow implementation function. */
  readonly fn: WorkflowFunction<Input, Output>;
}

/**
 * Define a workflow.
 * @param spec - The workflow spec
 * @param fn - The workflow implementation function
 * @returns The workflow
 */
// Handles:
// - `defineWorkflow(spec, impl)` (0 generics)
// - `defineWorkflow<Input, Output>(spec, impl)` (2 generics)
export function defineWorkflow<Input, Output, RawInput = Input>(
  spec: WorkflowSpec<Input, Output, RawInput>,
  fn: WorkflowFunction<Input, Output>,
): Workflow<Input, Output, RawInput>;

/**
 * Define a workflow.
 * @param spec - The workflow spec
 * @param fn - The workflow implementation function
 * @returns The workflow
 */
// Handles:
// - `defineWorkflow<Input>(spec, impl)` (1 generic)
export function defineWorkflow<
  Input,
  WorkflowFn extends WorkflowFunction<Input, unknown> = WorkflowFunction<
    Input,
    unknown
  >,
  RawInput = Input,
>(
  spec: WorkflowSpec<Input, Awaited<ReturnType<WorkflowFn>>, RawInput>,
  fn: WorkflowFn,
): Workflow<Input, Awaited<ReturnType<WorkflowFn>>, RawInput>;

/**
 * Define a workflow.
 * @internal
 * @param spec - The workflow spec
 * @param fn - The workflow implementation function
 * @returns The workflow
 */
export function defineWorkflow<Input, Output, RawInput>(
  spec: WorkflowSpec<Input, Output, RawInput>,
  fn: WorkflowFunction<Input, Output>,
): Workflow<Input, Output, RawInput> {
  return {
    spec,
    fn,
  };
}

/**
 * Type guard to check if a value is a Workflow object.
 * @param value - The value to check
 * @returns True if the value is a Workflow
 */
export function isWorkflow(value: unknown) {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const maybeWorkflow = value as Record<string, unknown>;
  if (!("spec" in maybeWorkflow) || !("fn" in maybeWorkflow)) {
    return false;
  }

  const { spec, fn } = maybeWorkflow;
  return (
    typeof spec === "object" &&
    spec !== null &&
    "name" in spec &&
    typeof spec.name === "string" &&
    typeof fn === "function"
  );
}
