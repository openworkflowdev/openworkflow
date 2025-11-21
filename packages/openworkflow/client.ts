import type { Backend, WorkflowRun } from "./backend.js";
import { DurationString } from "./duration.js";
import { StandardSchemaV1 } from "./schema.js";
import { Worker } from "./worker.js";

const DEFAULT_RESULT_POLL_INTERVAL_MS = 1000; // 1s
const DEFAULT_RESULT_TIMEOUT_MS = 5 * 60 * 1000; // 5m

type SchemaInput<TSchema, Fallback> = TSchema extends StandardSchemaV1
  ? StandardSchemaV1.InferInput<TSchema>
  : Fallback;

type SchemaOutput<TSchema, Fallback> = TSchema extends StandardSchemaV1
  ? StandardSchemaV1.InferOutput<TSchema>
  : Fallback;

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
  newWorker(options?: { concurrency?: number }): Worker {
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
    let parsedInput = input as unknown as Input | undefined;

    if (this.schema) {
      // https://standardschema.dev
      const result = this.schema["~standard"].validate(input);
      const resolved = await Promise.resolve(result);

      if (resolved.issues) {
        const messages =
          resolved.issues.length > 0
            ? resolved.issues.map((issue) => issue.message).join("; ")
            : "Validation failed";
        throw new Error(messages);
      }

      parsedInput = resolved.value;
    }

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
  params: WorkflowFunctionParams<Input>,
) => Promise<Output> | Output;

/**
 * Config for an individual step defined with `step.run()`.
 */
export interface StepFunctionConfig {
  /**
   * The name of the step.
   */
  name: string;
}

/**
 * Represents the API for defining steps within a workflow. Used within a
 * workflow handler to define steps by calling `step.run()`.
 */
export interface StepApi {
  run<Output>(
    config: StepFunctionConfig,
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
