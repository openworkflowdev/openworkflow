import type { SerializedError } from "./error.js";
import { JsonValue } from "./json.js";
import type { StandardSchemaV1 } from "./standard-schema.js";

/**
 * Status of a workflow run through its lifecycle.
 */
export type WorkflowRunStatus =
  | "pending"
  | "running"
  | "sleeping" // deprecated in favor of staying 'running'
  | "succeeded" // deprecated in favor of 'completed'
  | "completed"
  | "failed"
  | "canceled";

/**
 * Determine whether a workflow run status is terminal (no further transitions).
 * @param status - Workflow run status
 * @returns True when status is terminal
 */
export function isTerminalStatus(status: WorkflowRunStatus): boolean {
  return (
    status === "completed" ||
    status === "succeeded" ||
    status === "failed" ||
    status === "canceled"
  );
}

/**
 * Resolve the outcome when a cancelWorkflowRun UPDATE affected no rows.
 * Returns the existing run if already canceled (idempotent), otherwise throws
 * an error describing why cancellation is impossible.
 * @param workflowRunId - ID of the workflow run (used in error messages)
 * @param existing - Current workflow run, or null if not found
 * @returns The existing workflow run when already canceled
 * @throws {Error} If the run does not exist, is in a non-canceled terminal
 * state, or cannot be canceled for an unknown reason
 */
export function resolveCancelWorkflowRunConflict(
  workflowRunId: string,
  existing: Readonly<WorkflowRun> | null,
): WorkflowRun {
  if (!existing) {
    // eslint-disable-next-line functional/no-throw-statements
    throw new Error(`Workflow run ${workflowRunId} does not exist`);
  }

  if (existing.status === "canceled") {
    return existing;
  }

  // 'succeeded' status is deprecated
  if (["succeeded", "completed", "failed"].includes(existing.status)) {
    // eslint-disable-next-line functional/no-throw-statements
    throw new Error(
      `Cannot cancel workflow run ${workflowRunId} with status ${existing.status}`,
    );
  }

  // eslint-disable-next-line functional/no-throw-statements
  throw new Error("Failed to cancel workflow run");
}

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
  error: SerializedError | null;
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

/**
 * Infers the input type from a Standard Schema.
 */
export type SchemaInput<TSchema, Fallback> = TSchema extends StandardSchemaV1
  ? StandardSchemaV1.InferInput<TSchema>
  : Fallback;

/**
 * Infers the output type from a Standard Schema.
 */
export type SchemaOutput<TSchema, Fallback> = TSchema extends StandardSchemaV1
  ? StandardSchemaV1.InferOutput<TSchema>
  : Fallback;

/**
 * Result of input validation - either success with a value or failure with an
 * error message.
 */
export type ValidationResult<T> =
  | { success: true; value: T }
  | { success: false; error: string };

/**
 * Validate input against a Standard Schema. Pure async function that validates
 * input and returns a ValidationResult.
 * @param schema - The Standard Schema to validate against (or null/undefined
 * for no validation)
 * @param input - The input value to validate
 * @returns A ValidationResult containing either the validated value or an error
 * message
 */
export async function validateInput<RunInput, Input>(
  schema: StandardSchemaV1<RunInput, Input> | null | undefined,
  input: RunInput | undefined,
): Promise<ValidationResult<Input>> {
  // No schema means no validation - pass through as-is
  if (!schema) {
    return {
      success: true,
      value: input as unknown as Input,
    };
  }

  // Validate using Standard Schema v1 protocol https://standardschema.dev
  const result = schema["~standard"].validate(input);
  const resolved = await Promise.resolve(result);

  if (resolved.issues) {
    const messages =
      resolved.issues.length > 0
        ? resolved.issues.map((issue) => issue.message).join("; ")
        : "Validation failed";
    return {
      success: false,
      error: messages,
    };
  }

  return {
    success: true,
    value: resolved.value,
  };
}
