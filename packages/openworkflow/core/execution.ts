/* eslint-disable functional/no-classes, functional/no-class-inheritance, functional/no-expression-statements, functional/no-let, functional/no-loop-statements, functional/no-throw-statements, functional/immutable-data, functional/no-mixed-types */
import type {
  StepApi,
  StepFunction,
  StepFunctionConfig,
  WorkflowFunction,
} from "./application.js";
import type { Backend } from "./backend.js";
import type { DurationString } from "./duration.js";
import type { JsonValue } from "./json.js";
import type { StepAttempt, StepAttemptCache } from "./step.js";
import {
  serializeError,
  createStepAttemptCacheFromAttempts,
  getCachedStepAttempt,
  addToStepAttemptCache,
  normalizeStepOutput,
  calculateSleepResumeAt,
  createSleepContext,
} from "./step.js";
import type { WorkflowRun } from "./workflow.js";

/**
 * Signal thrown when a workflow needs to sleep. Contains the time when the
 * workflow should resume.
 */
export class SleepSignal extends Error {
  readonly resumeAt: Date;

  constructor(resumeAt: Readonly<Date>) {
    super("SleepSignal");
    this.name = "SleepSignal";
    this.resumeAt = resumeAt;
  }
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
export class StepExecutor implements StepApi {
  private readonly backend: Backend;
  private readonly workflowRunId: string;
  private readonly workerId: string;
  private cache: StepAttemptCache;

  constructor(options: Readonly<StepExecutorOptions>) {
    this.backend = options.backend;
    this.workflowRunId = options.workflowRunId;
    this.workerId = options.workerId;

    this.cache = createStepAttemptCacheFromAttempts(options.attempts);
  }

  async run<Output>(
    config: Readonly<StepFunctionConfig>,
    fn: StepFunction<Output>,
  ): Promise<Output> {
    const { name } = config;

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
      throw error;
    }
  }

  async sleep(name: string, duration: DurationString): Promise<void> {
    // return cached result if this sleep already completed
    const existingAttempt = getCachedStepAttempt(this.cache, name);
    if (existingAttempt) return;

    // create new step attempt for the sleep
    const result = calculateSleepResumeAt(duration);
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
}

/**
 * Execute a workflow run. This is the core application use case that handles:
 * - Loading step history
 * - Handling sleeping steps
 * - Creating the step executor
 * - Executing the workflow function
 * - Completing, failing, or sleeping the workflow run based on the outcome
 *
 * @param params - The execution parameters
 */
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

    // mark failure
    await backend.failWorkflowRun({
      workflowRunId: workflowRun.id,
      workerId,
      error: serializeError(error),
    });
  }
}
