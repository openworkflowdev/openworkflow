import type { Backend } from "./backend.js";
import { parseDuration, type DurationString } from "./core/duration.js";
import type { StandardSchemaV1 } from "./core/schema.js";
import type {
  SchemaInput,
  SchemaOutput,
  WorkflowRun,
} from "./core/workflow.js";
import { validateInput } from "./core/workflow.js";
import type { WorkflowFunction } from "./execution.js";
import { WorkflowRegistry } from "./registry.js";
import { Worker } from "./worker.js";
import {
  defineWorkflow,
  type Workflow,
  type WorkflowSpec,
} from "./workflow.js";

const DEFAULT_RESULT_POLL_INTERVAL_MS = 1000; // 1s
const DEFAULT_RESULT_TIMEOUT_MS = 5 * 60 * 1000; // 5m

/* The data the worker function receives (after transformation). */
type WorkflowHandlerInput<TSchema, Input> = SchemaOutput<TSchema, Input>;

/* The data the client sends (before transformation) */
type WorkflowRunInput<TSchema, Input> = SchemaInput<TSchema, Input>;

/**
 * Options for the OpenWorkflow client.
 */
export interface OpenWorkflowOptions {
  backend: Backend;
}

/**
 * Client used to register workflows and start runs.
 */
export class OpenWorkflow {
  private backend: Backend;
  private registry = new WorkflowRegistry();

  constructor(options: OpenWorkflowOptions) {
    this.backend = options.backend;
  }

  /**
   * Create a new Worker with this client's backend and workflows.
   * @param options - Worker options
   * @param options.concurrency - Max concurrent workflow runs
   * @returns Worker instance
   */
  newWorker(options?: { concurrency?: number | undefined }): Worker {
    return new Worker({
      backend: this.backend,
      workflows: this.registry.getAll(),
      concurrency: options?.concurrency,
    });
  }

  /**
   * Provide the implementation for a declared workflow. This links the workflow
   * specification to its execution logic and registers it with this
   * OpenWorkflow instance for worker execution.
   * @param spec - Workflow spec
   * @param fn - Workflow implementation
   */
  implementWorkflow<Input, Output, RunInput = Input>(
    spec: WorkflowSpec<Input, Output, RunInput>,
    fn: WorkflowFunction<Input, Output>,
  ): void {
    const workflow: Workflow<Input, Output, RunInput> = {
      spec,
      fn,
    };

    this.registry.register(workflow as Workflow<unknown, unknown, unknown>);
  }

  /**
   * Run a workflow from its specification. This is the primary way to schedule
   * a workflow using only its WorkflowSpec.
   * @param spec - Workflow spec
   * @param input - Workflow input
   * @param options - Run options
   * @returns Handle for awaiting the result
   * @example
   * ```ts
   * const handle = await ow.runWorkflow(emailWorkflow, { to: 'user@example.com' });
   * const result = await handle.result();
   * ```
   */
  async runWorkflow<Input, Output, RunInput = Input>(
    spec: WorkflowSpec<Input, Output, RunInput>,
    input?: RunInput,
    options?: WorkflowRunOptions,
  ): Promise<WorkflowRunHandle<Output>> {
    const validationResult = await validateInput(spec.schema, input);
    if (!validationResult.success) {
      throw new Error(validationResult.error);
    }
    const parsedInput = validationResult.value;

    const workflowRun = await this.backend.createWorkflowRun({
      workflowName: spec.name,
      version: spec.version ?? null,
      idempotencyKey: null,
      config: {},
      context: null,
      input: parsedInput ?? null,
      availableAt: resolveAvailableAt(options?.availableAt),
      deadlineAt: options?.deadlineAt ?? null,
    });

    return new WorkflowRunHandle<Output>({
      backend: this.backend,
      workflowRun: workflowRun,
      resultPollIntervalMs: DEFAULT_RESULT_POLL_INTERVAL_MS,
      resultTimeoutMs: DEFAULT_RESULT_TIMEOUT_MS,
    });
  }

  /**
   * Define and register a new workflow.
   * @param spec - Workflow spec
   * @param fn - Workflow implementation
   * @returns Runnable workflow
   * @example
   * ```ts
   * const workflow = ow.defineWorkflow(
   *   { name: 'my-workflow' },
   *   async ({ input, step }) => {
   *     // workflow implementation
   *   },
   * );
   * ```
   */
  defineWorkflow<
    Input,
    Output,
    TSchema extends StandardSchemaV1 | undefined = undefined,
  >(
    spec: WorkflowSpec<
      WorkflowHandlerInput<TSchema, Input>,
      Output,
      WorkflowRunInput<TSchema, Input>
    >,
    fn: WorkflowFunction<WorkflowHandlerInput<TSchema, Input>, Output>,
  ): RunnableWorkflow<
    WorkflowHandlerInput<TSchema, Input>,
    Output,
    WorkflowRunInput<TSchema, Input>
  > {
    const workflow = defineWorkflow(spec, fn);

    this.registry.register(workflow as Workflow<unknown, unknown, unknown>);

    return new RunnableWorkflow(this, workflow);
  }
}

