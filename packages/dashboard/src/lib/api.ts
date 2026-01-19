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
  .handler(async ({ data }): Promise<PaginatedResponse<WorkflowRun>> => {
    const backend = await getBackend();
    const params: PaginationOptions = {};
    if (data.limit !== undefined) params.limit = data.limit;
    if (data.after !== undefined) params.after = data.after;
    if (data.before !== undefined) params.before = data.before;

    const result = await backend.listWorkflowRuns(params);
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
      limit: z.number().optional(),
      after: z.string().optional(),
      before: z.string().optional(),
    }),
  )
  .handler(async ({ data }): Promise<PaginatedResponse<StepAttempt>> => {
    const backend = await getBackend();
    const params: { workflowRunId: string } & PaginationOptions = {
      workflowRunId: data.workflowRunId,
    };
    if (data.limit !== undefined) params.limit = data.limit;
    if (data.after !== undefined) params.after = data.after;
    if (data.before !== undefined) params.before = data.before;

    const result = await backend.listStepAttempts(params);
    return result;
  });
