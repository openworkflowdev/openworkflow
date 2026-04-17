import type { StepAttempt, StepAttemptCache } from "../core/step-attempt.js";
import {
  addToStepAttemptCache,
  getCachedStepAttempt,
} from "../core/step-attempt.js";

/** Maximum number of step attempts allowed for a single workflow run. */
export const WORKFLOW_STEP_LIMIT = 1000;

/** Error code used when a workflow run exceeds the step-attempt limit. */
export const STEP_LIMIT_EXCEEDED_ERROR_CODE = "STEP_LIMIT_EXCEEDED";

/**
 * Error thrown when a workflow run reaches the maximum allowed step attempts.
 */
export class StepLimitExceededError extends Error {
  readonly code = STEP_LIMIT_EXCEEDED_ERROR_CODE;
  readonly limit: number;
  readonly stepCount: number;

  constructor(limit: number, stepCount: number) {
    super(
      `Exceeded the step limit of ${String(limit)} attempts (current count: ${String(stepCount)})`,
    );
    this.name = "StepLimitExceededError";
    this.limit = limit;
    this.stepCount = stepCount;
  }
}

/**
 * Derived in-memory step state for a single workflow execution pass.
 */
export interface StepExecutionState {
  cache: StepAttemptCache;
  failedCountsByStepName: ReadonlyMap<string, number>;
  failedByStepName: ReadonlyMap<string, StepAttempt>;
  runningByStepName: ReadonlyMap<string, StepAttempt>;
}

/**
 * Build step execution state from loaded attempts in one pass.
 * @param attempts - Loaded step attempts for the workflow run
 * @returns Successful cache plus failed-attempt counts by step name
 */
export function createStepExecutionStateFromAttempts(
  attempts: readonly StepAttempt[],
): StepExecutionState {
  const cache = new Map<string, StepAttempt>();
  const failedCountsByStepName = new Map<string, number>();
  const failedByStepName = new Map<string, StepAttempt>();
  const runningByStepName = new Map<string, StepAttempt>();

  for (const attempt of attempts) {
    if (attempt.status === "completed" || attempt.status === "succeeded") {
      cache.set(attempt.stepName, attempt);
      continue;
    }

    if (attempt.status === "failed") {
      const previousCount = failedCountsByStepName.get(attempt.stepName) ?? 0;
      failedCountsByStepName.set(attempt.stepName, previousCount + 1);
      failedByStepName.set(attempt.stepName, attempt);
      continue;
    }

    runningByStepName.set(attempt.stepName, attempt);
  }

  return {
    cache,
    failedCountsByStepName,
    failedByStepName,
    runningByStepName,
  };
}

/**
 * Default wait timeout: 1 year from a base time.
 * @param base - Base timestamp (defaults to now)
 * @returns Timeout deadline
 */
export function defaultWaitTimeoutAt(base: Readonly<Date> = new Date()): Date {
  const timeoutAt = new Date(base);
  timeoutAt.setFullYear(timeoutAt.getFullYear() + 1);
  return timeoutAt;
}

/**
 * Extract the timeout from a persisted step attempt's context.
 * Works for both workflow and signal-wait step types.
 * @param attempt - Running step attempt
 * @returns Timeout deadline, or null when context has no timeout
 */
export function getContextTimeoutAt(
  attempt: Readonly<StepAttempt>,
): Date | null {
  if (
    attempt.context?.kind !== "workflow" &&
    attempt.context?.kind !== "signal-wait"
  ) {
    return null;
  }

  const { timeoutAt } = attempt.context;
  if (timeoutAt === null) {
    // backward compatibility for previously persisted workflow contexts
    // (signal-wait timeoutAt is never null per SignalWaitStepAttemptContext).
    return defaultWaitTimeoutAt(attempt.createdAt);
  }
  return new Date(timeoutAt);
}

/**
 * Resolve the next wake-up timestamp for a running wait step attempt.
 * @param attempt - Running step attempt
 * @returns Wake-up timestamp, or null when the attempt is not a wait step
 */
