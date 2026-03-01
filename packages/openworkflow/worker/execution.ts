import type { Backend } from "../core/backend.js";
import type { DurationString } from "../core/duration.js";
import {
  deserializeError,
  serializeError,
  type SerializedError,
} from "../core/error.js";
import type { JsonValue } from "../core/json.js";
import type { StepAttempt, StepAttemptCache } from "../core/step-attempt.js";
import {
  getCachedStepAttempt,
  addToStepAttemptCache,
  normalizeStepOutput,
  calculateDateFromDuration,
  createSleepContext,
  createWorkflowContext,
} from "../core/step-attempt.js";
import {
  computeFailedWorkflowRunUpdate,
  DEFAULT_WORKFLOW_RETRY_POLICY,
  type RetryPolicy,
  type WorkflowSpec,
} from "../core/workflow-definition.js";
import type {
  StepRunWorkflowOptions,
  StepApi,
  StepFunction,
  StepFunctionConfig,
  WorkflowFunction,
  WorkflowRunMetadata,
} from "../core/workflow-function.js";
import {
  isTerminalStatus,
  validateInput,
  type WorkflowRun,
} from "../core/workflow-run.js";

/**
 * Signal thrown when a workflow needs to sleep. Contains the time when the
 * workflow should resume.
 */
class SleepSignal extends Error {
  readonly resumeAt: Date;

  constructor(resumeAt: Readonly<Date>) {
    super("SleepSignal");
    this.name = "SleepSignal";
    this.resumeAt = resumeAt;
  }
}

/**
 * Raised when a parallel branch continues after the parent execution has been
 * parked or otherwise finalized for this replay pass.
 */
class StaleExecutionBranchError extends Error {
  constructor() {
    super("Workflow execution branch is no longer active");
    this.name = "StaleExecutionBranchError";
  }
}

/**
 * Lightweight in-memory fence used to stop stale parallel branches from
 * writing new step attempts after execution is parked/finalized.
 */
class ExecutionFence {
  private active = true;

  deactivate(): void {
    this.active = false;
  }

  isActive(): boolean {
    return this.active;
  }

  assertActive(): void {
    if (!this.active) {
      throw new StaleExecutionBranchError();
    }
  }
}

interface ExecutionFenceController {
  deactivate(): void;
  isActive(): boolean;
  assertActive(): void;
}

/**
 * Error wrapper used to pass step failure metadata to executeWorkflow.
 */
class StepError extends Error {
  readonly stepName: string;
  readonly stepFailedAttempts: number;
  readonly retryPolicy: RetryPolicy;
  readonly originalError: unknown;

  constructor(
    options: Readonly<{
      stepName: string;
      stepFailedAttempts: number;
      retryPolicy: RetryPolicy;
      error: unknown;
    }>,
  ) {
    const serialized = serializeError(options.error);
    super(serialized.message, { cause: options.error });
    this.name = "StepError";
    this.stepName = options.stepName;
    this.stepFailedAttempts = options.stepFailedAttempts;
    this.retryPolicy = options.retryPolicy;
    this.originalError = options.error;
  }
}

/** Default retry policy for step failures. */
const DEFAULT_STEP_RETRY_POLICY: RetryPolicy = {
  initialInterval: "1s",
  backoffCoefficient: 2,
  maximumInterval: "100s",
  maximumAttempts: 10,
};

/**
 * Retry policy for workflow step failures (no retries - the child workflow
 * is responsible for retries).
 */
const WORKFLOW_STEP_FAILURE_RETRY_POLICY: RetryPolicy = {
  ...DEFAULT_STEP_RETRY_POLICY,
  maximumAttempts: 1,
};

/** Maximum number of step attempts allowed for a single workflow run. */
export const WORKFLOW_STEP_LIMIT = 1000;

/** Error code used when a workflow run exceeds the step-attempt limit. */
export const STEP_LIMIT_EXCEEDED_ERROR_CODE = "STEP_LIMIT_EXCEEDED";

/**
 * Error thrown when a workflow run reaches the maximum allowed step attempts.
 */
