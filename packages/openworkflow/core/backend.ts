export const DEFAULT_NAMESPACE_ID = "default";

/**
 * Backend is the interface for backend providers to implement.
 */
export interface Backend {
  // Workflow Runs
  createWorkflowRun(
    params: Readonly<CreateWorkflowRunParams>,
  ): Promise<WorkflowRun>;
  getWorkflowRun(
    params: Readonly<GetWorkflowRunParams>,
  ): Promise<WorkflowRun | null>;
  listWorkflowRuns(
    params: Readonly<ListWorkflowRunsParams>,
  ): Promise<PaginatedResponse<WorkflowRun>>;
  claimWorkflowRun(
    params: Readonly<ClaimWorkflowRunParams>,
  ): Promise<WorkflowRun | null>;
  extendWorkflowRunLease(
    params: Readonly<ExtendWorkflowRunLeaseParams>,
  ): Promise<WorkflowRun>;
  sleepWorkflowRun(
    params: Readonly<SleepWorkflowRunParams>,
  ): Promise<WorkflowRun>;
  completeWorkflowRun(
    params: Readonly<CompleteWorkflowRunParams>,
  ): Promise<WorkflowRun>;
  failWorkflowRun(
    params: Readonly<FailWorkflowRunParams>,
  ): Promise<WorkflowRun>;
  cancelWorkflowRun(
    params: Readonly<CancelWorkflowRunParams>,
  ): Promise<WorkflowRun>;

  // Step Attempts
  createStepAttempt(
    params: Readonly<CreateStepAttemptParams>,
  ): Promise<StepAttempt>;
  getStepAttempt(
    params: Readonly<GetStepAttemptParams>,
  ): Promise<StepAttempt | null>;
  listStepAttempts(
    params: Readonly<ListStepAttemptsParams>,
  ): Promise<PaginatedResponse<StepAttempt>>;
  completeStepAttempt(
    params: Readonly<CompleteStepAttemptParams>,
  ): Promise<StepAttempt>;
  failStepAttempt(
    params: Readonly<FailStepAttemptParams>,
  ): Promise<StepAttempt>;
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
  | "succeeded" // deprecated in favor of 'completed'
  | "completed"
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

export type StepAttemptStatus =
  | "running"
  | "succeeded" // deprecated in favor of 'completed'
  | "completed"
  | "failed";

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
