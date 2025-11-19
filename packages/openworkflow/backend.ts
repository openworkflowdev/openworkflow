export const DEFAULT_NAMESPACE_ID = "default";

/**
 * Backend is the interface for backend providers to implement.
 */
export interface Backend {
  // Workflow Runs
  createWorkflowRun(params: CreateWorkflowRunParams): Promise<WorkflowRun>;
  getWorkflowRun(params: GetWorkflowRunParams): Promise<WorkflowRun | null>;
  listWorkflowRuns(
    params: ListWorkflowRunsParams,
  ): Promise<PaginatedResponse<WorkflowRun>>;
  claimWorkflowRun(params: ClaimWorkflowRunParams): Promise<WorkflowRun | null>;
  extendWorkflowRunLease(
    params: ExtendWorkflowRunLeaseParams,
  ): Promise<WorkflowRun>;
  sleepWorkflowRun(params: SleepWorkflowRunParams): Promise<WorkflowRun>;
  completeWorkflowRun(params: CompleteWorkflowRunParams): Promise<WorkflowRun>;
  failWorkflowRun(params: FailWorkflowRunParams): Promise<WorkflowRun>;
  cancelWorkflowRun(params: CancelWorkflowRunParams): Promise<WorkflowRun>;

  // Step Attempts
  createStepAttempt(params: CreateStepAttemptParams): Promise<StepAttempt>;
  getStepAttempt(params: GetStepAttemptParams): Promise<StepAttempt | null>;
  listStepAttempts(
    params: ListStepAttemptsParams,
  ): Promise<PaginatedResponse<StepAttempt>>;
  completeStepAttempt(params: CompleteStepAttemptParams): Promise<StepAttempt>;
  failStepAttempt(params: FailStepAttemptParams): Promise<StepAttempt>;
}

export interface CreateWorkflowRunParams {
  workflowName: string;
  version: string | null;
  idempotencyKey: string | null;
  config: JsonValue;
  context: JsonValue | null;
  input: JsonValue | null;
  availableAt: Date | null; // null = immediately
  deadlineAt: Date | null; // null = no deadline
}

export interface GetWorkflowRunParams {
  workflowRunId: string;
}

export type ListWorkflowRunsParams = PaginationOptions;

export interface ClaimWorkflowRunParams {
  workerId: string;
  leaseDurationMs: number;
}

export interface ExtendWorkflowRunLeaseParams {
  workflowRunId: string;
  workerId: string;
  leaseDurationMs: number;
}

export interface SleepWorkflowRunParams {
  workflowRunId: string;
  workerId: string;
  availableAt: Date;
}

export interface CompleteWorkflowRunParams {
  workflowRunId: string;
  workerId: string;
  output: JsonValue | null;
}

export interface FailWorkflowRunParams {
  workflowRunId: string;
  workerId: string;
  error: JsonValue;
}

export interface CancelWorkflowRunParams {
  workflowRunId: string;
}

export interface CreateStepAttemptParams {
  workflowRunId: string;
  workerId: string;
  stepName: string;
  kind: StepKind;
  config: JsonValue;
  context: StepAttemptContext | null;
}

export interface GetStepAttemptParams {
  stepAttemptId: string;
}

export interface ListStepAttemptsParams extends PaginationOptions {
  workflowRunId: string;
}

export interface CompleteStepAttemptParams {
  workflowRunId: string;
  stepAttemptId: string;
  workerId: string;
  output: JsonValue | null;
}

export interface FailStepAttemptParams {
  workflowRunId: string;
  stepAttemptId: string;
  workerId: string;
  error: JsonValue;
}

export interface PaginationOptions {
  limit?: number;
  after?: string;
  before?: string;
}

export interface PaginatedResponse<T> {
  data: T[];
  pagination: {
    next: string | null;
    prev: string | null;
  };
}

// -----------------------------------------------------------------------------

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue =
  | JsonPrimitive
  | JsonValue[]
  | { [key: string]: JsonValue };

export type WorkflowRunStatus =
  | "pending"
  | "running"
  | "sleeping"
  | "succeeded"
  | "failed"
  | "canceled";

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
  config: JsonValue; // user-defined config
  context: JsonValue | null; // runtime execution metadata
  input: JsonValue | null;
  output: JsonValue | null;
  error: JsonValue | null;
  attempts: number;
  parentStepAttemptNamespaceId: string | null;
  parentStepAttemptId: string | null;
  workerId: string | null;
  availableAt: Date | null;
  deadlineAt: Date | null;
  startedAt: Date | null;
  finishedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export type StepKind = "function" | "sleep";

export type StepAttemptStatus = "running" | "succeeded" | "failed";

export interface StepAttemptContext {
  kind: "sleep";
  resumeAt: string;
}

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
  config: JsonValue; // user-defined config
  context: StepAttemptContext | null; // runtime execution metadata
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
