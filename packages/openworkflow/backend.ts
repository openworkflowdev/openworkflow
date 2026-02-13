import type { SerializedError } from "./core/error.js";
import { JsonValue } from "./core/json.js";
import type { StepAttempt, StepAttemptContext, StepKind } from "./core/step.js";
import type { WorkflowRun } from "./core/workflow.js";
import type { RetryPolicy } from "./workflow.js";

export const DEFAULT_NAMESPACE_ID = "default";
export const DEFAULT_RUN_IDEMPOTENCY_PERIOD_MS = 24 * 60 * 60 * 1000;

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
  rescheduleWorkflowRunAfterFailedStepAttempt(
    params: Readonly<RescheduleWorkflowRunAfterFailedStepAttemptParams>,
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

  // Lifecycle
  stop(): Promise<void>;
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
  error: SerializedError;
  retryPolicy: RetryPolicy;
}

export interface RescheduleWorkflowRunAfterFailedStepAttemptParams {
  workflowRunId: string;
  workerId: string;
  error: SerializedError;
  availableAt: Date;
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
  error: SerializedError;
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
