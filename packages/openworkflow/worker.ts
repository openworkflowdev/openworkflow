import type {
  Backend,
  JsonValue,
  StepAttempt,
  WorkflowRun,
} from "./backend.js";
import {
  StepApi,
  StepFunction,
  StepFunctionConfig,
  WorkflowDefinition,
} from "./client.js";
import { parseDuration } from "./duration.js";
import { randomUUID } from "node:crypto";

const DEFAULT_LEASE_DURATION_MS = 30 * 1000; // 30s
const DEFAULT_POLL_INTERVAL_MS = 100; // 100ms
const DEFAULT_CONCURRENCY = 1;

/**
 * Signal thrown when a workflow needs to sleep. Contains the time when the
 * workflow should resume.
 */
class SleepSignal extends Error {
  readonly resumeAt: Date;

  constructor(resumeAt: Date) {
    super("SleepSignal");
    this.name = "SleepSignal";
    this.resumeAt = resumeAt;
  }
}

/**
 * Configures how a Worker polls the backend, leases workflow runs, and
 * registers workflows.
 */
export interface WorkerOptions {
  backend: Backend;
  workflows: WorkflowDefinition<unknown, unknown>[];
  concurrency?: number | undefined;
}

/**
 * Runs workflows by polling the backend, dispatching runs across a concurrency
 * pool, and heartbeating leases.
 */
export class Worker {
  private readonly backend: Backend;
  private readonly workerIds: string[];
  private readonly registeredWorkflows = new Map<
    string,
    WorkflowDefinition<unknown, unknown>
  >();
  private readonly activeExecutions = new Set<WorkflowExecution>();
  private running = false;
  private loopPromise: Promise<void> | null = null;

  constructor(options: WorkerOptions) {
    this.backend = options.backend;

    const concurrency = Math.max(
      DEFAULT_CONCURRENCY,
      options.concurrency ?? DEFAULT_CONCURRENCY,
    );

    // generate worker IDs for every concurrency slot
    this.workerIds = Array.from({ length: concurrency }, () => randomUUID());

    // register workflows
    for (const workflow of options.workflows) {
      this.registeredWorkflows.set(workflow.name, workflow);
    }
  }

  /**
   * Start the worker. It will begin polling for and executing workflows.
   */
  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;
    this.loopPromise = this.runLoop();
    await Promise.resolve();
  }

  /**
   * Stop the worker gracefully. Waits for all active workflow runs to complete
   * before returning.
   */
  async stop(): Promise<void> {
    this.running = false;

    // wait for the poll loop to stop
    if (this.loopPromise) await this.loopPromise;

    // wait for all active executions to finish
    while (this.activeExecutions.size > 0) await sleep(100);
  }

  /**
   * Processes one round of work claims and execution. Exposed for testing.
   * Returns the number of workflow runs claimed.
   */
  async tick(): Promise<number> {
    const availableSlots = this.concurrency - this.activeExecutions.size;
    if (availableSlots <= 0) return 0;

    // claim work for each available slot
    const claims = Array.from({ length: availableSlots }, (_, i) => {
      const availableWorkerId = this.workerIds[i % this.workerIds.length];
      return availableWorkerId
        ? this.claimAndProcessWorkflowRunInBackground(availableWorkerId)
        : Promise.resolve(null);
    });

    const claimed = await Promise.all(claims);
    return claimed.filter((run) => run !== null).length;
  }

  /**
   * Get the configured concurrency limit.
   */
  private get concurrency(): number {
    return this.workerIds.length;
  }

  /*
   * Main run loop that continuously ticks while the worker is running.
   * Only sleeps when no work was claimed to avoid busy-waiting.
   */
  private async runLoop(): Promise<void> {
    while (this.running) {
      try {
        const claimedCount = await this.tick();
        // only sleep if we didn't claim any work
        if (claimedCount === 0) {
          await sleep(DEFAULT_POLL_INTERVAL_MS);
        }
      } catch (error) {
        console.error("Worker tick failed:", error);
        await sleep(DEFAULT_POLL_INTERVAL_MS);
      }
    }
  }

  /*
   * Cclaim and process a workflow run for the given worker ID. Do not await the
   * processing here to avoid blocking the caller.
   * Returns the claimed workflow run, or null if none was available.
   */
  private async claimAndProcessWorkflowRunInBackground(
    workerId: string,
  ): Promise<WorkflowRun | null> {
    // claim workflow run
    const workflowRun = await this.backend.claimWorkflowRun({
      workerId,
      leaseDurationMs: DEFAULT_LEASE_DURATION_MS,
    });
    if (!workflowRun) return null;

    // find workflow definition
    const workflow = this.registeredWorkflows.get(workflowRun.workflowName);
    if (!workflow) {
      await this.backend.markWorkflowRunFailed({
        workflowRunId: workflowRun.id,
        workerId,
        error: {
          message: `Workflow "${workflowRun.workflowName}" is not registered`,
        },
      });
      return null;
    }

    // create execution and start processing *async* w/o blocking
    const execution = new WorkflowExecution({
      backend: this.backend,
      workflowRun,
      workerId,
    });
    this.activeExecutions.add(execution);

    this.processExecutionInBackground(execution, workflow)
      .catch(() => {
        // errors are already handled in processExecution
      })
      .finally(() => {
        execution.stopHeartbeat();
        this.activeExecutions.delete(execution);
      });

    return workflowRun;
  }

  /**
   * Process a workflow execution, handling heartbeats, step execution, and
   * marking success or failure.
   */
  private async processExecutionInBackground(
    execution: WorkflowExecution,
    workflow: WorkflowDefinition<unknown, unknown>,
  ): Promise<void> {
    // start heartbeating
    execution.startHeartbeat();

    try {
      // load step history
      const attempts = await this.backend.listStepAttempts({
        workflowRunId: execution.workflowRun.id,
      });

      // mark any running sleep steps as succeeded
      for (let i = 0; i < attempts.length; i++) {
        const attempt = attempts[i];
        if (!attempt) continue;

        if (attempt.status === "running" && attempt.kind === "sleep") {
          const succeeded = await this.backend.markStepAttemptSucceeded({
            workflowRunId: execution.workflowRun.id,
            stepAttemptId: attempt.id,
            workerId: execution.workerId,
            output: null,
          });

          // update cache w/ succeeded attempt
          attempts[i] = succeeded;
        }
      }

      // create step executor
      const executor = new StepExecutor({
        backend: this.backend,
        workflowRunId: execution.workflowRun.id,
        workerId: execution.workerId,
        attempts,
      });

      // execute workflow
      const output = await workflow.fn({
        input: execution.workflowRun.input as unknown,
        step: executor,
      });

      // mark success
      await this.backend.markWorkflowRunSucceeded({
        workflowRunId: execution.workflowRun.id,
        workerId: execution.workerId,
        output: (output ?? null) as JsonValue,
      });
    } catch (error) {
      // handle sleep signal by setting workflow to sleeping status
      if (error instanceof SleepSignal) {
        await this.backend.sleepWorkflowRun({
          workflowRunId: execution.workflowRun.id,
          workerId: execution.workerId,
          availableAt: error.resumeAt,
        });

        return;
      }

      // mark failure
      await this.backend.markWorkflowRunFailed({
        workflowRunId: execution.workflowRun.id,
        workerId: execution.workerId,
        error: serializeError(error),
      });
    }
  }
}

