import type { Backend } from "../core/backend.js";
import type { DurationString } from "../core/duration.js";
import {
  deserializeError,
  serializeError,
  type SerializedError,
} from "../core/error.js";
import type { JsonValue } from "../core/json.js";
import type { StandardSchemaV1 } from "../core/standard-schema.js";
import type { StepAttempt } from "../core/step-attempt.js";
import {
  normalizeStepOutput,
  calculateDateFromDuration,
  createSleepContext,
  createWorkflowContext,
  createSignalWaitContext,
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
  StepWaitTimeout,
  WorkflowFunction,
} from "../core/workflow-function.js";
import {
  isTerminalStatus,
  validateInput,
  type WorkflowRun,
} from "../core/workflow-run.js";
import {
  defaultWaitTimeoutAt,
  getContextTimeoutAt,
  StepHistory,
  StepLimitExceededError,
  WORKFLOW_STEP_LIMIT,
} from "./step-history.js";

export {
  WORKFLOW_STEP_LIMIT,
  STEP_LIMIT_EXCEEDED_ERROR_CODE,
  createStepExecutionStateFromAttempts,
  type StepExecutionState,
} from "./step-history.js";

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
 * No-retry policy for terminal/non-retryable steps (child-workflow results,
 * signal sends, signal waits). The caller or child workflow is responsible
 * for handling retries.
 */
const TERMINAL_STEP_RETRY_POLICY: RetryPolicy = {
  ...DEFAULT_STEP_RETRY_POLICY,
  maximumAttempts: 1,
};

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
 * Resolve wait timeout input to an absolute deadline.
 * @param timeout - Relative/absolute timeout input
 * @returns Absolute timeout deadline
 * @throws {Error} When timeout is invalid
 */
