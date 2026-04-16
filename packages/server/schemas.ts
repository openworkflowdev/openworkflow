import { STEP_KINDS } from "openworkflow/internal";
import { z } from "zod/v4";

// ---------------------------------------------------------------------------
// Request body schemas
//
// Each exported schema validates the JSON body of one HTTP route.
// Dates are validated as ISO-8601 strings (via `z.iso.datetime()`) so that an
// invalid value is rejected with 400 before the backend sees it; handlers are
// responsible for the `new Date(...)` conversion.
// ---------------------------------------------------------------------------

/** ISO-8601 datetime string. */
const isoDatetime = z.iso.datetime();

/** Serialized error payload (mirrors SerializedError from core). */
const errorSchema = z.object({
  name: z.string().optional(),
  message: z.string(),
  stack: z.string().optional(),
});

// ---------------------------------------------------------------------------
// Workflow Runs
// ---------------------------------------------------------------------------

export const createWorkflowRunSchema = z.object({
  workflowName: z.string(),
  version: z.string().nullable(),
  idempotencyKey: z.string().nullable(),
  config: z.json(),
  context: z.json().nullable(),
  input: z.json().nullable(),
  parentStepAttemptNamespaceId: z.string().nullable().optional().default(null),
  parentStepAttemptId: z.string().nullable().optional().default(null),
  availableAt: isoDatetime.nullable().optional().default(null),
  deadlineAt: isoDatetime.nullable().optional().default(null),
});

export const claimWorkflowRunSchema = z.object({
  workerId: z.string(),
  leaseDurationMs: z.number(),
});

export const extendWorkflowRunLeaseSchema = claimWorkflowRunSchema;

export const sleepWorkflowRunSchema = z.object({
  workerId: z.string(),
  availableAt: isoDatetime,
});

export const completeWorkflowRunSchema = z.object({
  workerId: z.string(),
  output: z.json().nullable(),
});

export const failWorkflowRunSchema = z.object({
  workerId: z.string(),
  error: errorSchema,
  retryPolicy: z.object({
    initialInterval: z.string(),
    backoffCoefficient: z.number(),
    maximumInterval: z.string(),
    maximumAttempts: z.number(),
  }),
  attempts: z.number().optional(),
  deadlineAt: isoDatetime.nullable().optional(),
});

export const rescheduleWorkflowRunSchema = z.object({
  workerId: z.string(),
  error: errorSchema,
  availableAt: isoDatetime,
});

// ---------------------------------------------------------------------------
// Step Attempts
// ---------------------------------------------------------------------------

export const createStepAttemptSchema = z.object({
  workerId: z.string(),
  stepName: z.string(),
  kind: z.enum(STEP_KINDS),
  config: z.json(),
  context: z.json().nullable(),
});

export const completeStepAttemptSchema = z.object({
  workflowRunId: z.string(),
  workerId: z.string(),
  output: z.json().nullable(),
});

export const failStepAttemptSchema = z.object({
  workflowRunId: z.string(),
  workerId: z.string(),
  error: errorSchema,
});

export const setStepAttemptChildWorkflowRunSchema = z.object({
  workflowRunId: z.string(),
  workerId: z.string(),
  childWorkflowRunNamespaceId: z.string(),
  childWorkflowRunId: z.string(),
});

// ---------------------------------------------------------------------------
// Signals
// ---------------------------------------------------------------------------

export const sendSignalSchema = z.object({
  signal: z.string(),
  data: z.json().nullable(),
  idempotencyKey: z.string().nullable(),
});