class StepLimitExceededError extends Error {
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
 * Convert a step-limit error to a persisted serialized error payload.
 * @param error - Step-limit error
 * @returns Serialized error payload with limit metadata
 */
function serializeStepLimitExceededError(
  error: Readonly<StepLimitExceededError>,
): {
  name: string;
  message: string;
  code: string;
  limit: number;
  stepCount: number;
} {
  return {
    name: error.name,
    message: error.message,
    code: error.code,
    limit: error.limit,
    stepCount: error.stepCount,
  };
}

/**
 * Resolve a partial step retry policy by merging it with step defaults.
 * @param partial - Optional partial retry policy
 * @returns Fully resolved step retry policy
 */
function resolveStepRetryPolicy(partial?: Partial<RetryPolicy>): RetryPolicy {
  if (!partial) return DEFAULT_STEP_RETRY_POLICY;
  return { ...DEFAULT_STEP_RETRY_POLICY, ...partial };
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
 * Resolve workflow timeout input to an absolute deadline.
 * @param timeout - Relative/absolute timeout input
 * @returns Absolute timeout deadline
 * @throws {Error} When timeout is invalid
 */
function resolveWorkflowTimeoutAt(
  timeout: number | string | Date | undefined,
): Date {
  if (timeout === undefined) {
    return defaultWorkflowTimeoutAt();
  }

  if (timeout instanceof Date) {
    return timeout;
  }

  if (typeof timeout === "number") {
    if (!Number.isFinite(timeout) || timeout < 0) {
      throw new Error("Workflow timeout must be a non-negative number");
    }
    return new Date(Date.now() + timeout);
  }

  const result = calculateDateFromDuration(timeout as DurationString);
  if (!result.ok) {
    throw result.error;
  }
  return result.value;
}

/**
 * Default workflow timeout: 1 year from a base time.
 * @param base - Base timestamp (defaults to now)
 * @returns Timeout deadline
 */
function defaultWorkflowTimeoutAt(base: Readonly<Date> = new Date()): Date {
  const timeoutAt = new Date(base);
  timeoutAt.setFullYear(timeoutAt.getFullYear() + 1);
  return timeoutAt;
}

/**
 * Extract the workflow timeout from a persisted step attempt's context.
 * @param attempt - Running workflow step attempt
 * @returns Timeout deadline, or null when context is not workflow
 */
function getWorkflowTimeoutAt(attempt: Readonly<StepAttempt>): Date | null {
  if (attempt.context?.kind !== "workflow") {
    return null;
  }

  if (attempt.context.timeoutAt === null) {
    // Backward compatibility for previously persisted workflow contexts.
    return defaultWorkflowTimeoutAt(attempt.createdAt);
  }

  return new Date(attempt.context.timeoutAt);
}

/**
 * Determine whether the workflow timeout has elapsed before the child completed.
 * @param attempt - Running workflow step attempt
 * @param childRun - Linked child workflow run
 * @returns True when timeout elapsed before child terminal completion
 */
function hasWorkflowTimedOut(
  attempt: Readonly<StepAttempt>,
  childRun: Readonly<WorkflowRun>,
): boolean {
  const timeoutAt = getWorkflowTimeoutAt(attempt);
  if (!timeoutAt) return false;

  const timeoutMs = timeoutAt.getTime();
  if (!Number.isFinite(timeoutMs)) return false;
  if (Date.now() < timeoutMs) return false;

  if (isTerminalStatus(childRun.status) && childRun.finishedAt) {
    return childRun.finishedAt.getTime() > timeoutMs;
  }

  return true;
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

  if (attempt.kind !== "workflow") {
    return null;
  }

  const timeoutAt =
    getWorkflowTimeoutAt(attempt) ??
    defaultWorkflowTimeoutAt(attempt.createdAt);
  if (Number.isFinite(timeoutAt.getTime())) {
    return timeoutAt;
  }

  // Backward compatibility for malformed historical workflow timeout values.
  return defaultWorkflowTimeoutAt(attempt.createdAt);
}

/**
 * Compute the earliest wake-up timestamp across running wait step attempts.
 * @param attempts - Persisted step attempts for the workflow run
 * @returns Earliest wake-up timestamp, or null when no running wait exists
 */
function getEarliestRunningWaitResumeAt(
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
 * Complete running sleep step attempts whose resume timestamp has elapsed.
 * Malformed historical resume timestamps are treated as elapsed for backward
 * compatibility.
 * @param options - Sleep pre-pass options
 * @returns Whether any running sleep remains pending after completion pass
 */
async function completeElapsedRunningSleepAttempts(
  options: Readonly<{
    backend: Backend;
    workflowRunId: string;
    workerId: string;
    attempts: StepAttempt[];
  }>,
): Promise<boolean> {
  let hasPendingRunningSleep = false;

  for (let i = 0; i < options.attempts.length; i += 1) {
    const attempt = options.attempts[i];
    if (!attempt) continue;

    if (
      attempt.status !== "running" ||
      attempt.kind !== "sleep" ||
      attempt.context?.kind !== "sleep"
    ) {
      continue;
    }

    const resumeAt = new Date(attempt.context.resumeAt);
    const resumeAtMs = resumeAt.getTime();
    if (Number.isFinite(resumeAtMs) && Date.now() < resumeAtMs) {
      hasPendingRunningSleep = true;
      continue;
    }

    const completed = await options.backend.completeStepAttempt({
      workflowRunId: options.workflowRunId,
      stepAttemptId: attempt.id,
      workerId: options.workerId,
      output: null,
    });

    options.attempts[i] = completed;
  }

  return hasPendingRunningSleep;
}

/**
 * Load all step attempts for a workflow run.
 * @param backend - Backend instance
 * @param workflowRunId - Workflow run id
 * @returns All step attempts for the workflow run
 * @throws {StepLimitExceededError} When step-attempt count exceeds the limit
 */
async function listAllStepAttemptsForWorkflowRun(
  backend: Readonly<Backend>,
  workflowRunId: string,
): Promise<StepAttempt[]> {
  const attempts: StepAttempt[] = [];
  let cursor: string | undefined;
  do {
    const response = await backend.listStepAttempts({
      workflowRunId,
      ...(cursor ? { after: cursor } : {}),
      limit: WORKFLOW_STEP_LIMIT,
    });
    attempts.push(...response.data);
    if (attempts.length > WORKFLOW_STEP_LIMIT) {
      throw new StepLimitExceededError(WORKFLOW_STEP_LIMIT, attempts.length);
    }
    cursor = response.pagination.next ?? undefined;
  } while (cursor);

  return attempts;
}

/**
 * Build deterministic idempotency key for child workflow invocation.
 * @param attempt - Parent workflow step attempt
 * @returns Stable idempotency key
 */
function buildWorkflowIdempotencyKey(attempt: Readonly<StepAttempt>): string {
  return `__workflow:${attempt.namespaceId}:${attempt.id}`;
}

/**
 * Configures the options for a StepExecutor.
 */
export interface StepExecutorOptions {
  backend: Backend;
  workflowRunId: string;
  workerId: string;
  attempts: StepAttempt[];
  stepLimit?: number;
  executionFence: ExecutionFenceController;
}

interface RunWorkflowStepRequest<
  Input = unknown,
  Output = unknown,
  RunInput = Input,
> {
  workflowSpec: WorkflowSpec<Input, Output, RunInput>;
  input: RunInput | undefined;
  timeout: number | string | Date | undefined;
}

/**
 * Replays prior step attempts and persists new ones while memoizing
 * deterministic step outputs.
 */
class StepExecutor implements StepApi {
  private readonly backend: Backend;
  private readonly workflowRunId: string;
  private readonly workerId: string;
  private readonly stepLimit: number;
  private stepCount: number;
  private cache: StepAttemptCache;
  private readonly failedCountsByStepName: Map<string, number>;
  private readonly failedByStepName: Map<string, StepAttempt>;
  private readonly runningByStepName: Map<string, StepAttempt>;
  private readonly expectedNextStepIndexByName: Map<string, number>;
  private readonly resolvedStepNames: Set<string>;
  private readonly executionFence: ExecutionFenceController;

  constructor(options: Readonly<StepExecutorOptions>) {
    this.backend = options.backend;
    this.workflowRunId = options.workflowRunId;
    this.workerId = options.workerId;
    this.stepLimit = Math.max(1, options.stepLimit ?? WORKFLOW_STEP_LIMIT);
    this.stepCount = options.attempts.length;

    const state = createStepExecutionStateFromAttempts(options.attempts);
    this.cache = state.cache;
    this.failedCountsByStepName = new Map(state.failedCountsByStepName);
    this.failedByStepName = new Map(state.failedByStepName);
    this.runningByStepName = new Map(state.runningByStepName);
    this.expectedNextStepIndexByName = new Map();
    this.resolvedStepNames = new Set();
    this.executionFence = options.executionFence;
  }

  private assertExecutionActive(): void {
    this.executionFence.assertActive();
  }

  /**
   * Resolve the earliest known wake-up timestamp for running wait attempts in
   * this execution pass.
   * @param fallbackResumeAt - Candidate wake-up timestamp for the current wait
   * @returns Earliest known wake-up timestamp
   */
  private resolveEarliestRunningWaitResumeAt(
    fallbackResumeAt: Readonly<Date>,
  ): Date {
    const earliestRunningWaitResumeAt = getEarliestRunningWaitResumeAt([
      ...this.runningByStepName.values(),
    ]);
    if (!earliestRunningWaitResumeAt) {
      return new Date(fallbackResumeAt);
    }

    const fallbackMs = fallbackResumeAt.getTime();
    if (!Number.isFinite(fallbackMs)) {
      return earliestRunningWaitResumeAt;
    }

    if (earliestRunningWaitResumeAt.getTime() < fallbackMs) {
      return earliestRunningWaitResumeAt;
    }

    return new Date(fallbackResumeAt);
  }

  /**
   * Resolve a step name to a deterministic, unique key for this workflow
   * execution pass. When a name collides, suffixes are appended as
   * `name:1`, `name:2`, etc. If those suffixes already exist (including
   * user-provided names), indexing continues until an unused name is found.
   * @param stepName - User-provided step name
   * @returns Resolved step name used for durable step state
   */
  private resolveStepName(stepName: string): string {
    if (!this.resolvedStepNames.has(stepName)) {
      this.resolvedStepNames.add(stepName);
      return stepName;
    }

    const expectedNextIndex =
      this.expectedNextStepIndexByName.get(stepName) ?? 1;
    for (let index = expectedNextIndex; ; index += 1) {
      const resolvedName = `${stepName}:${String(index)}`;
      if (this.resolvedStepNames.has(resolvedName)) {
        continue;
      }

      this.expectedNextStepIndexByName.set(stepName, index + 1);
      this.resolvedStepNames.add(resolvedName);
      return resolvedName;
    }
  }

  // ---- step.run -----------------------------------------------------------

  async run<Output>(
    config: Readonly<StepFunctionConfig>,
    fn: StepFunction<Output>,
  ): Promise<Output> {
    const { name: baseStepName, retryPolicy: retryPolicyOverride } = config;
    const stepName = this.resolveStepName(baseStepName);

    // return cached result if available
    const existingAttempt = getCachedStepAttempt(this.cache, stepName);
    if (existingAttempt) {
      return existingAttempt.output as Output;
    }

    // not in cache, create new step attempt
    this.assertExecutionActive();
    this.ensureStepLimitNotReached();
    const attempt = await this.backend.createStepAttempt({
      workflowRunId: this.workflowRunId,
      workerId: this.workerId,
      stepName,
      kind: "function",
      config: {},
      context: null,
    });

    this.stepCount += 1;
    this.runningByStepName.set(stepName, attempt);

    try {
      // execute step function
      const result = await fn();
      const output = normalizeStepOutput(result);

      // mark success
      const savedAttempt = await this.backend.completeStepAttempt({
        workflowRunId: this.workflowRunId,
        stepAttemptId: attempt.id,
        workerId: this.workerId,
        output,
      });

      // cache result
      this.cache = addToStepAttemptCache(this.cache, savedAttempt);
      this.runningByStepName.delete(stepName);

      return savedAttempt.output as Output;
    } catch (error) {
      return this.failStepWithError(
        stepName,
        attempt.id,
        error,
        resolveStepRetryPolicy(retryPolicyOverride),
      );
    }
  }

  // ---- step.sleep ---------------------------------------------------------

  async sleep(baseStepName: string, duration: DurationString): Promise<void> {
    const stepName = this.resolveStepName(baseStepName);

    // return cached result if this sleep already completed
    const existingAttempt = getCachedStepAttempt(this.cache, stepName);
    if (existingAttempt) return;

    // create new step attempt for the sleep
    const result = calculateDateFromDuration(duration);
    if (!result.ok) {
      throw result.error;
    }
    const resumeAt = result.value;
    const context = createSleepContext(resumeAt);

    this.assertExecutionActive();
    this.ensureStepLimitNotReached();
    const attempt = await this.backend.createStepAttempt({
      workflowRunId: this.workflowRunId,
      workerId: this.workerId,
      stepName,
      kind: "sleep",
      config: {},
      context,
    });
    this.stepCount += 1;
    this.runningByStepName.set(stepName, attempt);

    // throw sleep signal to trigger postponement
    // we do not mark the step as completed here; it will be updated
    // when the workflow resumes
    throw new SleepSignal(this.resolveEarliestRunningWaitResumeAt(resumeAt));
  }

  // ---- step.runWorkflow -----------------------------------------------

  async runWorkflow<Input, Output, RunInput = Input>(
    spec: WorkflowSpec<Input, Output, RunInput>,
    input?: RunInput,
    options?: Readonly<StepRunWorkflowOptions>,
  ): Promise<Output> {
    const stepName = this.resolveStepName(options?.name ?? spec.name);
    const request: RunWorkflowStepRequest<Input, Output, RunInput> = {
      workflowSpec: spec,
      input,
      timeout: options?.timeout,
    };

    const existingAttempt = getCachedStepAttempt(this.cache, stepName);
    if (existingAttempt) {
      return existingAttempt.output as Output;
    }

    // Workflow steps are terminal once a failure is persisted. This prevents
    // replay from spawning duplicate children when Promise.all short-circuits
    // on a sibling SleepSignal in the same pass.
    const failedAttempt = this.failedByStepName.get(stepName);
    if (
      failedAttempt?.kind === "workflow" &&
      failedAttempt.childWorkflowRunNamespaceId &&
      failedAttempt.childWorkflowRunId
    ) {
      const serializedFailedError = failedAttempt.error;
      const failedError =
        serializedFailedError &&
        typeof serializedFailedError === "object" &&
        "message" in serializedFailedError &&
        typeof serializedFailedError["message"] === "string"
          ? deserializeError(serializedFailedError as SerializedError)
          : new Error(`Workflow step "${stepName}" previously failed`);
      throw new StepError({
        stepName,
        stepFailedAttempts: this.failedCountsByStepName.get(stepName) ?? 1,
        retryPolicy: WORKFLOW_STEP_FAILURE_RETRY_POLICY,
        error: failedError,
      });
    }

    // Resume a running workflow attempt (replay path)
    const runningAttempt = this.runningByStepName.get(stepName);
    if (runningAttempt?.kind === "workflow") {
      return await this.resolveRunningWorkflow(
        stepName,
        runningAttempt,
        request,
      );
    }

    // First encounter — create the workflow step and child workflow run
    const timeoutAt = resolveWorkflowTimeoutAt(request.timeout);
    this.assertExecutionActive();
    this.ensureStepLimitNotReached();
    const attempt = await this.backend.createStepAttempt({
      workflowRunId: this.workflowRunId,
      workerId: this.workerId,
      stepName,
      kind: "workflow",
      config: {},
      context: createWorkflowContext(timeoutAt),
    });
    this.stepCount += 1;
    this.runningByStepName.set(stepName, attempt);

    const linkedAttempt = await this.linkChildWorkflowRun(
      stepName,
      attempt,
      request,
    ).catch(
      async (error: unknown) =>
        await this.failWorkflowStepUnlessStale(stepName, attempt.id, error),
    );

    return await this.resolveRunningWorkflow(stepName, linkedAttempt, request);
  }

  /**
   * Resolve a running workflow attempt — check child status and either complete,
   * fail, or go back to sleep.
   * @param stepName - Workflow step name
   * @param runningAttempt - Previously created workflow step attempt
   * @param request - Workflow step request
   * @returns The child workflow output when available
   */
  private async resolveRunningWorkflow<Input, Output, RunInput = Input>(
    stepName: string,
    runningAttempt: Readonly<StepAttempt>,
    request: Readonly<RunWorkflowStepRequest<Input, Output, RunInput>>,
  ): Promise<Output> {
    // Ensure the workflow attempt has a linked child (may need to create one if
    // a previous attempt crashed before linking)
    const workflowAttempt =
      runningAttempt.childWorkflowRunId &&
      runningAttempt.childWorkflowRunNamespaceId
        ? runningAttempt
        : await this.linkChildWorkflowRun(stepName, runningAttempt, request);

    const childId = workflowAttempt.childWorkflowRunId;
    if (!childId) {
      return await this.failStepWithError(
        stepName,
        workflowAttempt.id,
        new Error(
          `Workflow step "${stepName}" could not find linked child workflow run`,
        ),
        WORKFLOW_STEP_FAILURE_RETRY_POLICY,
      );
    }

    const childRun = await this.backend.getWorkflowRun({
      workflowRunId: childId,
    });
    if (!childRun) {
      return await this.failStepWithError(
        stepName,
        workflowAttempt.id,
        new Error(
          `Workflow step "${stepName}" could not find linked child workflow run "${childId}"`,
        ),
        WORKFLOW_STEP_FAILURE_RETRY_POLICY,
      );
    }

    // Check timeout before checking child result
    if (hasWorkflowTimedOut(workflowAttempt, childRun)) {
      return await this.failStepWithError(
        stepName,
        workflowAttempt.id,
        new Error("Timed out waiting for child workflow to complete"),
        WORKFLOW_STEP_FAILURE_RETRY_POLICY,
      );
    }

    // Child completed successfully — propagate result
    if (childRun.status === "completed" || childRun.status === "succeeded") {
      const completed = await this.backend.completeStepAttempt({
        workflowRunId: this.workflowRunId,
        stepAttemptId: workflowAttempt.id,
        workerId: this.workerId,
        output: childRun.output,
      });
      this.runningByStepName.delete(stepName);
      this.cache = addToStepAttemptCache(this.cache, completed);
      return completed.output as Output;
    }

    // Child failed — propagate its error
    if (childRun.status === "failed") {
      const childError =
        childRun.error === null
          ? new Error(`Child workflow run "${childRun.id}" failed`)
          : deserializeError(childRun.error);
      return await this.failStepWithError(
        stepName,
        workflowAttempt.id,
        childError,
        WORKFLOW_STEP_FAILURE_RETRY_POLICY,
      );
    }

    // Child canceled — propagate as error
    if (childRun.status === "canceled") {
      return await this.failStepWithError(
        stepName,
        workflowAttempt.id,
        new Error(
          `Workflow step "${stepName}" failed because child workflow run "${childRun.id}" was canceled`,
        ),
        WORKFLOW_STEP_FAILURE_RETRY_POLICY,
      );
    }

    // Child still running — sleep until timeout
    const timeoutAt = getWorkflowTimeoutAt(workflowAttempt);
    const resumeAt =
      timeoutAt && Number.isFinite(timeoutAt.getTime())
        ? timeoutAt
        : defaultWorkflowTimeoutAt(workflowAttempt.createdAt);
    throw new SleepSignal(this.resolveEarliestRunningWaitResumeAt(resumeAt));
  }

  /**
   * Create (or dedupe) the child workflow run and persist the linkage on the
   * parent workflow step attempt.
   * @param stepName - Parent workflow step name
   * @param attempt - Parent workflow step attempt
   * @param request - Workflow step request
   * @returns Updated step attempt with child linkage
   */
  private async linkChildWorkflowRun<Input, Output, RunInput = Input>(
    stepName: string,
    attempt: Readonly<StepAttempt>,
    request: Readonly<RunWorkflowStepRequest<Input, Output, RunInput>>,
  ): Promise<StepAttempt> {
    this.assertExecutionActive();
    const validationResult = await validateInput(
      request.workflowSpec.schema,
      request.input,
    );
    if (!validationResult.success) {
      throw new Error(validationResult.error);
    }
    const parsedInput = validationResult.value;

    const childRun = await this.backend.createWorkflowRun({
      workflowName: request.workflowSpec.name,
      version: request.workflowSpec.version ?? null,
      idempotencyKey: buildWorkflowIdempotencyKey(attempt),
      config: {},
      context: null,
      input: normalizeStepOutput(parsedInput),
      parentStepAttemptNamespaceId: attempt.namespaceId,
      parentStepAttemptId: attempt.id,
      availableAt: null,
      deadlineAt: null,
    });

    this.assertExecutionActive();
    const linked = await this.backend.setStepAttemptChildWorkflowRun({
      workflowRunId: this.workflowRunId,
      stepAttemptId: attempt.id,
      workerId: this.workerId,
      childWorkflowRunNamespaceId: childRun.namespaceId,
      childWorkflowRunId: childRun.id,
    });
    this.runningByStepName.set(stepName, linked);

    return linked;
  }

  /**
   * Record a step failure, update the failed-attempt counter, and throw a
   * StepError. Shared by both `step.run` failures and workflow failures.
   * @param stepName - Step name
   * @param stepAttemptId - Step attempt id
   * @param error - Error that caused the failure
   * @param retryPolicy - Retry policy for this failure
   */
  private async failStepWithError(
    stepName: string,
    stepAttemptId: string,
    error: unknown,
    retryPolicy: RetryPolicy,
  ): Promise<never> {
    if (!this.executionFence.isActive()) {
      throw new StaleExecutionBranchError();
    }

    this.runningByStepName.delete(stepName);
    let failedAttempt: StepAttempt;
    try {
      failedAttempt = await this.backend.failStepAttempt({
        workflowRunId: this.workflowRunId,
        stepAttemptId,
        workerId: this.workerId,
        error: serializeError(error),
      });
    } catch (stepFailError) {
      if (!this.executionFence.isActive()) {
        throw new StaleExecutionBranchError();
      }
      throw stepFailError;
    }

    const stepFailedAttempts =
      (this.failedCountsByStepName.get(stepName) ?? 0) + 1;
    this.failedCountsByStepName.set(stepName, stepFailedAttempts);
    this.failedByStepName.set(stepName, failedAttempt);

    throw new StepError({
      stepName,
      stepFailedAttempts,
      retryPolicy,
      error,
    });
  }

  private async failWorkflowStepUnlessStale(
    stepName: string,
    stepAttemptId: string,
    error: unknown,
  ): Promise<never> {
    if (error instanceof StaleExecutionBranchError) {
      throw error;
    }

    if (!this.executionFence.isActive()) {
      throw new StaleExecutionBranchError();
    }

    return await this.failStepWithError(
      stepName,
      stepAttemptId,
      error,
      WORKFLOW_STEP_FAILURE_RETRY_POLICY,
    );
  }

  private ensureStepLimitNotReached(): void {
    if (this.stepCount >= this.stepLimit) {
      throw new StepLimitExceededError(this.stepLimit, this.stepCount);
    }
  }
}

/**
 * Execute a workflow-run transition and swallow expected stale-write races when
 * this worker no longer owns an actively running execution.
 * @param options - Transition execution options
 */
async function executeWorkflowRunTransition(
  options: Readonly<{
    backend: Backend;
    workflowRunId: string;
    workerId: string;
    transition: () => Promise<unknown>;
  }>,
): Promise<void> {
  try {
    await options.transition();
  } catch (error) {
    let currentRun: WorkflowRun | null = null;

    try {
      currentRun = await options.backend.getWorkflowRun({
        workflowRunId: options.workflowRunId,
      });
    } catch {
      throw error;
    }

    if (
      currentRun &&
      (currentRun.status !== "running" ||
        currentRun.workerId !== options.workerId)
    ) {
      return;
    }

    throw error;
  }
}

/**
 * Parameters for the workflow execution use case.
 */
export interface ExecuteWorkflowParams {
  backend: Backend;
  workflowRun: WorkflowRun;
  workflowFn: WorkflowFunction<unknown, unknown>;
  workflowVersion: string | null;
  workerId: string;
  retryPolicy: RetryPolicy;
}

/**
 * Execute a workflow run. This is the core application use case that handles:
 * - Loading step history
 * - Handling paused (sleep/runWorkflow wait) steps
 * - Creating the step executor
 * - Executing the workflow function
 * - Completing, failing, or parking the workflow run based on the outcome
 * @param params - The execution parameters
 */
// eslint-disable-next-line sonarjs/cognitive-complexity
export async function executeWorkflow(
  params: Readonly<ExecuteWorkflowParams>,
): Promise<void> {
  const { backend, workflowRun, workflowFn, workflowVersion, workerId } =
    params;
  const executionFence = new ExecutionFence();

  try {
    // load all pages of step history
    const attempts = await listAllStepAttemptsForWorkflowRun(
      backend,
      workflowRun.id,
    );

    // complete any elapsed sleep waits first, then park on the earliest
    // remaining running wait (sleep or runWorkflow timeout).
    const hasPendingRunningSleep = await completeElapsedRunningSleepAttempts({
      backend,
      workflowRunId: workflowRun.id,
      workerId,
      attempts,
    });

    if (hasPendingRunningSleep) {
      const earliestRunningWaitResumeAt =
        getEarliestRunningWaitResumeAt(attempts);
      if (
        earliestRunningWaitResumeAt &&
        Date.now() < earliestRunningWaitResumeAt.getTime()
      ) {
        throw new SleepSignal(earliestRunningWaitResumeAt);
      }
    }

    const executor = new StepExecutor({
      backend,
      workflowRunId: workflowRun.id,
      workerId,
      attempts,
      executionFence,
    });

    const run = Object.freeze<WorkflowRunMetadata>({
      id: workflowRun.id,
      workflowName: workflowRun.workflowName,
      createdAt: workflowRun.createdAt,
      startedAt: workflowRun.startedAt,
    });

    // execute workflow
    const output = await workflowFn({
      input: workflowRun.input as unknown,
      step: executor,
      version: workflowVersion,
      run,
    });

    // mark success
    executionFence.deactivate();
    await executeWorkflowRunTransition({
      backend,
      workflowRunId: workflowRun.id,
      workerId,
      transition: async () => {
        await backend.completeWorkflowRun({
          workflowRunId: workflowRun.id,
          workerId,
          output: (output ?? null) as JsonValue,
        });
      },
    });
  } catch (error) {
    executionFence.deactivate();

    // handle sleep signal by parking the workflow in running status
    if (error instanceof SleepSignal) {
      await executeWorkflowRunTransition({
        backend,
        workflowRunId: workflowRun.id,
        workerId,
        transition: async () => {
          await backend.sleepWorkflowRun({
            workflowRunId: workflowRun.id,
            workerId,
            availableAt: error.resumeAt,
          });
        },
      });

      return;
    }

    if (error instanceof StepLimitExceededError) {
      await executeWorkflowRunTransition({
        backend,
        workflowRunId: workflowRun.id,
        workerId,
        transition: async () => {
          await backend.failWorkflowRun({
            workflowRunId: workflowRun.id,
            workerId,
            error: serializeStepLimitExceededError(error),
            retryPolicy: DEFAULT_WORKFLOW_RETRY_POLICY,
            attempts: workflowRun.attempts,
            deadlineAt: workflowRun.deadlineAt,
          });
        },
      });
      return;
    }

    // handle step error
    if (error instanceof StepError) {
      const serializedError = serializeError(error.originalError);
      const retryDecision = computeFailedWorkflowRunUpdate(
        error.retryPolicy,
        error.stepFailedAttempts,
        workflowRun.deadlineAt,
        serializedError,
        new Date(),
      );

      if (retryDecision.status === "failed") {
        await executeWorkflowRunTransition({
          backend,
          workflowRunId: workflowRun.id,
          workerId,
          transition: async () => {
            await backend.failWorkflowRun({
              workflowRunId: workflowRun.id,
              workerId,
              error: serializedError,
              retryPolicy: DEFAULT_WORKFLOW_RETRY_POLICY,
              attempts: workflowRun.attempts,
              deadlineAt: workflowRun.deadlineAt,
            });
          },
        });
        return;
      }

      /* v8 ignore start -- defensive invariant */
      if (!retryDecision.availableAt) {
        // this should not happen when retry decision isn't failed
        // throw error to avoid silently swallowing retries, which we should
        // catch in tests if anything goes wrong
        throw new Error("Step retry decision missing availableAt");
      }
      /* v8 ignore stop */

      const availableAt = retryDecision.availableAt;

      await executeWorkflowRunTransition({
        backend,
        workflowRunId: workflowRun.id,
        workerId,
        transition: async () => {
          await backend.rescheduleWorkflowRunAfterFailedStepAttempt({
            workflowRunId: workflowRun.id,
            workerId,
            error: serializedError,
            availableAt,
          });
        },
      });
      return;
    }

    if (error instanceof StaleExecutionBranchError) {
      return;
    }

    // mark failure
    await executeWorkflowRunTransition({
      backend,
      workflowRunId: workflowRun.id,
      workerId,
      transition: async () => {
        await backend.failWorkflowRun({
          workflowRunId: workflowRun.id,
          workerId,
          error: serializeError(error),
          retryPolicy: params.retryPolicy,
          attempts: workflowRun.attempts,
          deadlineAt: workflowRun.deadlineAt,
        });
      },
    });
  }
}
