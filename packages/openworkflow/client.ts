import type { Backend, WorkflowRun } from "./backend.js";
import { Worker } from "./worker.js";

const DEFAULT_RESULT_POLL_INTERVAL_MS = 1000; // 1s
const DEFAULT_RESULT_TIMEOUT_MS = 5 * 60 * 1000; // 5m

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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    WorkflowDefinition<any, any>
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
  defineWorkflow<Input, Output>(
    config: WorkflowDefinitionConfig,
    fn: WorkflowFunction<Input, Output>,
  ): WorkflowDefinition<Input, Output> {
    const { name } = config;

    if (this.registeredWorkflows.has(name)) {
      throw new Error(`Workflow "${name}" is already registered`);
    }

    const definition = new WorkflowDefinition<Input, Output>({
      backend: this.backend,
      name,
      fn,
    });

    this.registeredWorkflows.set(name, definition);

    return definition;
  }
}

//
// --- Workflow Definition
//

/**
 * Options for WorkflowDefinition.
 */
export interface WorkflowDefinitionOptions<Input, Output> {
  backend: Backend;
  name: string;
  fn: WorkflowFunction<Input, Output>;
}

/**
 * Config passed to `defineWorkflow()` when defining a workflow.
 */
export interface WorkflowDefinitionConfig {
  /**
   * The name of the workflow.
   */
  name: string;
}

/**
 * Represents a workflow definition. Returned from `client.defineWorkflow()`.
 */
export class WorkflowDefinition<Input, Output> {
  private backend: Backend;
  readonly name: string;
  readonly fn: WorkflowFunction<Input, Output>;

  constructor(options: WorkflowDefinitionOptions<Input, Output>) {
    this.backend = options.backend;
    this.name = options.name;
    this.fn = options.fn;
  }

  async run(
    input?: Input,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _options?: WorkflowRunOptions,
  ): Promise<WorkflowRunHandle<Output>> {
    // need to come back and support idempotency keys, scheduling, etc.
    const workflowRun = await this.backend.createWorkflowRun({
      workflowName: this.name,
      version: null,
      idempotencyKey: null,
      config: {},
      context: null,
      input: input ?? null,
      availableAt: null,
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
 * Used within a workflow handler to define steps by calling `step.run()`.
 */
export interface StepApi {
  run<Output>(
    config: StepFunctionConfig,
    fn: StepFunction<Output>,
  ): Promise<Output>;
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
//eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface WorkflowRunOptions {}

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
 * Represents a started workflow run and provides a helper to await its result.
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

  async result(): Promise<Output> {
    const start = Date.now();

    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    while (true) {
      // refresh the workflow run
      const latest = await this.backend.getWorkflowRun({
        workflowRunId: this.workflowRun.id,
      });

      if (!latest) {
        throw new Error(`Workflow run ${this.workflowRun.id} no longer exists`);
      }

      if (latest.status === "succeeded") {
        return latest.output as Output;
      }

      if (latest.status === "failed") {
        throw new Error(
          `Workflow ${this.workflowRun.workflowName} failed: ${JSON.stringify(latest.error)}`,
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
}
