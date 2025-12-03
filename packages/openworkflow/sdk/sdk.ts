import type { Backend } from "../core/backend.js";
import type { StandardSchemaV1 } from "../core/schema.js";
import type { WorkflowRun } from "../core/workflow.js";
import type { SchemaInput, SchemaOutput } from "../core/workflow.js";
import { validateInput } from "../core/workflow.js";
import type { WorkflowFunction } from "../execution/execution.js";
import { Worker } from "../worker/worker.js";

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
  private registeredWorkflows = new Map<
    string,
    WorkflowDefinition<unknown, unknown, unknown>
  >();

  constructor(options: OpenWorkflowOptions) {
    this.backend = options.backend;
  }

  /**
   * Create a new Worker with this client's backend and workflows.
   */
  newWorker(options?: { concurrency?: number | undefined }): Worker {
    return new Worker({
      backend: this.backend,
      workflows: [...this.registeredWorkflows.values()],
      concurrency: options?.concurrency,
    });
  }

  /**
   * Define and register a new workflow.
   */
  defineWorkflow<
    Input,
    Output,
    TSchema extends StandardSchemaV1 | undefined = undefined,
  >(
    config: WorkflowDefinitionConfig<TSchema>,
    fn: WorkflowFunction<WorkflowHandlerInput<TSchema, Input>, Output>,
  ): WorkflowDefinition<
    WorkflowHandlerInput<TSchema, Input>,
    Output,
    WorkflowRunInput<TSchema, Input>
  > {
    const { name, version } = config;

    if (this.registeredWorkflows.has(name)) {
      throw new Error(`Workflow "${name}" is already registered`);
    }

    const definition = new WorkflowDefinition<
      WorkflowHandlerInput<TSchema, Input>,
      Output,
      WorkflowRunInput<TSchema, Input>
    >({
      backend: this.backend,
      name,
      ...(version !== undefined && { version }),
      fn,
      schema: config.schema as
        | StandardSchemaV1<
            WorkflowRunInput<TSchema, Input>,
            WorkflowHandlerInput<TSchema, Input>
          >
        | undefined,
    });

    this.registeredWorkflows.set(
      name,
      definition as WorkflowDefinition<unknown, unknown, unknown>,
    );

    return definition;
  }
}

//
// --- Workflow Definition
//

/**
 * Options for WorkflowDefinition.
 */
export interface WorkflowDefinitionOptions<Input, Output, RunInput = Input> {
  backend: Backend;
  name: string;
  version?: string;
  fn: WorkflowFunction<Input, Output>;
  schema?: StandardSchemaV1<RunInput, Input> | undefined;
}

/**
 * Config passed to `defineWorkflow()` when defining a workflow.
 */
export interface WorkflowDefinitionConfig<
  TSchema extends StandardSchemaV1 | undefined = undefined,
> {
  /**
   * The name of the workflow.
   */
  name: string;
  /**
   * Optional version string for the workflow. Use this to enable zero-downtime
   * deployments when changing workflow logic.
   */
  version?: string;
  /**
   * Optional schema used to validate inputs passed to `.run()`.
   */
  schema?: TSchema;
}

/**
 * Represents a workflow definition that can be used to start runs. Returned
 * from `client.defineWorkflow()`.
 */
export class WorkflowDefinition<Input, Output, RunInput = Input> {
  private backend: Backend;
  readonly name: string;
  readonly version: string | null;
  readonly fn: WorkflowFunction<Input, Output>;
  private readonly schema: StandardSchemaV1<RunInput, Input> | null;

  constructor(options: WorkflowDefinitionOptions<Input, Output, RunInput>) {
    this.backend = options.backend;
    this.name = options.name;
    this.version = options.version ?? null;
    this.fn = options.fn;
    this.schema = options.schema ?? null;
  }

  /**
   * Starts a new workflow run.
   */
  async run(
    input?: RunInput,
    options?: WorkflowRunOptions,
  ): Promise<WorkflowRunHandle<Output>> {
    const validationResult = await validateInput(this.schema, input);
    if (!validationResult.success) {
      throw new Error(validationResult.error);
    }
    const parsedInput = validationResult.value;

    // need to come back and support idempotency keys, scheduling, etc.
    const workflowRun = await this.backend.createWorkflowRun({
      workflowName: this.name,
      version: this.version,
      idempotencyKey: null,
      config: {},
      context: null,
      input: parsedInput ?? null,
      availableAt: null,
      deadlineAt: options?.deadlineAt ?? null,
    });

    return new WorkflowRunHandle<Output>({
      backend: this.backend,
      workflowRun: workflowRun,
      resultPollIntervalMs: DEFAULT_RESULT_POLL_INTERVAL_MS,
      resultTimeoutMs: DEFAULT_RESULT_TIMEOUT_MS,
    });
  }
}

//
// --- Workflow Run
//

/**
 * Options for creating a new workflow run from a workflow definition when
 * calling `workflowDef.run()`.
 */
export interface WorkflowRunOptions {
  /**
   * Set a deadline for the workflow run. If the workflow exceeds this deadline,
   * it will be marked as failed.
   */
  deadlineAt?: Date;
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
   */
  async result(): Promise<Output> {
    const start = Date.now();

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

      if (Date.now() - start > this.resultTimeoutMs) {
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
