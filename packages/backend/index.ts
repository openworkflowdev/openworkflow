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

  // Step Runs
  listStepRuns(params: ListStepRunsParams): Promise<StepRun[]>;
  createStepRun(params: CreateStepRunParams): Promise<StepRun>;
  getStepRun(params: GetStepRunParams): Promise<StepRun | null>;
  markStepRunSucceeded(params: MarkStepRunSucceededParams): Promise<void>;
  markStepRunFailed(params: MarkStepRunFailedParams): Promise<void>;
}

export interface CreateWorkflowRunParams {
  namespaceId: string;
  workflowName: string;
  version: string | null;
  idempotencyKey: string | null;
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

export interface ListStepRunsParams {
  namespaceId: string;
  workflowRunId: string;
}

export interface CreateStepRunParams {
  namespaceId: string;
  workflowRunId: string;
  workerId: string;
  stepName: string;
  kind: StepKind;
}

export interface GetStepRunParams {
  namespaceId: string;
  stepRunId: string;
}

export interface MarkStepRunSucceededParams {
  namespaceId: string;
  workflowRunId: string;
  stepRunId: string;
  workerId: string;
  output: JsonValue | null;
}

export interface MarkStepRunFailedParams {
  namespaceId: string;
  workflowRunId: string;
  stepRunId: string;
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
  context: JsonValue | null;
  input: JsonValue | null;
  output: JsonValue | null;
  error: JsonValue | null;
  attempts: number;
  parentStepRunNamespaceId: string | null;
  parentStepRunId: string | null;
  workerId: string | null;
  availableAt: Date | null;
  startedAt: Date | null;
  finishedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export type StepKind = "activity";

export type StepRunStatus = "running" | "succeeded" | "failed";

/**
 * StepRun represents a single execution instance of a step within a workflow.
 */
export interface StepRun {
  namespaceId: string;
  id: string;
  workflowRunId: string;
  stepName: string;
  kind: StepKind;
  status: StepRunStatus;
  output: JsonValue | null;
  error: JsonValue | null;
  attempts: number;
  childWorkflowRunNamespaceId: string | null;
  childWorkflowRunId: string | null;
  startedAt: Date | null;
  finishedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}
