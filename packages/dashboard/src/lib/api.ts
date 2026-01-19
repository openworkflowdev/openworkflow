import { getBackend } from "./backend";
import { createServerFn } from "@tanstack/react-start";
import type {
  PaginatedResponse,
  PaginationOptions,
  StepAttempt,
  WorkflowRun,
} from "openworkflow/internal";
import * as z from "zod";

/**
 * List workflow runs from the backend with optional pagination.
 */
export const listWorkflowRunsServerFn = createServerFn({ method: "GET" })
  .inputValidator(
    z.object({
      limit: z.number().optional(),
      after: z.string().optional(),
      before: z.string().optional(),
    }),
  )
  .handler(
    async ({ data }): Promise<PaginatedResponse<WorkflowRun>> =>
      withErrorHandling(async () => {
        const backend = await getBackend();
        const params: PaginationOptions = {};
        if (data.limit !== undefined) params.limit = data.limit;
        if (data.after !== undefined) params.after = data.after;
        if (data.before !== undefined) params.before = data.before;

        return await backend.listWorkflowRuns(params);
      }, "listing workflow runs"),
  );

/**
 * Get a single workflow run by ID.
 */
export const getWorkflowRunServerFn = createServerFn({ method: "GET" })
  .inputValidator(z.object({ workflowRunId: z.string() }))
  .handler(
    async ({ data }): Promise<WorkflowRun | null> =>
      withErrorHandling(async () => {
        const backend = await getBackend();
        return await backend.getWorkflowRun({
          workflowRunId: data.workflowRunId,
        });
      }, "fetching the workflow run"),
  );

/**
 * List step attempts for a workflow run.
 */
export const listStepAttemptsServerFn = createServerFn({ method: "GET" })
  .inputValidator(
    z.object({
      workflowRunId: z.string(),
      limit: z.number().optional(),
      after: z.string().optional(),
      before: z.string().optional(),
    }),
  )
  .handler(
    async ({ data }): Promise<PaginatedResponse<StepAttempt>> =>
      withErrorHandling(async () => {
        const backend = await getBackend();
        const params: { workflowRunId: string } & PaginationOptions = {
          workflowRunId: data.workflowRunId,
        };
        if (data.limit !== undefined) params.limit = data.limit;
        if (data.after !== undefined) params.after = data.after;
        if (data.before !== undefined) params.before = data.before;

        return await backend.listStepAttempts(params);
      }, "listing step attempts"),
  );

// -----------------------------------------------------------------------------

/**
 * Structured error response for API handlers
 */
export type ApiError = {
  code: string;
  message: string;
  details?: unknown;
};

/**
 * Error codes for different failure scenarios
 */
export const ErrorCode = {
  DATABASE_CONNECTION_FAILED: "DATABASE_CONNECTION_FAILED",
  BACKEND_INITIALIZATION_FAILED: "BACKEND_INITIALIZATION_FAILED",
  NOT_FOUND: "NOT_FOUND",
  INTERNAL_ERROR: "INTERNAL_ERROR",
} as const;

/**
 * Wraps an async handler function with structured error handling.
 * Catches errors and converts them to structured ApiError responses.
 * @param handler - The async function to wrap
 * @param operationName - Description of the operation for error messages
 * @returns Wrapped handler with error handling
 */
function withErrorHandling<T>(
  handler: () => Promise<T>,
  operationName: string,
): Promise<T> {
  return handler().catch((error: unknown) => {
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error";

    // backend initialization error
    if (
      errorMessage.includes("No openworkflow.config") ||
      errorMessage.includes("config")
    ) {
      throw new Error(
        JSON.stringify({
          code: ErrorCode.BACKEND_INITIALIZATION_FAILED,
          message:
            "Failed to initialize backend. No openworkflow.config.* found. Run `ow init` to create one.",
          details: errorMessage,
        } satisfies ApiError),
      );
    }

    // database connection error
    if (
      errorMessage.toLowerCase().includes("connect") ||
      errorMessage.toLowerCase().includes("econnrefused") ||
      errorMessage.toLowerCase().includes("database")
    ) {
      throw new Error(
        JSON.stringify({
          code: ErrorCode.DATABASE_CONNECTION_FAILED,
          message:
            "Database connection failed. Please check your database configuration and ensure it is running.",
          details: errorMessage,
        } satisfies ApiError),
      );
    }

    // unexpected error
    throw new Error(
      JSON.stringify({
        code: ErrorCode.INTERNAL_ERROR,
        message: `An unexpected error occurred while ${operationName}.`,
        details: errorMessage,
      } satisfies ApiError),
    );
  });
}
