import type { StandardSchemaV1 } from "./core/schema.js";
import { WorkflowFunction } from "./execution.js";

interface WorkflowSpec<Input, Output, RawInput> {
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
 * A workflow spec and implementation.
 */
interface Workflow<Input, Output, RawInput> {
  /** The workflow spec. */
  readonly spec: WorkflowSpec<Input, Output, RawInput>;
  /** The workflow implementation function. */
  readonly impl: WorkflowFunction<Input, Output>;
}

/**
 * Define a workflow.
 * @param spec - The workflow spec
 * @param impl - The workflow implementation function
 * @returns The workflow definition
 */
// Handles:
// - `defineWorkflow(spec, impl)` (0 generics)
// - `defineWorkflow<Input, Output>(spec, impl)` (2 generics)
export function defineWorkflow<Input, Output, RawInput = Input>(
  spec: WorkflowSpec<Input, Output, RawInput>,
  impl: WorkflowFunction<Input, Output>,
): Workflow<Input, Output, RawInput>;

/**
 * Define a workflow.
 * @param spec - The workflow spec
 * @param impl - The workflow implementation function
 * @returns The workflow definition
 */
// Handles:
// - `defineWorkflow<Input>(spec, impl)` (1 generic)
export function defineWorkflow<
  Input,
  Impl extends WorkflowFunction<Input, unknown> = WorkflowFunction<
    Input,
    unknown
  >,
  RawInput = Input,
>(
  spec: WorkflowSpec<Input, Awaited<ReturnType<Impl>>, RawInput>,
  impl: Impl,
): Workflow<Input, Awaited<ReturnType<Impl>>, RawInput>;

/**
 * Define a workflow.
 * @internal
 * @param spec - The workflow spec
 * @param impl - The workflow implementation function
 * @returns The workflow definition
 */
export function defineWorkflow<Input, Output, RawInput>(
  spec: WorkflowSpec<Input, Output, RawInput>,
  impl: WorkflowFunction<Input, Output>,
): Workflow<Input, Output, RawInput> {
  return {
    spec,
    impl,
  };
}
