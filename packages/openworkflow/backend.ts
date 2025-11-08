/**
 * Backend is the interface for backend providers to implement.
 */
export interface Backend {
  // Workflow Runs
  createWorkflowRun(params: CreateWorkflowRunParams): Promise<WorkflowRun>;
  getWorkflowRun(params: GetWorkflowRunParams): Promise<WorkflowRun | null>;
  claimWorkflowRun(params: ClaimWorkflowRunParams): Promise<WorkflowRun | null>;
  heartbeatWorkflowRun(params: HeartbeatWorkflowRunParams): Promise<void>;
  markWorkflowRunSucceeded(
    params: MarkWorkflowRunSucceededParams,
  ): Promise<void>;
  markWorkflowRunFailed(params: MarkWorkflowRunFailedParams): Promise<void>;

  // Step Attempts
  listStepAttempts(params: ListStepAttemptsParams): Promise<StepAttempt[]>;
  createStepAttempt(params: CreateStepAttemptParams): Promise<StepAttempt>;
  getStepAttempt(params: GetStepAttemptParams): Promise<StepAttempt | null>;
  markStepAttemptSucceeded(
    params: MarkStepAttemptSucceededParams,
  ): Promise<void>;
  markStepAttemptFailed(params: MarkStepAttemptFailedParams): Promise<void>;
}

export interface CreateWorkflowRunParams {
  namespaceId: string;
  workflowName: string;
  version: string | null;
  idempotencyKey: string | null;
  config: JsonValue;
  context: JsonValue | null;
  input: JsonValue | null;
  availableAt: Date | null; // null = immediately
}

export interface GetWorkflowRunParams {
  namespaceId: string;
  workflowRunId: string;
}

export interface ClaimWorkflowRunParams {
  namespaceId: string;
  workerId: string;
  leaseDurationMs: number;
}

export interface HeartbeatWorkflowRunParams {
  namespaceId: string;
  workflowRunId: string;
  workerId: string;
  leaseDurationMs: number;
}

export interface MarkWorkflowRunSucceededParams {
  namespaceId: string;
  workflowRunId: string;
  workerId: string;
  output: JsonValue | null;
}

export interface MarkWorkflowRunFailedParams {
  namespaceId: string;
  workflowRunId: string;
  workerId: string;
  error: JsonValue;
}

export interface ListStepAttemptsParams {
  namespaceId: string;
  workflowRunId: string;
}

export interface CreateStepAttemptParams {
  namespaceId: string;
  workflowRunId: string;
  workerId: string;
  stepName: string;
  kind: StepKind;
  config: JsonValue;
  context: JsonValue | null;
}

export interface GetStepAttemptParams {
  namespaceId: string;
  stepAttemptId: string;
}

export interface MarkStepAttemptSucceededParams {
  namespaceId: string;
  workflowRunId: string;
  stepAttemptId: string;
  workerId: string;
  output: JsonValue | null;
}

export interface MarkStepAttemptFailedParams {
  namespaceId: string;
  workflowRunId: string;
  stepAttemptId: string;
  workerId: string;
  error: JsonValue;
}

// -----------------------------------------------------------------------------

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue =
  | JsonPrimitive
  | JsonValue[]
  | { [key: string]: JsonValue };

export type WorkflowRunStatus = "pending" | "running" | "succeeded" | "failed";

/**
 * WorkflowRun represents a single execution instance of a workflow.
 */
export interface WorkflowRun {
  namespaceId: string;
  id: string;
  workflowName: string;
  version: string | null;
  status: WorkflowRunStatus;
  idempotencyKey: string | null;
  config: JsonValue;
  context: JsonValue | null;
  input: JsonValue | null;
  output: JsonValue | null;
  error: JsonValue | null;
  attempts: number;
  parentStepAttemptNamespaceId: string | null;
  parentStepAttemptId: string | null;
  workerId: string | null;
  availableAt: Date | null;
  startedAt: Date | null;
  finishedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export type StepKind = "function";

export type StepAttemptStatus = "running" | "succeeded" | "failed";

/**
 * StepAttempt represents a single attempt of a step within a workflow.
 */
export interface StepAttempt {
  namespaceId: string;
  id: string;
  workflowRunId: string;
  stepName: string;
  kind: StepKind;
  status: StepAttemptStatus;
  config: JsonValue;
  context: JsonValue | null;
  output: JsonValue | null;
  error: JsonValue | null;
  childWorkflowRunNamespaceId: string | null;
  childWorkflowRunId: string | null;
  startedAt: Date | null;
  finishedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

// -----------------------------------------------------------------------------

export const DEFAULT_RETRY_POLICY = {
  initialIntervalMs: 1000, // 1s
  backoffCoefficient: 2,
  maximumIntervalMs: 100 * 1000, // 100s
  maximumAttempts: Infinity, // unlimited
} as const;

export type RetryPolicy = typeof DEFAULT_RETRY_POLICY;

/**
 * Calculate the next retry delay using exponential backoff.
 */
export function calculateRetryDelayMs(attemptNumber: number): number {
  const { initialIntervalMs, backoffCoefficient, maximumIntervalMs } =
    DEFAULT_RETRY_POLICY;

  const backoffMs =
    initialIntervalMs * Math.pow(backoffCoefficient, attemptNumber - 1);

  return Math.min(backoffMs, maximumIntervalMs);
}

/**
 * Check if an operation should be retried based on the retry policy.
 */
export function shouldRetry(
  retryPolicy: RetryPolicy,
  attemptNumber: number,
): boolean {
  return attemptNumber < retryPolicy.maximumAttempts;
}
