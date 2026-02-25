import type { Backend } from "../core/backend.js";
import type { DurationString } from "../core/duration.js";
import { deserializeError, serializeError } from "../core/error.js";
import type { JsonValue } from "../core/json.js";
import type { StepAttempt, StepAttemptCache } from "../core/step-attempt.js";
import {
  getCachedStepAttempt,
  addToStepAttemptCache,
  normalizeStepOutput,
  calculateDateFromDuration,
  createSleepContext,
  createInvokeContext,
} from "../core/step-attempt.js";
import {
  computeFailedWorkflowRunUpdate,
  DEFAULT_WORKFLOW_RETRY_POLICY,
  type RetryPolicy,
  type Workflow,
  type WorkflowSpec,
} from "../core/workflow-definition.js";
import type {
  InvokeStepConfig,
  StepApi,
  StepFunction,
  StepFunctionConfig,
  WorkflowFunction,
  WorkflowRunMetadata,
} from "../core/workflow-function.js";
import { isTerminalStatus, type WorkflowRun } from "../core/workflow-run.js";

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
 * Retry policy for invoke step failures (no retries - the child workflow
 * is responsible for retries).
 */
const INVOKE_FAILURE_RETRY_POLICY: RetryPolicy = {
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
  const runningByStepName = new Map<string, StepAttempt>();

  for (const attempt of attempts) {
    if (attempt.status === "completed" || attempt.status === "succeeded") {
      cache.set(attempt.stepName, attempt);
      continue;
    }

    if (attempt.status === "failed") {
      const previousCount = failedCountsByStepName.get(attempt.stepName) ?? 0;
      failedCountsByStepName.set(attempt.stepName, previousCount + 1);
      continue;
    }

    runningByStepName.set(attempt.stepName, attempt);
  }

  return {
    cache,
    failedCountsByStepName,
    runningByStepName,
  };
}

/**
 * Resolve invoke timeout input to an absolute deadline.
 * @param timeout - Relative/absolute timeout input
 * @returns Absolute timeout deadline
 * @throws {Error} When timeout is invalid
 */
