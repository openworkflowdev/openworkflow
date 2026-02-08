import { getBackend } from "./backend";
import { createServerFn } from "@tanstack/react-start";
import type {
  PaginatedResponse,
  PaginationOptions,
  StepAttempt,
  WorkflowRun,
} from "openworkflow/internal";
import * as z from "zod";

const paginationInputShape = {
  limit: z.number().optional(),
  after: z.string().optional(),
  before: z.string().optional(),
};

function getPaginationOptions(data: PaginationOptions): PaginationOptions {
  const pagination: PaginationOptions = {};
  if (data.limit !== undefined) pagination.limit = data.limit;
  if (data.after !== undefined) pagination.after = data.after;
  if (data.before !== undefined) pagination.before = data.before;

  return pagination;
}

/**
 * List workflow runs from the backend with optional pagination.
 */
export const listWorkflowRunsServerFn = createServerFn({ method: "GET" })
  .inputValidator(z.object(paginationInputShape))
  .handler(async ({ data }): Promise<PaginatedResponse<WorkflowRun>> => {
    const backend = await getBackend();
    const result = await backend.listWorkflowRuns(getPaginationOptions(data));
    return result;
  });

/**
 * Get a single workflow run by ID.
 */
export const getWorkflowRunServerFn = createServerFn({ method: "GET" })
  .inputValidator(z.object({ workflowRunId: z.string() }))
  .handler(async ({ data }): Promise<WorkflowRun | null> => {
    const backend = await getBackend();
    const run = await backend.getWorkflowRun({
      workflowRunId: data.workflowRunId,
    });
    return run;
  });

/**
 * List step attempts for a workflow run.
 */
export const listStepAttemptsServerFn = createServerFn({ method: "GET" })
  .inputValidator(
    z.object({
      workflowRunId: z.string(),
      ...paginationInputShape,
    }),
  )
  .handler(async ({ data }): Promise<PaginatedResponse<StepAttempt>> => {
    const backend = await getBackend();
    const params: { workflowRunId: string } & PaginationOptions = {
      workflowRunId: data.workflowRunId,
      ...getPaginationOptions(data),
    };

    const result = await backend.listStepAttempts(params);
    return result;
  });
