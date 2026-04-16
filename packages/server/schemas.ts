import type { JsonValue, StepAttemptContext } from "openworkflow/internal";
import { STEP_KINDS } from "openworkflow/internal";
import { z } from "zod/v4";

// Request body schemas. ISO-8601 datetime strings are parsed into Date so
// route handlers can pass the body straight through to the backend. JSON
// payloads are typed directly as JsonValue to avoid zod's recursive
// inference blowing TypeScript's depth limit.

const isoDatetime = z.iso.datetime().transform((s) => new Date(s));

const jsonValue = z.json() as unknown as z.ZodType<JsonValue>;
const stepAttemptContext = z.json() as unknown as z.ZodType<StepAttemptContext>;

const errorSchema = z.object({
  name: z.string().optional(),
  message: z.string(),
  stack: z.string().optional(),
});

export const createWorkflowRunSchema = z.object({
  workflowName: z.string(),
  version: z.string().nullable(),
  idempotencyKey: z.string().nullable(),
  config: jsonValue,
  context: jsonValue.nullable(),
  input: jsonValue.nullable(),
  parentStepAttemptNamespaceId: z.string().nullable().optional().default(null),
  parentStepAttemptId: z.string().nullable().optional().default(null),
  availableAt: isoDatetime.nullable().optional().default(null),
  deadlineAt: isoDatetime.nullable().optional().default(null),
});

const workerLeaseFields = {
  workerId: z.string(),
  leaseDurationMs: z.number(),
};

export const claimWorkflowRunSchema = z.object(workerLeaseFields);

export const extendWorkflowRunLeaseSchema = z.object(workerLeaseFields);

export const sleepWorkflowRunSchema = z.object({
  workerId: z.string(),
  availableAt: isoDatetime,
});

export const completeWorkflowRunSchema = z.object({
  workerId: z.string(),
  output: jsonValue.nullable(),
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

export const createStepAttemptSchema = z.object({
  workerId: z.string(),
  stepName: z.string(),
  kind: z.enum(STEP_KINDS),
  config: jsonValue,
  context: stepAttemptContext.nullable(),
});

export const completeStepAttemptSchema = z.object({
  workflowRunId: z.string(),
  workerId: z.string(),
  output: jsonValue.nullable(),
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

export const sendSignalSchema = z.object({
  signal: z.string(),
  data: jsonValue.nullable(),
  idempotencyKey: z.string().nullable(),
});
