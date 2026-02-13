import type { Backend } from "./backend.js";
import type { DurationString } from "./core/duration.js";
import { serializeError } from "./core/error.js";
import type { JsonValue } from "./core/json.js";
import type { StepAttempt, StepAttemptCache } from "./core/step.js";
import {
  getCachedStepAttempt,
  addToStepAttemptCache,
  normalizeStepOutput,
  calculateDateFromDuration,
  createSleepContext,
} from "./core/step.js";
import type { WorkflowRun } from "./core/workflow.js";
import {
  computeFailedWorkflowRunUpdate,
  type RetryPolicy,
} from "./workflow.js";

/**
 * Config for an individual step defined with `step.run()`.
 */
export interface StepFunctionConfig {
  /**
   * The name of the step.
   */
  name: string;
  /**
   * Optional retry policy override for this step.
   */
  retryPolicy?: Partial<RetryPolicy>;
}

/**
 * Represents the API for defining steps within a workflow. Used within a
 * workflow handler to define steps by calling `step.run()`.
 */
export interface StepApi {
  run<Output>(
    config: Readonly<StepFunctionConfig>,
    fn: StepFunction<Output>,
  ): Promise<Output>;
  sleep(name: string, duration: DurationString): Promise<void>;
}

/**
 * The step definition (defined by the user) that executes user code. Can return
 * undefined (e.g., when using `return;`) which will be converted to null.
 */
export type StepFunction<Output> = () =>
  | Promise<Output | undefined>
  | Output
  | undefined;

/**
 * Params passed to a workflow function for the user to use when defining steps.
 */
export interface WorkflowFunctionParams<Input> {
  input: Input;
  step: StepApi;
  version: string | null;
}

/**
 * The workflow definition's function (defined by the user) that the user uses
 * to define the workflow's steps.
 */
export type WorkflowFunction<Input, Output> = (
  params: Readonly<WorkflowFunctionParams<Input>>,
) => Promise<Output> | Output;

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

/**
 * Retry defaults for step failures.
 */
const DEFAULT_STEP_RETRY_POLICY: RetryPolicy = {
  initialInterval: "1s",
  backoffCoefficient: 2,
  maximumInterval: "100s",
  maximumAttempts: Infinity, // unlimited
};

const TERMINAL_RETRY_POLICY: RetryPolicy = {
  ...DEFAULT_STEP_RETRY_POLICY,
  maximumAttempts: 0,
};

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

  for (const attempt of attempts) {
    if (attempt.status === "completed" || attempt.status === "succeeded") {
      cache.set(attempt.stepName, attempt);
      continue;
    }

    if (attempt.status === "failed") {
      const previousCount = failedCountsByStepName.get(attempt.stepName) ?? 0;
      failedCountsByStepName.set(attempt.stepName, previousCount + 1);
    }
  }

  return {
    cache,
    failedCountsByStepName,
  };
}

/**
 * Configures the options for a StepExecutor.
 */
export interface StepExecutorOptions {
  backend: Backend;
  workflowRunId: string;
  workerId: string;
  attempts: StepAttempt[];
}

/**
 * Replays prior step attempts and persists new ones while memoizing
 * deterministic step outputs.
 */
class StepExecutor implements StepApi {
  private readonly backend: Backend;
  private readonly workflowRunId: string;
  private readonly workerId: string;
  private cache: StepAttemptCache;
  private readonly failedCountsByStepName: Map<string, number>;

  constructor(options: Readonly<StepExecutorOptions>) {
    this.backend = options.backend;
    this.workflowRunId = options.workflowRunId;
    this.workerId = options.workerId;

    const state = createStepExecutionStateFromAttempts(options.attempts);
    this.cache = state.cache;
    this.failedCountsByStepName = new Map(state.failedCountsByStepName);
  }

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
    const attempt = await this.backend.createStepAttempt({
      workflowRunId: this.workflowRunId,
      workerId: this.workerId,
      stepName: name,
      kind: "function",
      config: {},
      context: null,
    });

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

      return savedAttempt.output as Output;
    } catch (error) {
      // mark failure
      await this.backend.failStepAttempt({
        workflowRunId: this.workflowRunId,
        stepAttemptId: attempt.id,
        workerId: this.workerId,
        error: serializeError(error),
      });

      const previousFailedAttempts = this.failedCountsByStepName.get(name) ?? 0;
      const stepFailedAttempts = previousFailedAttempts + 1;
      this.failedCountsByStepName.set(name, stepFailedAttempts);

      throw new StepError({
        stepName: name,
        stepFailedAttempts,
        retryPolicy: resolveStepRetryPolicy(retryPolicyOverride),
        error,
      });
    }
  }

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

    await this.backend.createStepAttempt({
      workflowRunId: this.workflowRunId,
      workerId: this.workerId,
      stepName: name,
      kind: "sleep",
      config: {},
      context,
    });

    // throw sleep signal to trigger postponement
    // we do not mark the step as completed here; it will be updated
    // when the workflow resumes
    throw new SleepSignal(resumeAt);
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
        limit: 1000,
      });
      attempts.push(...response.data);
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

    // create step executor
    const executor = new StepExecutor({
      backend,
      workflowRunId: workflowRun.id,
      workerId,
      attempts,
    });

    // execute workflow
    const output = await workflowFn({
      input: workflowRun.input as unknown,
      step: executor,
      version: workflowVersion,
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
          retryPolicy: TERMINAL_RETRY_POLICY,
        });
        return;
      }

      if (!retryDecision.availableAt) {
        throw new Error("Step retry decision missing availableAt");
      }

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