/**
 * Configures the options for a WorkflowExecution.
 */
interface WorkflowExecutionOptions {
  backend: Backend;
  workflowRun: WorkflowRun;
  workerId: string;
}

/**
 * Tracks a claimed workflow run and maintains its heartbeat lease for the
 * worker.
 */
class WorkflowExecution {
  private backend: Backend;
  workflowRun: WorkflowRun;
  workerId: string;
  private heartbeatTimer: NodeJS.Timeout | null = null;

  constructor(options: WorkflowExecutionOptions) {
    this.backend = options.backend;
    this.workflowRun = options.workflowRun;
    this.workerId = options.workerId;
  }

  /**
   * Start the heartbeat loop for this execution, heartbeating at half the lease
   * duration.
   */
  startHeartbeat(): void {
    const leaseDurationMs = DEFAULT_LEASE_DURATION_MS;
    const heartbeatIntervalMs = leaseDurationMs / 2;

    this.heartbeatTimer = setInterval(() => {
      this.backend
        .heartbeatWorkflowRun({
          workflowRunId: this.workflowRun.id,
          workerId: this.workerId,
          leaseDurationMs,
        })
        .catch((error: unknown) => {
          console.error("Heartbeat failed:", error);
        });
    }, heartbeatIntervalMs);
  }

  /**
   * Stop the heartbeat loop.
   */
  stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }
}

/**
 * Configures the options for a StepExecutor.
 */
interface StepExecutorOptions {
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
  private backend: Backend;
  private workflowRunId: string;
  private workerId: string;
  private readonly successfulAttemptsByName = new Map<string, StepAttempt>();

  constructor(options: StepExecutorOptions) {
    this.backend = options.backend;
    this.workflowRunId = options.workflowRunId;
    this.workerId = options.workerId;

    // load successful attempts into history
    for (const attempt of options.attempts) {
      if (attempt.status === "succeeded") {
        this.successfulAttemptsByName.set(attempt.stepName, attempt);
      }
    }
  }

  async run<Output>(
    config: StepFunctionConfig,
    fn: StepFunction<Output>,
  ): Promise<Output> {
    const { name } = config;

    // return cached result if available
    const existingAttempt = this.successfulAttemptsByName.get(name);
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

      // convert undefined to null for JSON compatibility
      const output = (result ?? null) as JsonValue | null;

      // mark success
      const savedAttempt = await this.backend.markStepAttemptSucceeded({
        workflowRunId: this.workflowRunId,
        stepAttemptId: attempt.id,
        workerId: this.workerId,
        output,
      });

      // cache result
      this.successfulAttemptsByName.set(name, savedAttempt);

      return savedAttempt.output as Output;
    } catch (error) {
      // mark failure
      await this.backend.markStepAttemptFailed({
        workflowRunId: this.workflowRunId,
        stepAttemptId: attempt.id,
        workerId: this.workerId,
        error: serializeError(error),
      });
      throw error;
    }
  }

  async sleep(name: string, duration: string): Promise<void> {
    // return cached result if this sleep already completed
    const existingAttempt = this.successfulAttemptsByName.get(name);
    if (existingAttempt) return;

    // create new step attempt for the sleep
    await this.backend.createStepAttempt({
      workflowRunId: this.workflowRunId,
      workerId: this.workerId,
      stepName: name,
      kind: "sleep",
      config: {},
      context: null,
    });

    // throw sleep signal to trigger postponement
    // we do not mark the step as succeeded here; it will be updated
    // when the workflow resumes
    const durationMs = parseDuration(duration);
    const resumeAt = new Date(Date.now() + durationMs);
    throw new SleepSignal(resumeAt);
  }
}

/**
 * Serialize an error to a JSON-compatible format.
 */
function serializeError(error: unknown): {
  message: string;
  [key: string]: JsonValue;
} {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack ?? null,
    };
  }

  return {
    message: String(error),
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