function getRunningWaitAttemptResumeAt(
  attempt: Readonly<StepAttempt>,
): Date | null {
  if (attempt.status !== "running") {
    return null;
  }

  if (attempt.kind === "sleep" && attempt.context?.kind === "sleep") {
    const resumeAt = new Date(attempt.context.resumeAt);
    return Number.isFinite(resumeAt.getTime()) ? resumeAt : null;
  }

  if (attempt.kind !== "signal-wait" && attempt.kind !== "workflow") {
    return null;
  }

  const timeoutAt =
    getContextTimeoutAt(attempt) ?? defaultWaitTimeoutAt(attempt.createdAt);
  return Number.isFinite(timeoutAt.getTime())
    ? timeoutAt
    : defaultWaitTimeoutAt(attempt.createdAt);
}

/**
 * Compute the earliest wake-up timestamp across running wait step attempts.
 * @param attempts - Persisted step attempts for the workflow run
 * @returns Earliest wake-up timestamp, or null when no running wait exists
 */
export function getEarliestRunningWaitResumeAt(
  attempts: readonly StepAttempt[],
): Date | null {
  let earliest: Date | null = null;

  for (const attempt of attempts) {
    const resumeAt = getRunningWaitAttemptResumeAt(attempt);
    if (!resumeAt) {
      continue;
    }

    if (!earliest || resumeAt.getTime() < earliest.getTime()) {
      earliest = resumeAt;
    }
  }

  return earliest;
}

/**
 * Options for constructing a {@link StepHistory}.
 */
export interface StepHistoryOptions {
  attempts: readonly StepAttempt[];
  stepLimit?: number;
}

/**
 * Encapsulates the in-memory step-attempt ledger for a single workflow
 * execution pass: the successful-result cache, running/failed maps, failure
 * counts, resolved step names, and the step-attempt limit. Exposes a narrow
 * API so step-kind logic in {@link StepExecutor} doesn't touch these maps
 * directly.
 */
export class StepHistory {
  private cache: StepAttemptCache;
  private readonly failedCountsByStepName: Map<string, number>;
  private readonly failedByStepName: Map<string, StepAttempt>;
  private readonly runningByStepName: Map<string, StepAttempt>;
  private readonly resolvedStepNames = new Set<string>();
  private readonly expectedNextStepIndexByName = new Map<string, number>();
  private readonly stepLimit: number;
  private stepCount: number;

  constructor(options: Readonly<StepHistoryOptions>) {
    this.stepLimit = Math.max(1, options.stepLimit ?? WORKFLOW_STEP_LIMIT);
    this.stepCount = options.attempts.length;

    const state = createStepExecutionStateFromAttempts(options.attempts);
    this.cache = state.cache;
    this.failedCountsByStepName = new Map(state.failedCountsByStepName);
    this.failedByStepName = new Map(state.failedByStepName);
    this.runningByStepName = new Map(state.runningByStepName);
  }

  /**
   * Resolve a step name to a deterministic, unique key for this workflow
   * execution pass. When a name collides, suffixes are appended as
   * `name:1`, `name:2`, etc. If those suffixes already exist (including
   * user-provided names), indexing continues until an unused name is found.
   * @param baseStepName - User-provided step name
   * @returns Resolved step name used for durable step state
   */
  resolveStepName(baseStepName: string): string {
    if (!this.resolvedStepNames.has(baseStepName)) {
      this.resolvedStepNames.add(baseStepName);
      return baseStepName;
    }

    const expectedNextIndex =
      this.expectedNextStepIndexByName.get(baseStepName) ?? 1;
    for (let index = expectedNextIndex; ; index += 1) {
      const resolvedName = `${baseStepName}:${String(index)}`;
      if (this.resolvedStepNames.has(resolvedName)) {
        continue;
      }

      this.expectedNextStepIndexByName.set(baseStepName, index + 1);
      this.resolvedStepNames.add(resolvedName);
      return resolvedName;
    }
  }

  findCached(stepName: string): StepAttempt | undefined {
    return getCachedStepAttempt(this.cache, stepName);
  }

  findRunning(stepName: string): StepAttempt | undefined {
    return this.runningByStepName.get(stepName);
  }

  /**
   * Find a previously-failed workflow step attempt that already created a
   * child workflow run. Workflow steps are terminal once a failure is
   * persisted with linkage: the caller should surface the failure instead of
   * spawning another child.
   * @param stepName - Resolved step name
   * @returns Terminally-failed workflow attempt, or undefined
   */
  findTerminallyFailedWorkflow(stepName: string): StepAttempt | undefined {
    const attempt = this.failedByStepName.get(stepName);
    if (
      attempt?.kind === "workflow" &&
      attempt.childWorkflowRunNamespaceId &&
      attempt.childWorkflowRunId
    ) {
      return attempt;
    }
    return undefined;
  }

