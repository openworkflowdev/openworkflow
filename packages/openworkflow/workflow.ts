import { type BackoffPolicy, computeBackoffDelayMs } from "./core/backoff.js";
import type { SerializedError } from "./core/error.js";
import type { StandardSchemaV1 } from "./core/schema.js";
import { WorkflowFunction } from "./execution.js";

/**
 * Resolver input for workflow concurrency configuration.
 */
export interface WorkflowConcurrencyResolverParams<Input> {
  input: Input;
}

/**
 * Workflow-level concurrency configuration.
 */
export interface WorkflowConcurrency<Input> {
  /**
   * Bucket key used to scope concurrency for this run.
   */
  readonly key:
    | string
    | ((params: Readonly<WorkflowConcurrencyResolverParams<Input>>) => string);
  /**
   * Maximum active leased runs allowed in the bucket.
   */
  readonly limit:
    | number
    | ((params: Readonly<WorkflowConcurrencyResolverParams<Input>>) => number);
}

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
  /** The retry policy for the workflow. */
  readonly retryPolicy?: Partial<RetryPolicy>;
  /** Optional workflow-level concurrency configuration. */
  readonly concurrency?: WorkflowConcurrency<Input>;
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

/**
 * A workflow retry policy.
 */
export type RetryPolicy = BackoffPolicy & Readonly<{ maximumAttempts: number }>;

export const DEFAULT_WORKFLOW_RETRY_POLICY: RetryPolicy = {
  initialInterval: "1s",
  backoffCoefficient: 2,
  maximumInterval: "100s",
  maximumAttempts: 1,
};

/**
 * Computed update fields when a running workflow fails.
 */
export interface FailedWorkflowRunUpdate {
  readonly status: "pending" | "failed";
  readonly availableAt: Date | null;
  readonly finishedAt: Date | null;
  readonly error: SerializedError;
}

/**
 * Compute how a workflow run should be updated after a failure.
 * @param retryPolicy - Retry policy used for scheduling
 * @param attempts - Current workflow attempt count
 * @param deadlineAt - Optional workflow deadline
 * @param error - Workflow failure error
 * @param now - Current time used to compute retry schedule
 * @returns Next persisted run state for the failure path
 */
export function computeFailedWorkflowRunUpdate(
  retryPolicy: Readonly<RetryPolicy>,
  attempts: number,
  deadlineAt: Readonly<Date> | null,
  error: Readonly<SerializedError>,
  now: Readonly<Date>,
): FailedWorkflowRunUpdate {
  if (
    retryPolicy.maximumAttempts > 0 && // 0 = unlimited attempts
    attempts >= retryPolicy.maximumAttempts
  ) {
    return {
      status: "failed",
      availableAt: null,
      finishedAt: now,
      error,
    };
  }

  const retryDelayMs = computeBackoffDelayMs(retryPolicy, attempts);
  const nextRetryAt = new Date(now.getTime() + retryDelayMs);

  if (deadlineAt && nextRetryAt >= deadlineAt) {
    return {
      status: "failed",
      availableAt: null,
      finishedAt: now,
      error,
    };
  }

  return {
    status: "pending",
    availableAt: nextRetryAt,
    finishedAt: null,
    error,
  };
}
