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
