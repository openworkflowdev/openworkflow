import type { DurationString } from "./duration.js";
import type { RetryPolicy, WorkflowSpec } from "./workflow-definition.js";
import type { WorkflowRun } from "./workflow-run.js";

/**
 * Config for an individual step defined with `step.run()`.
 */
export interface StepFunctionConfig {
  /**
   * The name of the step.
   */
  name: string;
  /**
   * Optional retry policy override for this step.
   */
  retryPolicy?: Partial<RetryPolicy>;
}

/**
 * The step definition (defined by the user) that executes user code. Can
 * return undefined (e.g., when using `return;`) which will be converted to
 * null.
 */
export type StepFunction<Output> = () =>
  | Promise<Output | undefined>
  | Output
  | undefined;

/**
 * Options for an individual step defined with `step.runWorkflow()`.
 */
export interface StepRunWorkflowOptions {
  /**
   * Optional durable step name. Defaults to the target workflow name.
   */
  name?: string;
  /**
   * Maximum time to wait for the child workflow to complete.
   */
  timeout?: number | string | Date;
}

/**
 * Represents the API for defining steps within a workflow. Used within a
 * workflow handler to define steps by calling `step.run()`, `step.sleep()`,
 * and `step.runWorkflow()`.
 */
export interface StepApi {
  run: <Output>(
    config: Readonly<StepFunctionConfig>,
    fn: StepFunction<Output>,
  ) => Promise<Output>;
  runWorkflow: <Input, Output, RunInput = Input>(
    spec: WorkflowSpec<Input, Output, RunInput>,
    input?: RunInput,
    options?: Readonly<StepRunWorkflowOptions>,
  ) => Promise<Output>;
  sleep: (name: string, duration: DurationString) => Promise<void>;
}

/**
 * Read-only workflow run metadata exposed to workflow functions.
 */
export type WorkflowRunMetadata = Pick<
  WorkflowRun,
  "id" | "workflowName" | "createdAt" | "startedAt"
>;

/**
 * Params passed to a workflow function for the user to use when defining
 * steps.
 */
export interface WorkflowFunctionParams<Input> {
  input: Input;
  step: StepApi;
  version: string | null;
  run: WorkflowRunMetadata;
}

/**
 * The workflow definition's function (defined by the user) that the user uses
 * to define the workflow's steps.
 */
export type WorkflowFunction<Input, Output> = (
  params: Readonly<WorkflowFunctionParams<Input>>,
) => Promise<Output> | Output;