function resolveWaitTimeoutAt(
  timeout: number | string | Date | undefined,
): Date {
  if (timeout === undefined) {
    return defaultWaitTimeoutAt();
  }

  if (timeout instanceof Date) {
    return timeout;
  }

  if (typeof timeout === "number") {
    if (!Number.isFinite(timeout) || timeout < 0) {
      throw new Error("Timeout must be a non-negative number");
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
 * Determine whether the workflow timeout has elapsed before the child completed.
 * @param attempt - Running workflow step attempt
 * @param childRun - Linked child workflow run
 * @returns True when timeout elapsed before child terminal completion
 */
function hasWorkflowTimedOut(
  attempt: Readonly<StepAttempt>,
  childRun: Readonly<WorkflowRun>,
): boolean {
  const timeoutAt = getContextTimeoutAt(attempt);
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
    history: StepHistory;
  }>,
): Promise<boolean> {
  let hasPendingRunningSleep = false;

  // Snapshot running attempts since we mutate history during iteration.
  const running = [...options.history.runningAttempts()];

  for (const attempt of running) {
    if (attempt.kind !== "sleep" || attempt.context?.kind !== "sleep") {
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

    options.history.recordCompletion(completed);
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
 * Build deterministic idempotency key for signal send invocation.
 * @param workflowRunId - Workflow run id
 * @param stepName - Step name
 * @returns Stable idempotency key
 */
function buildSignalIdempotencyKey(
  workflowRunId: string,
  stepName: string,
): string {
  return `__signal:${workflowRunId}:${stepName}`;
}

/**
 * Configures the options for a StepExecutor.
 */
export interface StepExecutorOptions {
  backend: Backend;
  workflowRunId: string;
  workerId: string;
  history: StepHistory;
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
  private readonly history: StepHistory;
  private readonly executionFence: ExecutionFenceController;

  constructor(options: Readonly<StepExecutorOptions>) {
    this.backend = options.backend;
    this.workflowRunId = options.workflowRunId;
    this.workerId = options.workerId;
    this.history = options.history;
    this.executionFence = options.executionFence;
  }

  private assertExecutionActive(): void {
    this.executionFence.assertActive();
  }

  // ---- step.run -----------------------------------------------------------

  async run<Output>(
    config: Readonly<StepFunctionConfig>,
    fn: StepFunction<Output>,
  ): Promise<Output> {
    const { name: baseStepName, retryPolicy: retryPolicyOverride } = config;
    const stepName = this.history.resolveStepName(baseStepName);

    const existingAttempt = this.history.findCached(stepName);
    if (existingAttempt) {
      return existingAttempt.output as Output;
    }

    this.assertExecutionActive();
    this.history.ensureCanRecordNewAttempt();
    const attempt = await this.backend.createStepAttempt({
      workflowRunId: this.workflowRunId,
      workerId: this.workerId,
      stepName,
      kind: "function",
      config: {},
      context: null,
    });
    this.history.recordNewAttempt(attempt);

    try {
      const result = await fn();
      const output = normalizeStepOutput(result);
      const savedAttempt = await this.backend.completeStepAttempt({
        workflowRunId: this.workflowRunId,
        stepAttemptId: attempt.id,
        workerId: this.workerId,
        output,
      });
      this.history.recordCompletion(savedAttempt);
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
    const stepName = this.history.resolveStepName(baseStepName);

    if (this.history.findCached(stepName)) return;

    const result = calculateDateFromDuration(duration);
    if (!result.ok) {
      throw result.error;
    }
    const resumeAt = result.value;
    const context = createSleepContext(resumeAt);

    this.assertExecutionActive();
    this.history.ensureCanRecordNewAttempt();
    const attempt = await this.backend.createStepAttempt({
      workflowRunId: this.workflowRunId,
      workerId: this.workerId,
      stepName,
      kind: "sleep",
      config: {},
      context,
    });
    this.history.recordNewAttempt(attempt);

    // Sleep attempts are not marked completed here — that happens when the
    // workflow resumes.
    throw new SleepSignal(
      this.history.resolveEarliestRunningWaitResumeAt(resumeAt),
    );
  }

  // ---- step.runWorkflow --------------------------------------------------

  async runWorkflow<Input, Output, RunInput = Input>(
    spec: WorkflowSpec<Input, Output, RunInput>,
    input?: RunInput,
    options?: Readonly<StepRunWorkflowOptions>,
  ): Promise<Output> {
    const stepName = this.history.resolveStepName(options?.name ?? spec.name);
    const request: RunWorkflowStepRequest<Input, Output, RunInput> = {
      workflowSpec: spec,
      input,
      timeout: options?.timeout,
    };

    const existingAttempt = this.history.findCached(stepName);
    if (existingAttempt) {
      return existingAttempt.output as Output;
    }

    // Workflow steps are terminal once a failure is persisted. Prevents
    // replay from spawning duplicate children when Promise.all short-circuits
    // on a sibling SleepSignal in the same pass.
    const terminallyFailedAttempt =
      this.history.findTerminallyFailedWorkflow(stepName);
    if (terminallyFailedAttempt) {
      const serializedFailedError = terminallyFailedAttempt.error;
      const failedError =
        serializedFailedError &&
        typeof serializedFailedError === "object" &&
        "message" in serializedFailedError &&
        typeof serializedFailedError["message"] === "string"
          ? deserializeError(serializedFailedError as SerializedError)
          : new Error(`Workflow step "${stepName}" previously failed`);
      throw new StepError({
        stepName,
        stepFailedAttempts: this.history.failedAttemptCount(stepName),
        retryPolicy: TERMINAL_STEP_RETRY_POLICY,
        error: failedError,
      });
    }

    // Resume a running workflow attempt (replay path)
    const runningAttempt = this.history.findRunning(stepName);
    if (runningAttempt?.kind === "workflow") {
      return await this.resolveRunningWorkflow(
        stepName,
        runningAttempt,
        request,
      );
    }

    // First encounter — create the workflow step and child workflow run
    const timeoutAt = resolveWaitTimeoutAt(request.timeout);
    this.assertExecutionActive();
    this.history.ensureCanRecordNewAttempt();
    const attempt = await this.backend.createStepAttempt({
      workflowRunId: this.workflowRunId,
      workerId: this.workerId,
      stepName,
      kind: "workflow",
      config: {},
      context: createWorkflowContext(timeoutAt),
    });
    this.history.recordNewAttempt(attempt);

    const linkedAttempt = await this.linkChildWorkflowRun(
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
        : await this.linkChildWorkflowRun(runningAttempt, request);

    const failWorkflowStep = (error: Error): Promise<never> =>
      this.failStepWithError(
        stepName,
        workflowAttempt.id,
        error,
        TERMINAL_STEP_RETRY_POLICY,
      );

    const childId = workflowAttempt.childWorkflowRunId;
    if (!childId) {
      return await failWorkflowStep(
        new Error(
          `Workflow step "${stepName}" could not find linked child workflow run`,
        ),
      );
    }

    const childRun = await this.backend.getWorkflowRun({
      workflowRunId: childId,
    });
    if (!childRun) {
      return await failWorkflowStep(
        new Error(
          `Workflow step "${stepName}" could not find linked child workflow run "${childId}"`,
        ),
      );
    }

    // Check timeout before checking child result
    if (hasWorkflowTimedOut(workflowAttempt, childRun)) {
      return await failWorkflowStep(
        new Error("Timed out waiting for child workflow to complete"),
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
      this.history.recordCompletion(completed);
      return completed.output as Output;
    }

    // Child failed — propagate its error
    if (childRun.status === "failed") {
      return await failWorkflowStep(
        childRun.error === null
          ? new Error(`Child workflow run "${childRun.id}" failed`)
          : deserializeError(childRun.error),
      );
    }

    // Child canceled — propagate as error
    if (childRun.status === "canceled") {
      return await failWorkflowStep(
        new Error(
          `Workflow step "${stepName}" failed because child workflow run "${childRun.id}" was canceled`,
        ),
      );
    }

    // Child still running — sleep until timeout
    const timeoutAt = getContextTimeoutAt(workflowAttempt);
    const resumeAt =
      timeoutAt && Number.isFinite(timeoutAt.getTime())
        ? timeoutAt
        : defaultWaitTimeoutAt(workflowAttempt.createdAt);
    throw new SleepSignal(
      this.history.resolveEarliestRunningWaitResumeAt(resumeAt),
    );
  }

  /**
   * Create (or dedupe) the child workflow run and persist the linkage on the
   * parent workflow step attempt.
   * @param attempt - Parent workflow step attempt
   * @param request - Workflow step request
   * @returns Updated step attempt with child linkage
   */
  private async linkChildWorkflowRun<Input, Output, RunInput = Input>(
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
    this.history.replaceRunningAttempt(linked);

    return linked;
  }

  /**
   * Record a step failure and throw a StepError. Shared by `step.run`
   * failures, workflow failures, signal-send failures, and signal-wait
   * validation failures.
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

    const stepFailedAttempts = this.history.recordFailedAttempt(failedAttempt);

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
      TERMINAL_STEP_RETRY_POLICY,
    );
  }

  // ---- step.sendSignal ----------------------------------------------------

  async sendSignal(
    options: Readonly<{
      name?: string;
      signal: string;
      data?: JsonValue;
    }>,
  ): Promise<{ workflowRunIds: string[] }> {
    const stepName = this.history.resolveStepName(
      options.name ?? options.signal,
    );

    const existingAttempt = this.history.findCached(stepName);
    if (existingAttempt) {
      return existingAttempt.output as { workflowRunIds: string[] };
    }

    const runningAttempt = this.history.findRunning(stepName);
    if (runningAttempt?.kind === "signal-send") {
      return await this.resolveSignalSend(stepName, runningAttempt, options);
    }

    this.assertExecutionActive();
    this.history.ensureCanRecordNewAttempt();
    const attempt = await this.backend.createStepAttempt({
      workflowRunId: this.workflowRunId,
      workerId: this.workerId,
      stepName,
      kind: "signal-send",
      config: {},
      context: null,
    });
    this.history.recordNewAttempt(attempt);

    return await this.resolveSignalSend(stepName, attempt, options);
  }

  private async resolveSignalSend(
    stepName: string,
    attempt: Readonly<StepAttempt>,
    options: Readonly<{ signal: string; data?: JsonValue }>,
  ): Promise<{ workflowRunIds: string[] }> {
    try {
      const result = await this.backend.sendSignal({
        signal: options.signal,
        data: options.data ?? null,
        idempotencyKey: buildSignalIdempotencyKey(this.workflowRunId, stepName),
      });

      const completed = await this.backend.completeStepAttempt({
        workflowRunId: this.workflowRunId,
        stepAttemptId: attempt.id,
        workerId: this.workerId,
        output: { ...result },
      });
      this.history.recordCompletion(completed);
      return completed.output as { workflowRunIds: string[] };
    } catch (error) {
      return await this.failStepWithError(
        stepName,
        attempt.id,
        error,
        TERMINAL_STEP_RETRY_POLICY,
      );
    }
  }

  // ---- step.waitForSignal ------------------------------------------------

  async waitForSignal<Output>(
    options: Readonly<{
      name?: string;
      signal: string;
      timeout?: StepWaitTimeout;
      schema?: StandardSchemaV1<unknown, Output>;
    }>,
  ): Promise<{ data: Output } | null> {
    const stepName = this.history.resolveStepName(
      options.name ?? options.signal,
    );

    const existingAttempt = this.history.findCached(stepName);
    if (existingAttempt) {
      return existingAttempt.output as { data: Output } | null;
    }

    const runningAttempt = this.history.findRunning(stepName);
    if (runningAttempt?.kind === "signal-wait") {
      return await this.resolveSignalWait<Output>(
        stepName,
        runningAttempt,
        options,
      );
    }

    const conflict = this.history.findConflictingSignalWait(
      options.signal,
      stepName,
    );
    if (conflict) {
      throw new Error(
        `Signal "${options.signal}" is already being waited on by step "${conflict.stepName}"`,
      );
    }

    const timeoutAt = resolveWaitTimeoutAt(options.timeout);
    this.assertExecutionActive();
    this.history.ensureCanRecordNewAttempt();
    const attempt = await this.backend.createStepAttempt({
      workflowRunId: this.workflowRunId,
      workerId: this.workerId,
      stepName,
      kind: "signal-wait",
      config: {},
      context: createSignalWaitContext(options.signal, timeoutAt),
    });
    this.history.recordNewAttempt(attempt);

    return await this.resolveSignalWait<Output>(stepName, attempt, options);
  }

  private async resolveSignalWait<Output>(
    stepName: string,
    attempt: Readonly<StepAttempt>,
    options: Readonly<{
      schema?: StandardSchemaV1<unknown, Output>;
    }>,
  ): Promise<{ data: Output } | null> {
    const signalData = await this.backend.getSignalDelivery({
      stepAttemptId: attempt.id,
    });

    if (signalData !== undefined) {
      let outputValue: unknown = signalData;

      if (options.schema) {
        const validationResult = await validateInput(
          options.schema,
          signalData,
        );
        if (!validationResult.success) {
          return await this.failStepWithError(
            stepName,
            attempt.id,
            new Error(
              `Signal schema validation failed: ${validationResult.error}`,
            ),
            TERMINAL_STEP_RETRY_POLICY,
          );
        }
        outputValue = validationResult.value;
      }

      return await this.completeSignalWaitStep<Output>(attempt, {
        data: normalizeStepOutput(outputValue) as Output,
      });
    }

    const timeoutAt =
      getContextTimeoutAt(attempt) ?? defaultWaitTimeoutAt(attempt.createdAt);
    if (Date.now() >= timeoutAt.getTime()) {
      return await this.completeSignalWaitStep<Output>(attempt, null);
    }

    throw new SleepSignal(
      this.history.resolveEarliestRunningWaitResumeAt(timeoutAt),
    );
  }

  /**
   * Complete a signal-wait step attempt and update internal maps.
   * @param attempt - Step attempt being completed
   * @param output - Envelope with data, or null for timeout
   * @returns The completed step output
   */
  private async completeSignalWaitStep<Output>(
    attempt: Readonly<StepAttempt>,
    output: { data: Output } | null,
  ): Promise<{ data: Output } | null> {
    const completed = await this.backend.completeStepAttempt({
      workflowRunId: this.workflowRunId,
      stepAttemptId: attempt.id,
      workerId: this.workerId,
      output: output as JsonValue | null,
    });
    this.history.recordCompletion(completed);
    return completed.output as { data: Output } | null;
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

  /**
   * Run a backend transition for this workflow run, handling stale-write races.
   * @param fn - Backend transition to execute
   * @returns Promise resolved when the transition completes
   */
  function runTransition(fn: () => Promise<unknown>): Promise<void> {
    return executeWorkflowRunTransition({
      backend,
      workflowRunId: workflowRun.id,
      workerId,
      transition: fn,
    });
  }

  try {
    // load all pages of step history
    const attempts = await listAllStepAttemptsForWorkflowRun(
      backend,
      workflowRun.id,
    );
    const history = new StepHistory({ attempts });

    // Complete any elapsed sleep waits first, then park on the earliest
    // remaining running wait (sleep or runWorkflow timeout).
    const hasPendingRunningSleep = await completeElapsedRunningSleepAttempts({
      backend,
      workflowRunId: workflowRun.id,
      workerId,
      history,
    });

    if (hasPendingRunningSleep) {
      const earliestResumeAt = history.earliestRunningWaitResumeAt();
      if (earliestResumeAt && Date.now() < earliestResumeAt.getTime()) {
        throw new SleepSignal(earliestResumeAt);
      }
    }

    const executor = new StepExecutor({
      backend,
      workflowRunId: workflowRun.id,
      workerId,
      history,
      executionFence,
    });

    const run = Object.freeze({
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
    await runTransition(() =>
      backend.completeWorkflowRun({
        workflowRunId: workflowRun.id,
        workerId,
        output: (output ?? null) as JsonValue,
      }),
    );
  } catch (error) {
    executionFence.deactivate();

    // handle sleep signal by parking the workflow in running status
    if (error instanceof SleepSignal) {
      await runTransition(() =>
        backend.sleepWorkflowRun({
          workflowRunId: workflowRun.id,
          workerId,
          availableAt: error.resumeAt,
        }),
      );
      return;
    }

    if (error instanceof StepLimitExceededError) {
      await runTransition(() =>
        backend.failWorkflowRun({
          workflowRunId: workflowRun.id,
          workerId,
          error: serializeStepLimitExceededError(error),
          retryPolicy: DEFAULT_WORKFLOW_RETRY_POLICY,
          attempts: workflowRun.attempts,
          deadlineAt: workflowRun.deadlineAt,
        }),
      );
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
        await runTransition(() =>
          backend.failWorkflowRun({
            workflowRunId: workflowRun.id,
            workerId,
            error: serializedError,
            retryPolicy: DEFAULT_WORKFLOW_RETRY_POLICY,
            attempts: workflowRun.attempts,
            deadlineAt: workflowRun.deadlineAt,
          }),
        );
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

      await runTransition(() =>
        backend.rescheduleWorkflowRunAfterFailedStepAttempt({
          workflowRunId: workflowRun.id,
          workerId,
          error: serializedError,
          availableAt,
        }),
      );
      return;
    }

    if (error instanceof StaleExecutionBranchError) {
      return;
    }

    // mark failure
    await runTransition(() =>
      backend.failWorkflowRun({
        workflowRunId: workflowRun.id,
        workerId,
        error: serializeError(error),
        retryPolicy: params.retryPolicy,
        attempts: workflowRun.attempts,
        deadlineAt: workflowRun.deadlineAt,
      }),
    );
  }
}
