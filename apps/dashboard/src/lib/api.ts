import { getBackend } from "./backend";
import { parseWorkflowInput } from "./input";
import { runFiltersSchema } from "./run-filters";
import { saveWorkflowSchedule, scheduleInputSchema } from "./schedules.server";
import { createServerFn } from "@tanstack/react-start";
import { rerunWorkflowRun } from "openworkflow/internal";
import type {
  ListWorkflowRunsParams,
  PaginatedResponse,
  PaginationOptions,
  StepAttempt,
  WorkflowRunCounts,
  WorkflowRun,
} from "openworkflow/internal";
import * as z from "zod";

const paginationInputFields = {
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
 * List workflow runs from the backend with optional filters and pagination.
 */
export const listWorkflowRunsServerFn = createServerFn({ method: "GET" })
  .validator(z.object({ ...paginationInputFields, ...runFiltersSchema.shape }))
  .handler(async ({ data }): Promise<PaginatedResponse<WorkflowRun>> => {
    const backend = await getBackend();
    const params: ListWorkflowRunsParams = getPaginationOptions(data);
    if (data.status !== undefined) params.status = data.status;
    if (data.workflowName !== undefined)
      params.workflowName = data.workflowName;
    const result = await backend.listWorkflowRuns(params);
    return result;
  });

/**
 * Read workflow run counts from the backend.
 */
export const getWorkflowRunCountsServerFn = createServerFn({
  method: "GET",
}).handler(async (): Promise<WorkflowRunCounts> => {
  const backend = await getBackend();
  return await backend.countWorkflowRuns();
});

/**
 * Get a single workflow run by ID.
 */
export const getWorkflowRunServerFn = createServerFn({ method: "GET" })
  .validator(z.object({ workflowRunId: z.string() }))
  .handler(async ({ data }): Promise<WorkflowRun | null> => {
    const backend = await getBackend();
    const run = await backend.getWorkflowRun({
      workflowRunId: data.workflowRunId,
    });
    return run;
  });

/**
 * Cancel a workflow run by ID.
 */
export const cancelWorkflowRunServerFn = createServerFn({ method: "POST" })
  .validator(z.object({ workflowRunId: z.string() }))
  .handler(async ({ data }): Promise<WorkflowRun> => {
    const backend = await getBackend();
    return backend.cancelWorkflowRun({ workflowRunId: data.workflowRunId });
  });

/** Rerun a finished workflow with its original input and version. */
export const rerunWorkflowRunServerFn = createServerFn({ method: "POST" })
  .validator(
    z.object({ workflowRunId: z.string(), fromStep: z.string().optional() }),
  )
  .handler(async ({ data }): Promise<WorkflowRun> => {
    return await rerunWorkflowRun(
      await getBackend(),
      data.workflowRunId,
      data.fromStep,
    );
  });

/**
 * List step attempts for a workflow run.
 */
export const listStepAttemptsServerFn = createServerFn({ method: "GET" })
  .validator(
    z.object({
      workflowRunId: z.string(),
      ...paginationInputFields,
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
 * Get a single step attempt by ID.
 */
export const getStepAttemptServerFn = createServerFn({ method: "GET" })
  .validator(z.object({ stepAttemptId: z.string() }))
  .handler(async ({ data }): Promise<StepAttempt | null> => {
    const backend = await getBackend();
    const stepAttempt = await backend.getStepAttempt({
      stepAttemptId: data.stepAttemptId,
    });
    return stepAttempt;
  });

/**
 * Create a new workflow run.
 */
export const createWorkflowRunServerFn = createServerFn({ method: "POST" })
  .validator(
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

    const availableAt = parseOptionalDate(data.availableAt, "Schedule for");
    const deadlineAt = parseOptionalDate(data.deadlineAt, "Deadline");

    return backend.createWorkflowRun({
      workflowName: data.workflowName,
      version,
      idempotencyKey: null,
      config: {},
      context: null,
      input: parseWorkflowInput(data.input),
      parentStepAttemptNamespaceId: null,
      parentStepAttemptId: null,
      availableAt,
      deadlineAt,
    });
  });

export const listWorkflowSchedulesServerFn = createServerFn({ method: "GET" })
  .validator(z.object(paginationInputFields))
  .handler(async ({ data }) => {
    const backend = await getBackend();
    return backend.listWorkflowSchedules(getPaginationOptions(data));
  });

const scheduleIdInput = z.object({ workflowScheduleId: z.string().min(1) });

export const getWorkflowScheduleServerFn = createServerFn({ method: "GET" })
  .validator(scheduleIdInput)
  .handler(async ({ data }) => {
    const backend = await getBackend();
    return backend.getWorkflowSchedule(data);
  });

export const saveWorkflowScheduleServerFn = createServerFn({ method: "POST" })
  .validator(scheduleInputSchema)
  .handler(async ({ data }) => saveWorkflowSchedule(await getBackend(), data));

export const setWorkflowSchedulePausedServerFn = createServerFn({
  method: "POST",
})
  .validator(scheduleIdInput.extend({ paused: z.boolean() }))
  .handler(async ({ data }) => {
    const backend = await getBackend();
    return backend.pauseWorkflowSchedule(data);
  });

export const deleteWorkflowScheduleServerFn = createServerFn({ method: "POST" })
  .validator(scheduleIdInput)
  .handler(async ({ data }) => {
    const backend = await getBackend();
    return backend.deleteWorkflowSchedule(data);
  });