function resolveInvokeTimeoutAt(
  timeout: number | string | Date | undefined,
): Date {
  if (timeout === undefined) {
    return defaultInvokeTimeoutAt();
  }

  if (timeout instanceof Date) {
    return timeout;
  }

  if (typeof timeout === "number") {
    if (!Number.isFinite(timeout) || timeout < 0) {
      throw new Error("Invoke timeout must be a non-negative number");
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
 * Default invoke timeout: 7 days from a base time.
 * @param base - Base timestamp (defaults to now)
 * @returns Timeout deadline
 */
function defaultInvokeTimeoutAt(base: Readonly<Date> = new Date()): Date {
  const timeoutAt = new Date(base);
  timeoutAt.setDate(timeoutAt.getDate() + 7);
  return timeoutAt;
}

/**
 * Extract the invoke timeout from a persisted step attempt's context.
 * @param attempt - Running invoke step attempt
 * @returns Timeout deadline, or null when context is not invoke
 */
function getInvokeTimeoutAt(attempt: Readonly<StepAttempt>): Date | null {
  if (attempt.context?.kind !== "invoke") {
    return null;
  }

  if (attempt.context.timeoutAt === null) {
    // Backward compatibility for previously persisted invoke contexts.
    return defaultInvokeTimeoutAt(attempt.createdAt);
  }

  return new Date(attempt.context.timeoutAt);
}

/**
 * Determine whether the invoke timeout has elapsed before the child completed.
 * @param attempt - Running invoke step attempt
 * @param childRun - Linked child workflow run
 * @returns True when timeout elapsed before child terminal completion
 */
function hasInvokeTimedOut(
  attempt: Readonly<StepAttempt>,
  childRun: Readonly<WorkflowRun>,
): boolean {
  const timeoutAt = getInvokeTimeoutAt(attempt);
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
 * Normalize a workflow target (string | WorkflowSpec | Workflow) to a
 * WorkflowSpec.
 * @param workflow - Workflow target reference
 * @returns WorkflowSpec for child run creation
 */
function toWorkflowSpec<Input, Output, RunInput>(
  workflow:
    | WorkflowSpec<Input, Output, RunInput>
    | Workflow<Input, Output, RunInput>
    | string,
): WorkflowSpec<Input, Output, RunInput> {
  if (typeof workflow === "string") {
    return { name: workflow };
  }
  return "spec" in workflow ? workflow.spec : workflow;
}

/**
 * Build deterministic idempotency key for child workflow invocation.
 * @param attempt - Parent invoke step attempt
 * @returns Stable idempotency key
 */
function buildInvokeIdempotencyKey(attempt: Readonly<StepAttempt>): string {
  return `__invoke:${attempt.namespaceId}:${attempt.id}`;
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
  private readonly runningByStepName: Map<string, StepAttempt>;

  constructor(options: Readonly<StepExecutorOptions>) {
    this.backend = options.backend;
    this.workflowRunId = options.workflowRunId;
    this.workerId = options.workerId;
    this.stepLimit = Math.max(1, options.stepLimit ?? WORKFLOW_STEP_LIMIT);
    this.stepCount = options.attempts.length;

    const state = createStepExecutionStateFromAttempts(options.attempts);
    this.cache = state.cache;
    this.failedCountsByStepName = new Map(state.failedCountsByStepName);
    this.runningByStepName = new Map(state.runningByStepName);
  }

  // ---- step.run -----------------------------------------------------------

  async run<Output>(
    config: Readonly<StepFunctionConfig>,
    fn: StepFunction<Output>,
  ): Promise<Output> {
    const { name, retryPolicy: retryPolicyOverride } = config;

    // return cached result if available
    const existingAttempt = getCachedStepAttempt(this.cache, name);
    if (existingAttempt) {
      return existingAttempt.output as Output;
    }

    // not in cache, create new step attempt
    this.ensureStepLimitNotReached();
    const attempt = await this.backend.createStepAttempt({
      workflowRunId: this.workflowRunId,
      workerId: this.workerId,
      stepName: name,
      kind: "function",
      config: {},
      context: null,
    });
    this.stepCount += 1;
    this.runningByStepName.set(name, attempt);

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
      this.runningByStepName.delete(name);

      return savedAttempt.output as Output;
    } catch (error) {
      // mark failure
      this.runningByStepName.delete(name);
      await this.backend.failStepAttempt({
        workflowRunId: this.workflowRunId,
        stepAttemptId: attempt.id,
        workerId: this.workerId,
        error: serializeError(error),
      });

      const stepFailedAttempts =
        (this.failedCountsByStepName.get(name) ?? 0) + 1;
      this.failedCountsByStepName.set(name, stepFailedAttempts);

      throw new StepError({
        stepName: name,
        stepFailedAttempts,
        retryPolicy: resolveStepRetryPolicy(retryPolicyOverride),
        error,
      });
    }
  }

  // ---- step.sleep ---------------------------------------------------------

  async sleep(name: string, duration: DurationString): Promise<void> {
    // return cached result if this sleep already completed
    const existingAttempt = getCachedStepAttempt(this.cache, name);
    if (existingAttempt) return;

    // create new step attempt for the sleep
    const result = calculateDateFromDuration(duration);
    if (!result.ok) {
      throw result.error;
    }
    const resumeAt = result.value;
    const context = createSleepContext(resumeAt);

    this.ensureStepLimitNotReached();
    await this.backend.createStepAttempt({
      workflowRunId: this.workflowRunId,
      workerId: this.workerId,
      stepName: name,
      kind: "sleep",
      config: {},
      context,
    });
    this.stepCount += 1;

    // throw sleep signal to trigger postponement
    // we do not mark the step as completed here; it will be updated
    // when the workflow resumes
    throw new SleepSignal(resumeAt);
  }

  // ---- step.invokeWorkflow -----------------------------------------------

  async invokeWorkflow<Output, Input, RunInput = Input>(
    stepName: string,
    opts: Readonly<InvokeStepConfig<Input, Output, RunInput>>,
  ): Promise<Output> {
    const existingAttempt = getCachedStepAttempt(this.cache, stepName);
    if (existingAttempt) {
      return existingAttempt.output as Output;
    }

    // Resume a running invoke attempt (replay path)
    const runningAttempt = this.runningByStepName.get(stepName);
    if (runningAttempt?.kind === "invoke") {
      return await this.resolveRunningInvoke(stepName, runningAttempt, opts);
    }

    // First encounter — create the invoke step and child workflow run
    const timeoutAt = resolveInvokeTimeoutAt(opts.timeout);
    this.ensureStepLimitNotReached();
    const attempt = await this.backend.createStepAttempt({
      workflowRunId: this.workflowRunId,
      workerId: this.workerId,
      stepName,
      kind: "invoke",
      config: {},
      context: createInvokeContext(timeoutAt),
    });
    this.stepCount += 1;
    this.runningByStepName.set(stepName, attempt);

    const linkedAttempt = await this.linkChildWorkflowRun(
      stepName,
      attempt,
      opts,
    ).catch(
      async (error: unknown) =>
        await this.failStepWithError(
          stepName,
          attempt.id,
          error,
          INVOKE_FAILURE_RETRY_POLICY,
        ),
    );

    return await this.resolveRunningInvoke(stepName, linkedAttempt, opts);
  }

  /**
   * Resolve a running invoke attempt — check child status and either complete,
   * fail, or go back to sleep.
   * @param stepName - Invoke step name
   * @param runningAttempt - Previously created invoke step attempt
   * @param opts - Invoke step configuration
   * @returns The child workflow output when available
   */
  private async resolveRunningInvoke<Output, Input, RunInput = Input>(
    stepName: string,
    runningAttempt: Readonly<StepAttempt>,
    opts: Readonly<InvokeStepConfig<Input, Output, RunInput>>,
  ): Promise<Output> {
    // Ensure the invoke attempt has a linked child (may need to create one if
    // a previous attempt crashed before linking)
    const invokeAttempt =
      runningAttempt.childWorkflowRunId &&
      runningAttempt.childWorkflowRunNamespaceId
        ? runningAttempt
        : await this.linkChildWorkflowRun(stepName, runningAttempt, opts);

    const childId = invokeAttempt.childWorkflowRunId;
    if (!childId) {
      return await this.failStepWithError(
        stepName,
        invokeAttempt.id,
        new Error(
          `Invoke step "${stepName}" could not find linked child workflow run`,
        ),
        INVOKE_FAILURE_RETRY_POLICY,
      );
    }

    const childRun = await this.backend.getWorkflowRun({
      workflowRunId: childId,
    });
    if (!childRun) {
      return await this.failStepWithError(
        stepName,
        invokeAttempt.id,
        new Error(
          `Invoke step "${stepName}" could not find linked child workflow run "${childId}"`,
        ),
        INVOKE_FAILURE_RETRY_POLICY,
      );
    }

    // Check timeout before checking child result
    if (hasInvokeTimedOut(invokeAttempt, childRun)) {
      return await this.failStepWithError(
        stepName,
        invokeAttempt.id,
        new Error("Timed out waiting for invoked workflow to complete"),
        INVOKE_FAILURE_RETRY_POLICY,
      );
    }

    // Child completed successfully — propagate result
    if (childRun.status === "completed" || childRun.status === "succeeded") {
      const completed = await this.backend.completeStepAttempt({
        workflowRunId: this.workflowRunId,
        stepAttemptId: invokeAttempt.id,
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
        invokeAttempt.id,
        childError,
        INVOKE_FAILURE_RETRY_POLICY,
      );
    }

    // Child canceled — propagate as error
    if (childRun.status === "canceled") {
      return await this.failStepWithError(
        stepName,
        invokeAttempt.id,
        new Error(
          `Invoke step "${stepName}" failed because child workflow run "${childRun.id}" was canceled`,
        ),
        INVOKE_FAILURE_RETRY_POLICY,
      );
    }

    // Child still running — sleep until timeout
    const timeoutAt = getInvokeTimeoutAt(invokeAttempt);
    throw new SleepSignal(
      timeoutAt ?? defaultInvokeTimeoutAt(invokeAttempt.createdAt),
    );
  }

  /**
   * Create (or dedupe) the child workflow run and persist the linkage on the
   * parent invoke step attempt.
   * @param stepName - Parent invoke step name
   * @param attempt - Parent invoke step attempt
   * @param opts - Invoke step configuration
   * @returns Updated step attempt with child linkage
   */
  private async linkChildWorkflowRun<Output, Input, RunInput = Input>(
    stepName: string,
    attempt: Readonly<StepAttempt>,
    opts: Readonly<InvokeStepConfig<Input, Output, RunInput>>,
  ): Promise<StepAttempt> {
    const workflow = opts.workflow;
    if (typeof workflow === "string" && workflow.length === 0) {
      throw new Error("Invoke workflow target must be a non-empty string");
    }

    const spec = toWorkflowSpec(workflow);
    const childRun = await this.backend.createWorkflowRun({
      workflowName: spec.name,
      version: spec.version ?? null,
      idempotencyKey: buildInvokeIdempotencyKey(attempt),
      config: {},
      context: null,
      input: normalizeStepOutput(opts.input),
      parentStepAttemptNamespaceId: attempt.namespaceId,
      parentStepAttemptId: attempt.id,
      availableAt: null,
      deadlineAt: null,
    });

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
   * StepError. Shared by both `step.run` failures and invoke failures.
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
    this.runningByStepName.delete(stepName);
    await this.backend.failStepAttempt({
      workflowRunId: this.workflowRunId,
      stepAttemptId,
      workerId: this.workerId,
      error: serializeError(error),
    });

    const stepFailedAttempts =
      (this.failedCountsByStepName.get(stepName) ?? 0) + 1;
    this.failedCountsByStepName.set(stepName, stepFailedAttempts);

    throw new StepError({
      stepName,
      stepFailedAttempts,
      retryPolicy,
      error,
    });
  }

  private ensureStepLimitNotReached(): void {
    if (this.stepCount >= this.stepLimit) {
      throw new StepLimitExceededError(this.stepLimit, this.stepCount);
    }
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
 * - Handling sleeping steps
 * - Creating the step executor
 * - Executing the workflow function
 * - Completing, failing, or sleeping the workflow run based on the outcome
 * @param params - The execution parameters
 */
// eslint-disable-next-line sonarjs/cognitive-complexity
export async function executeWorkflow(
  params: Readonly<ExecuteWorkflowParams>,
): Promise<void> {
  const { backend, workflowRun, workflowFn, workflowVersion, workerId } =
    params;

  try {
    // load all pages of step history
    const attempts: StepAttempt[] = [];
    let cursor: string | undefined;
    do {
      const response = await backend.listStepAttempts({
        workflowRunId: workflowRun.id,
        ...(cursor ? { after: cursor } : {}),
        limit: WORKFLOW_STEP_LIMIT,
      });
      attempts.push(...response.data);
      if (attempts.length >= WORKFLOW_STEP_LIMIT) {
        throw new StepLimitExceededError(WORKFLOW_STEP_LIMIT, attempts.length);
      }
      cursor = response.pagination.next ?? undefined;
    } while (cursor);

    // mark any sleep steps as completed if their sleep duration has elapsed,
    // or rethrow SleepSignal if still sleeping
    for (let i = 0; i < attempts.length; i++) {
      const attempt = attempts[i];
      if (!attempt) continue;

      if (
        attempt.status === "running" &&
        attempt.kind === "sleep" &&
        attempt.context?.kind === "sleep"
      ) {
        const now = Date.now();
        const resumeAt = new Date(attempt.context.resumeAt);
        const resumeAtMs = resumeAt.getTime();

        if (now < resumeAtMs) {
          // sleep duration HAS NOT elapsed yet, throw signal to put workflow
          // back to sleep
          throw new SleepSignal(resumeAt);
        }

        // sleep duration HAS elapsed, mark the step as completed and continue
        const completed = await backend.completeStepAttempt({
          workflowRunId: workflowRun.id,
          stepAttemptId: attempt.id,
          workerId,
          output: null,
        });

        // update cache w/ completed attempt
        attempts[i] = completed;
      }
    }

    const executor = new StepExecutor({
      backend,
      workflowRunId: workflowRun.id,
      workerId,
      attempts,
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
    await backend.completeWorkflowRun({
      workflowRunId: workflowRun.id,
      workerId,
      output: (output ?? null) as JsonValue,
    });
  } catch (error) {
    // handle sleep signal by setting workflow to sleeping status
    if (error instanceof SleepSignal) {
      await backend.sleepWorkflowRun({
        workflowRunId: workflowRun.id,
        workerId,
        availableAt: error.resumeAt,
      });

      return;
    }

    if (error instanceof StepLimitExceededError) {
      await backend.failWorkflowRun({
        workflowRunId: workflowRun.id,
        workerId,
        error: serializeStepLimitExceededError(error),
        retryPolicy: DEFAULT_WORKFLOW_RETRY_POLICY,
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
        await backend.failWorkflowRun({
          workflowRunId: workflowRun.id,
          workerId,
          error: serializedError,
          retryPolicy: DEFAULT_WORKFLOW_RETRY_POLICY,
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

      await backend.rescheduleWorkflowRunAfterFailedStepAttempt({
        workflowRunId: workflowRun.id,
        workerId,
        error: serializedError,
        availableAt: retryDecision.availableAt,
      });
      return;
    }

    // mark failure
    await backend.failWorkflowRun({
      workflowRunId: workflowRun.id,
      workerId,
      error: serializeError(error),
      retryPolicy: params.retryPolicy,
    });
  }
}