  /**
   * Find a running signal-wait step that is already waiting on the given
   * signal, excluding a specific step name.
   * @param signal - Signal address
   * @param excludeStepName - Step name to skip (usually the caller)
   * @returns Conflict descriptor, or null when none exists
   */
  findConflictingSignalWait(
    signal: string,
    excludeStepName: string,
  ): { stepName: string; attempt: StepAttempt } | null {
    for (const [stepName, attempt] of this.runningByStepName) {
      if (
        stepName !== excludeStepName &&
        attempt.kind === "signal-wait" &&
        attempt.context?.kind === "signal-wait" &&
        attempt.context.signal === signal
      ) {
        return { stepName, attempt };
      }
    }
    return null;
  }

  failedAttemptCount(stepName: string): number {
    return this.failedCountsByStepName.get(stepName) ?? 0;
  }

  /**
   * Iterate over currently-running step attempts.
   * @returns Iterator over running step attempts
   */
  runningAttempts(): IterableIterator<StepAttempt> {
    return this.runningByStepName.values();
  }

  /**
   * Earliest wake-up timestamp across running wait attempts.
   * @returns Earliest wake-up timestamp, or null when no running wait exists
   */
  earliestRunningWaitResumeAt(): Date | null {
    return getEarliestRunningWaitResumeAt([...this.runningByStepName.values()]);
  }

  /**
   * Earliest wake-up timestamp considering running waits and a fallback (from
   * the in-progress wait the caller is about to park on). Always returns a
   * concrete date.
   * @param fallback - Candidate timestamp for the in-progress wait
   * @returns The earlier of the fallback or any known running wait
   */
  resolveEarliestRunningWaitResumeAt(fallback: Readonly<Date>): Date {
    const earliest = this.earliestRunningWaitResumeAt();
    if (!earliest) return new Date(fallback);

    const fallbackMs = fallback.getTime();
    if (!Number.isFinite(fallbackMs)) return earliest;

    return earliest.getTime() < fallbackMs ? earliest : new Date(fallback);
  }

  /**
   * Assert that recording another step attempt would not exceed the step
   * limit.
   * @throws {StepLimitExceededError} When the step-attempt limit is reached
   */
  ensureCanRecordNewAttempt(): void {
    if (this.stepCount >= this.stepLimit) {
      throw new StepLimitExceededError(this.stepLimit, this.stepCount);
    }
  }

  /**
   * Record a newly-created step attempt as running and increment the attempt
   * counter. Callers must invoke {@link ensureCanRecordNewAttempt} beforehand.
   * @param attempt - Step attempt just created in the backend
   */
  recordNewAttempt(attempt: Readonly<StepAttempt>): void {
    this.runningByStepName.set(attempt.stepName, attempt);
    this.stepCount += 1;
  }

  /**
   * Replace the running entry for a step (e.g. after linking a child workflow
   * run onto an existing attempt). Does not change the attempt counter.
   * @param attempt - Updated step attempt
   */
  replaceRunningAttempt(attempt: Readonly<StepAttempt>): void {
    this.runningByStepName.set(attempt.stepName, attempt);
  }

  /**
   * Mark a step attempt as completed: remove from running, add to the cache.
   * @param attempt - Completed step attempt
   */
  recordCompletion(attempt: Readonly<StepAttempt>): void {
    this.runningByStepName.delete(attempt.stepName);
    this.cache = addToStepAttemptCache(this.cache, attempt);
  }

  /**
   * Mark a step attempt as failed: remove from running, record failure, and
   * return the new failed-attempt count for that step name.
   * @param attempt - Failed step attempt
   * @returns The new cumulative failed-attempt count for this step name
   */
  recordFailedAttempt(attempt: Readonly<StepAttempt>): number {
    this.runningByStepName.delete(attempt.stepName);
    const nextCount =
      (this.failedCountsByStepName.get(attempt.stepName) ?? 0) + 1;
    this.failedCountsByStepName.set(attempt.stepName, nextCount);
    this.failedByStepName.set(attempt.stepName, attempt);
    return nextCount;
  }
}
