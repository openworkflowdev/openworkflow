import type { SerializedError } from "./error.js";
import { JsonValue } from "./json.js";
import type { StandardSchemaV1 } from "./schema.js";

/**
 * Status of a workflow run through its lifecycle.
 */
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
 * Default configuration for result polling when awaiting workflow completion.
 */
export const DEFAULT_WORKFLOW_RESULT_CONFIG = {
  /** Polling interval in milliseconds (1 second) */
  pollIntervalMs: 1000,
  /** Timeout in milliseconds (5 minutes) */
  timeoutMs: 5 * 60 * 1000,
} as const;

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

/**
 * Check if a workflow run status represents a terminal state.
 * @param status - The workflow run status
 * @returns True if the status is terminal (completed, failed, or canceled)
 */
export function isTerminalStatus(
  status: string,
): status is "succeeded" | "completed" | "failed" | "canceled" {
  return (
    status === "succeeded" ||
    status === "completed" ||
    status === "failed" ||
    status === "canceled"
  );
}
