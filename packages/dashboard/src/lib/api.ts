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

interface PaginationInput {
  limit?: number | undefined;
  after?: string | undefined;
  before?: string | undefined;
}

function getPaginationOptions(data: PaginationInput): PaginationOptions {
  const pagination: PaginationOptions = {};
  if (data.limit !== undefined) pagination.limit = data.limit;
  if (data.after !== undefined) pagination.after = data.after;
  if (data.before !== undefined) pagination.before = data.before;

  return pagination;
}

function parseOptionalDate(
  value: string | null | undefined,
  fieldName: string,
): Date | null {
  if (!value) {
    return null;
  }

  const parsedDate = new Date(value);
  if (Number.isNaN(parsedDate.getTime())) {
    throw new TypeError(`${fieldName} must be a valid date and time`);
  }

  return parsedDate;
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

/**
 * Create a new workflow run.
 */
export const createWorkflowRunServerFn = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      workflowName: z.string().trim().min(1),
      version: z.string().nullable().optional(),
      input: z.string().nullable().optional(),
      availableAt: z.string().nullable().optional(),
      deadlineAt: z.string().nullable().optional(),
    }),
  )
  .handler(async ({ data }): Promise<WorkflowRun> => {
    const backend = await getBackend();

    const versionValue = data.version?.trim();
    const version =
      versionValue === undefined || versionValue === "" ? null : versionValue;

    const inputValue = data.input?.trim();
    const normalizedInputValue =
      inputValue === undefined || inputValue === "" ? null : inputValue;

    const availableAt = parseOptionalDate(data.availableAt, "Schedule for");
    const deadlineAt = parseOptionalDate(data.deadlineAt, "Deadline");

    let parsedInput: WorkflowRun["input"] = null;
    if (normalizedInputValue) {
      try {
        parsedInput = JSON.parse(normalizedInputValue) as WorkflowRun["input"];
      } catch {
        throw new TypeError("Input must be valid JSON");
      }
    }

    return backend.createWorkflowRun({
      workflowName: data.workflowName,
      version,
      idempotencyKey: null,
      config: {},
      context: null,
      input: parsedInput,
      availableAt,
      deadlineAt,
    });
  });