/**
 * A fully defined workflow with its implementation. This class is returned by
 * `client.defineWorkflow` and provides the `.run()` method for scheduling
 * workflow runs.
 */
export class RunnableWorkflow<Input, Output, RunInput = Input> {
  private readonly ow: OpenWorkflow;
  readonly workflow: Workflow<Input, Output, RunInput>;

  constructor(ow: OpenWorkflow, workflow: Workflow<Input, Output, RunInput>) {
    this.ow = ow;
    this.workflow = workflow;
  }

  /**
   * Starts a new workflow run.
   * @param input - Workflow input
   * @param options - Run options
   * @returns Workflow run handle
   */
  async run(
    input?: RunInput,
    options?: WorkflowRunOptions,
  ): Promise<WorkflowRunHandle<Output>> {
    return this.ow.runWorkflow(this.workflow.spec, input, options);
  }
}

//
// --- Workflow Run
//

/**
 * Options for creating a new workflow run from a runnable workflow when calling
 * `workflowDef.run()`.
 */
export interface WorkflowRunOptions {
  /**
   * Schedule the workflow run for a future time. When set, the run will stay
   * pending until the timestamp is reached. Accepts an absolute Date or a
   * duration string (e.g. "5m", "2 hours").
   */
  availableAt?: Date | DurationString;
  /**
   * Set a deadline for the workflow run. If the workflow exceeds this deadline,
   * it will be marked as failed.
   */
  deadlineAt?: Date;
}

/**
 * Resolve availableAt to an absolute Date or null.
 * @param availableAt - Absolute Date or duration string
 * @returns Absolute Date or null
 * @throws {Error} When a duration string is invalid
 */
function resolveAvailableAt(
  availableAt: Date | DurationString | undefined,
): Date | null {
  if (!availableAt) return null;
  if (availableAt instanceof Date) return availableAt;

  const result = parseDuration(availableAt);
  if (!result.ok) {
    throw result.error;
  }

  return new Date(Date.now() + result.value);
}

/**
 * Options for WorkflowHandle.
 */
export interface WorkflowHandleOptions {
  backend: Backend;
  workflowRun: WorkflowRun;
  resultPollIntervalMs: number;
  resultTimeoutMs: number;
}

/**
 * Options for result() on a WorkflowRunHandle.
 */
export interface WorkflowRunHandleResultOptions {
  /**
   * Time to wait for a workflow run to complete. Throws an error if the timeout
   * is exceeded.
   * @default 300000 (5 minutes)
   */
  timeoutMs?: number;
}

/**
 * Represents a started workflow run and provides methods to await its result.
 * Returned from `workflowDef.run()`.
 */
export class WorkflowRunHandle<Output> {
  private backend: Backend;
  readonly workflowRun: WorkflowRun;
  private resultPollIntervalMs: number;
  private resultTimeoutMs: number;

  constructor(options: WorkflowHandleOptions) {
    this.backend = options.backend;
    this.workflowRun = options.workflowRun;
    this.resultPollIntervalMs = options.resultPollIntervalMs;
    this.resultTimeoutMs = options.resultTimeoutMs;
  }

  /**
   * Waits for the workflow run to complete and returns the result.
   * @param options - Options for waiting for the result
   * @returns Workflow output
   */
  async result(options?: WorkflowRunHandleResultOptions): Promise<Output> {
    const start = Date.now();
    const timeout = options?.timeoutMs ?? this.resultTimeoutMs;

    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    while (true) {
      const latest = await this.backend.getWorkflowRun({
        workflowRunId: this.workflowRun.id,
      });

      if (!latest) {
        throw new Error(`Workflow run ${this.workflowRun.id} no longer exists`);
      }

      // 'succeeded' status is deprecated
      if (latest.status === "succeeded" || latest.status === "completed") {
        return latest.output as Output;
      }

      if (latest.status === "failed") {
        throw new Error(
          `Workflow ${this.workflowRun.workflowName} failed: ${JSON.stringify(latest.error)}`,
        );
      }

      if (latest.status === "canceled") {
        throw new Error(
          `Workflow ${this.workflowRun.workflowName} was canceled`,
        );
      }

      if (Date.now() - start > timeout) {
        throw new Error(
          `Timed out waiting for workflow run ${this.workflowRun.id} to finish`,
        );
      }

      await new Promise((resolve) => {
        setTimeout(resolve, this.resultPollIntervalMs);
      });
    }
  }

  /**
   * Cancels the workflow run. Only workflows in pending, running, or sleeping
   * status can be canceled.
   */
  async cancel(): Promise<void> {
    await this.backend.cancelWorkflowRun({
      workflowRunId: this.workflowRun.id,
    });
  }
}
