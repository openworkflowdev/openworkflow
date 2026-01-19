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
 * Serialized version of WorkflowRun where Date fields are ISO strings.
 * Used for JSON transport between server and client.
 */
export interface SerializedWorkflowRun extends Omit<
  WorkflowRun,
  | "availableAt"
  | "deadlineAt"
  | "startedAt"
  | "finishedAt"
  | "createdAt"
  | "updatedAt"
> {
  availableAt: string | null;
  deadlineAt: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * Serialized version of StepAttempt where Date fields are ISO strings.
 */
export interface SerializedStepAttempt extends Omit<
  StepAttempt,
  "startedAt" | "finishedAt" | "createdAt" | "updatedAt"
> {
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * Serialize a WorkflowRun for JSON transport.
 * @param run - The workflow run to serialize
 * @returns Serialized workflow run with ISO date strings
 */
function serializeWorkflowRun(run: WorkflowRun): SerializedWorkflowRun {
  return {
    ...run,
    availableAt: run.availableAt?.toISOString() ?? null,
    deadlineAt: run.deadlineAt?.toISOString() ?? null,
    startedAt: run.startedAt?.toISOString() ?? null,
    finishedAt: run.finishedAt?.toISOString() ?? null,
    createdAt: run.createdAt.toISOString(),
    updatedAt: run.updatedAt.toISOString(),
  };
}

/**
 * Serialize a StepAttempt for JSON transport.
 * @param step - The step attempt to serialize
 * @returns Serialized step attempt with ISO date strings
 */
function serializeStepAttempt(step: StepAttempt): SerializedStepAttempt {
  return {
    ...step,
    startedAt: step.startedAt?.toISOString() ?? null,
    finishedAt: step.finishedAt?.toISOString() ?? null,
    createdAt: step.createdAt.toISOString(),
    updatedAt: step.updatedAt.toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Server Functions
// ---------------------------------------------------------------------------

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
    async ({ data }): Promise<PaginatedResponse<SerializedWorkflowRun>> => {
      const backend = await getBackend();
      const params: PaginationOptions = {};
      if (data.limit !== undefined) params.limit = data.limit;
      if (data.after !== undefined) params.after = data.after;
      if (data.before !== undefined) params.before = data.before;

      const result = await backend.listWorkflowRuns(params);
      return {
        data: result.data.map((run) => serializeWorkflowRun(run)),
        pagination: result.pagination,
      };
    },
  );

/**
 * Get a single workflow run by ID.
 */
export const getWorkflowRunServerFn = createServerFn({ method: "GET" })
  .inputValidator(z.object({ workflowRunId: z.string() }))
  .handler(async ({ data }): Promise<SerializedWorkflowRun | null> => {
    const backend = await getBackend();
    const run = await backend.getWorkflowRun({
      workflowRunId: data.workflowRunId,
    });
    return run ? serializeWorkflowRun(run) : null;
  });

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
    async ({ data }): Promise<PaginatedResponse<SerializedStepAttempt>> => {
      const backend = await getBackend();
      const params: { workflowRunId: string } & PaginationOptions = {
        workflowRunId: data.workflowRunId,
      };
      if (data.limit !== undefined) params.limit = data.limit;
      if (data.after !== undefined) params.after = data.after;
      if (data.before !== undefined) params.before = data.before;

      const result = await backend.listStepAttempts(params);
      return {
        data: result.data.map((step) => serializeStepAttempt(step)),
        pagination: result.pagination,
      };
    },
  );
