import type { DurationString } from "./duration.js";
import { parseDuration } from "./duration.js";
import type { JsonValue } from "./json.js";
import type { Result } from "./result.js";
import { err, ok } from "./result.js";

/**
 * The kind of step in a workflow.
 */
export type StepKind = "function" | "sleep";

/**
 * Status of a step attempt through its lifecycle.
 */
export type StepAttemptStatus =
  | "running"
  | "succeeded" // deprecated in favor of 'completed'
  | "completed"
  | "failed";

/**
 * Context for a step attempt (currently only used for sleep steps).
 */
export interface StepAttemptContext {
  kind: "sleep";
  resumeAt: string;
}

/**
 * StepAttempt represents a single attempt of a step within a workflow.
 */
export interface StepAttempt {
  namespaceId: string;
  id: string;
  workflowRunId: string;
  stepName: string;
  kind: StepKind;
  status: StepAttemptStatus;
  config: JsonValue; // user-defined config
  context: StepAttemptContext | null; // runtime execution metadata
  output: JsonValue | null;
  error: JsonValue | null;
  childWorkflowRunNamespaceId: string | null;
  childWorkflowRunId: string | null;
  startedAt: Date | null;
  finishedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Immutable cache for step attempts, keyed by step name.
 */
export type StepAttemptCache = ReadonlyMap<string, StepAttempt>;

/**
 * Create a step attempt cache from an array of attempts. Only includes
 * successful attempts (completed or succeeded status).
 * @param attempts - Array of step attempts to cache
 * @returns An immutable map of step name to successful attempt
 */
export function createStepAttemptCacheFromAttempts(
  attempts: readonly StepAttempt[],
): StepAttemptCache {
  // 'succeeded' status is deprecated in favor of 'completed'
  const successfulAttempts = attempts.filter(
    (attempt) =>
      attempt.status === "succeeded" || attempt.status === "completed",
  );

  return new Map(
    successfulAttempts.map((attempt) => [attempt.stepName, attempt]),
  );
}

/**
 * Get a cached step attempt by name.
 * @param cache - The step attempt cache
 * @param stepName - The name of the step to look up
 * @returns The cached attempt or undefined if not found
 */
export function getCachedStepAttempt(
  cache: StepAttemptCache,
  stepName: string,
): StepAttempt | undefined {
  return cache.get(stepName);
}

/**
 * Add a step attempt to the cache (returns new cache, original unchanged). This
 * is an immutable operation.
 * @param cache - The existing step attempt cache
 * @param attempt - The attempt to add
 * @returns A new cache with the attempt added
 */
export function addToStepAttemptCache(
  cache: StepAttemptCache,
  attempt: Readonly<StepAttempt>,
): StepAttemptCache {
  return new Map([...cache, [attempt.stepName, attempt]]);
}

/**
 * Convert a step function result to a JSON-compatible value. Undefined values
 * are converted to null for JSON serialization.
 * @param result - The result from a step function
 * @returns A JSON-serializable value
 */
export function normalizeStepOutput(result: unknown): JsonValue {
  return (result ?? null) as JsonValue;
}

/**
 * Calculate the resume time for a sleep step.
 * @param duration - The duration string to sleep for
 * @param now - The current timestamp (defaults to Date.now())
 * @returns A Result containing the resume Date or an Error
 */
export function calculateSleepResumeAt(
  duration: DurationString,
  now: number = Date.now(),
): Result<Date> {
  const result = parseDuration(duration);

  if (!result.ok) {
    return err(result.error);
  }

  return ok(new Date(now + result.value));
}

/**
 * Create the context object for a sleep step attempt.
 * @param resumeAt - The time when the sleep should resume
 * @returns The context object for the sleep step
 */
export function createSleepContext(resumeAt: Readonly<Date>): {
  kind: "sleep";
  resumeAt: string;
} {
  return {
    kind: "sleep" as const,
    resumeAt: resumeAt.toISOString(),
  };
}
