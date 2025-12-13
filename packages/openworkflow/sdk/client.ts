import type { Backend } from "../core/backend.js";
import type { StandardSchemaV1 } from "../core/schema.js";
import type {
  SchemaInput,
  SchemaOutput,
  WorkflowRun,
} from "../core/workflow.js";
import { validateInput } from "../core/workflow.js";
import type { WorkflowFunction } from "../execution/execution.js";
import { Worker } from "../worker/worker.js";
import { WorkflowRegistry } from "./registry.js";

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
  private registry = new WorkflowRegistry<
    WorkflowDefinition<unknown, unknown, unknown>
  >();

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
      registry: this.registry,
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
    const definition = new WorkflowDefinition<Input, Output, RunInput>(
      this,
      spec,
      fn,
    );

    this.registry.register(
      spec.name,
      spec.version,
      definition as WorkflowDefinition<unknown, unknown, unknown>,
    );
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
      version: spec.version,
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

  /**
   * Define and register a new workflow.
   *
   * This is a convenience method that combines `declareWorkflow` and
   * `implementWorkflow` into a single call. For better code splitting and to
   * separate declaration from implementation, consider using those methods
   * separately.
   * @param config - Workflow config
   * @param fn - Workflow implementation
   * @returns Workflow definition
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
    config: WorkflowDefinitionConfig<TSchema>,
    fn: WorkflowFunction<WorkflowHandlerInput<TSchema, Input>, Output>,
  ): WorkflowDefinition<
    WorkflowHandlerInput<TSchema, Input>,
    Output,
    WorkflowRunInput<TSchema, Input>
  > {
    const spec = declareWorkflow<Input, Output, TSchema>(config);
    const definition = new WorkflowDefinition<
      WorkflowHandlerInput<TSchema, Input>,
      Output,
      WorkflowRunInput<TSchema, Input>
    >(this, spec, fn);
    this.registry.register(
      spec.name,
      spec.version,
      definition as WorkflowDefinition<unknown, unknown, unknown>,
    );
    return definition;
  }
}

/**
 * Declare a workflow without providing its implementation (which is provided
 * separately via `implementWorkflow`). Returns a lightweight WorkflowSpec
 * that can be used to schedule workflow runs.
 * @param config - Workflow config
 * @returns Workflow spec
 * @example
 * ```ts
 * export const emailWorkflow = declareWorkflow({
 *   name: 'send-email',
 *   schema: z.object({ to: z.string().email() }),
 * });
 * ```
 */
export function declareWorkflow<
  Input,
  Output,
  TSchema extends StandardSchemaV1 | undefined = undefined,
>(
  config: WorkflowDefinitionConfig<TSchema>,
): WorkflowSpec<
  WorkflowHandlerInput<TSchema, Input>,
  Output,
  WorkflowRunInput<TSchema, Input>
> {
  return {
    name: config.name,
    version: config.version ?? null,
    schema:
      (config.schema as
        | StandardSchemaV1<
            WorkflowRunInput<TSchema, Input>,
            WorkflowHandlerInput<TSchema, Input>
          >
        | undefined) ?? null,
  };
}

//
// --- Workflow Definition
//

/**
 * Config for declaring a workflow via `declareWorkflow()` or
 * `defineWorkflow()`.
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
 * A lightweight, serializable specification for a workflow. This object can be
 * shared between different parts of an application (e.g., API servers and
 * workers) without bringing in implementation dependencies.
 *
 * Use `declareWorkflow()` to create a WorkflowSpec, and `ow.runWorkflow()`
 * to schedule runs using only the spec.
 */
export interface WorkflowSpec<Input, Output, RunInput = Input> {
  /** The name of the workflow. */
  name: string;
  /** The version of the workflow, or null if unversioned. */
  version: string | null;
  /** The schema used to validate inputs, or null if none. */
  schema: StandardSchemaV1<RunInput, Input> | null;

  // phantom types for generics, not used at runtime
  _input?: Input;
  _output?: Output;
  _runInput?: RunInput;
}

//
// --- Workflow Definition
//

/**
 * A fully defined workflow with its implementation. This class is returned by
 * `defineWorkflow` and provides the `.run()` method for scheduling workflow
 * runs.
 */
export class WorkflowDefinition<Input, Output, RunInput = Input> {
  private readonly ow: OpenWorkflow;
  readonly spec: WorkflowSpec<Input, Output, RunInput>;
  readonly fn: WorkflowFunction<Input, Output>;

  constructor(
    ow: OpenWorkflow,
    spec: WorkflowSpec<Input, Output, RunInput>,
    fn: WorkflowFunction<Input, Output>,
  ) {
    this.ow = ow;
    this.spec = spec;
    this.fn = fn;
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
    return this.ow.runWorkflow(this.spec, input, options);
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
   * @returns Workflow output
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
