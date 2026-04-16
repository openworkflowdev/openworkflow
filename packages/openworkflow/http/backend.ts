import type {
  Backend,
  CancelWorkflowRunParams,
  ClaimWorkflowRunParams,
  CompleteStepAttemptParams,
  CompleteWorkflowRunParams,
  CreateStepAttemptParams,
  CreateWorkflowRunParams,
  ExtendWorkflowRunLeaseParams,
  FailStepAttemptParams,
  FailWorkflowRunParams,
  GetSignalDeliveryParams,
  GetStepAttemptParams,
  GetWorkflowRunParams,
  ListStepAttemptsParams,
  ListWorkflowRunsParams,
  PaginatedResponse,
  RescheduleWorkflowRunAfterFailedStepAttemptParams,
  SendSignalParams,
  SendSignalResult,
  SetStepAttemptChildWorkflowRunParams,
  SleepWorkflowRunParams,
  WorkflowRunCounts,
} from "../core/backend.js";
import { BackendError, isBackendErrorCode } from "../core/error.js";
import type { JsonValue } from "../core/json.js";
import type { StepAttempt } from "../core/step-attempt.js";
import type { WorkflowRun } from "../core/workflow-run.js";

// ---------------------------------------------------------------------------
// Date field transforms
// ---------------------------------------------------------------------------

const WORKFLOW_RUN_DATE_FIELDS = [
  "availableAt",
  "deadlineAt",
  "startedAt",
  "finishedAt",
  "createdAt",
  "updatedAt",
] as const;

const STEP_ATTEMPT_DATE_FIELDS = [
  "startedAt",
  "finishedAt",
  "createdAt",
  "updatedAt",
] as const;

/**
 * Parse date strings into Date objects in-place.
 * @param obj - Object with potential date string fields
 * @param fields - Field names to check and convert
 * @returns The mutated object typed as T
 */
function parseDates(
  obj: Record<string, unknown>,
  fields: readonly string[],
): Record<string, unknown> {
  for (const field of fields) {
    const value = obj[field];
    if (typeof value === "string") {
      obj[field] = new Date(value);
    }
  }
  return obj;
}

/**
 * Parse raw JSON into a WorkflowRun with proper Date fields.
 * @param raw - Raw JSON object from the server
 * @returns Parsed WorkflowRun
 */
function parseWorkflowRun(raw: Record<string, unknown>): WorkflowRun {
  return parseDates(raw, WORKFLOW_RUN_DATE_FIELDS) as unknown as WorkflowRun;
}

/**
 * Parse raw JSON into a StepAttempt with proper Date fields.
 * @param raw - Raw JSON object from the server
 * @returns Parsed StepAttempt
 */
function parseStepAttempt(raw: Record<string, unknown>): StepAttempt {
  return parseDates(raw, STEP_ATTEMPT_DATE_FIELDS) as unknown as StepAttempt;
}

/**
 * Build a query string from optional pagination params.
 * @param params - Pagination parameters
 * @param params.limit - Maximum number of items
 * @param params.after - Cursor for forward pagination
 * @param params.before - Cursor for backward pagination
 * @returns Query string (including leading ?) or empty string
 */
function buildPaginationQuery(params: {
  limit?: number;
  after?: string;
  before?: string;
}): string {
  const search = new URLSearchParams();
  if (params.limit !== undefined) search.set("limit", String(params.limit));
  if (params.after) search.set("after", params.after);
  if (params.before) search.set("before", params.before);
  const qs = search.toString();
  return qs ? `?${qs}` : "";
}

/**
 * Parse a paginated JSON response body.
 * @param res - Fetch Response
 * @param parseItem - Function to transform each item
 * @returns Parsed PaginatedResponse
 */
async function parsePaginatedResponse<T>(
  res: globalThis.Response,
  parseItem: (raw: Record<string, unknown>) => T,
): Promise<PaginatedResponse<T>> {
  const body = (await res.json()) as {
    data: Record<string, unknown>[];
    pagination: { next: string | null; prev: string | null };
  };
  return {
    data: body.data.map((r) => parseItem(r)),
    pagination: body.pagination,
  };
}

// ---------------------------------------------------------------------------
// BackendHttp
// ---------------------------------------------------------------------------

/**
 * Options for the HTTP backend.
 */
export interface BackendHttpOptions {
  /** Base URL of the OpenWorkflow server (e.g. "http://localhost:3000"). */
  url: string;
  /**
   * Custom fetch implementation. Defaults to `globalThis.fetch`.
   * Useful for testing (in-process server) or adding middleware (auth headers).
   */
  fetch?: typeof globalThis.fetch;
}

/**
 * Backend implementation that communicates with an OpenWorkflow HTTP server.
 * Implements the full Backend interface over HTTP.
 */
export class BackendHttp implements Backend {
  private readonly baseUrl: string;
  private readonly _fetch: typeof globalThis.fetch;

  constructor(options: BackendHttpOptions) {
    let url = options.url;
    while (url.endsWith("/")) {
      url = url.slice(0, -1);
    }
    this.baseUrl = url;
    this._fetch = options.fetch ?? globalThis.fetch;
  }

  // -----------------------------------------------------------------------
  // Workflow Runs — standard methods
  // -----------------------------------------------------------------------

  async createWorkflowRun(
    params: Readonly<CreateWorkflowRunParams>,
  ): Promise<WorkflowRun> {
    return this.postWorkflowRun("/v0/workflow-runs", {
      workflowName: params.workflowName,
      version: params.version,
      idempotencyKey: params.idempotencyKey,
      config: params.config,
      context: params.context,
      input: params.input,
      parentStepAttemptNamespaceId: params.parentStepAttemptNamespaceId,
      parentStepAttemptId: params.parentStepAttemptId,
      availableAt: params.availableAt?.toISOString() ?? null,
      deadlineAt: params.deadlineAt?.toISOString() ?? null,
    });
  }

  async getWorkflowRun(
    params: Readonly<GetWorkflowRunParams>,
  ): Promise<WorkflowRun | null> {
    const res = await this.fetch(`/v0/workflow-runs/${params.workflowRunId}`);
    if (res.status === 404) return null;
    await this.assertOk(res);
    return parseWorkflowRun((await res.json()) as Record<string, unknown>);
  }

  async listWorkflowRuns(
    params: Readonly<ListWorkflowRunsParams>,
  ): Promise<PaginatedResponse<WorkflowRun>> {
    const path = `/v0/workflow-runs${buildPaginationQuery(params)}`;
    const res = await this.fetch(path);
    await this.assertOk(res);
    return parsePaginatedResponse(res, parseWorkflowRun);
  }

  async countWorkflowRuns(): Promise<WorkflowRunCounts> {
    const res = await this.fetch("/v0/workflow-runs:count");
    await this.assertOk(res);
    return (await res.json()) as WorkflowRunCounts;
  }

  async claimWorkflowRun(
    params: Readonly<ClaimWorkflowRunParams>,
  ): Promise<WorkflowRun | null> {
    const res = await this.fetchPost("/v0/workflow-runs:claim", params);
    if (res.status === 204) return null;
    await this.assertOk(res);
    return parseWorkflowRun((await res.json()) as Record<string, unknown>);
  }

  async extendWorkflowRunLease(
    params: Readonly<ExtendWorkflowRunLeaseParams>,
  ): Promise<WorkflowRun> {
    return this.postWorkflowRun(
      `/v0/workflow-runs/${params.workflowRunId}:extendLease`,
      {
        workerId: params.workerId,
        leaseDurationMs: params.leaseDurationMs,
      },
    );
  }

  async sleepWorkflowRun(
    params: Readonly<SleepWorkflowRunParams>,
  ): Promise<WorkflowRun> {
    return this.postWorkflowRun(
      `/v0/workflow-runs/${params.workflowRunId}:sleep`,
      {
        workerId: params.workerId,
        availableAt: params.availableAt.toISOString(),
      },
    );
  }

  async completeWorkflowRun(
    params: Readonly<CompleteWorkflowRunParams>,
  ): Promise<WorkflowRun> {
    return this.postWorkflowRun(
      `/v0/workflow-runs/${params.workflowRunId}:complete`,
      {
        workerId: params.workerId,
        output: params.output,
      },
    );
  }

  async failWorkflowRun(
    params: Readonly<FailWorkflowRunParams>,
  ): Promise<WorkflowRun> {
    return this.postWorkflowRun(
      `/v0/workflow-runs/${params.workflowRunId}:fail`,
      {
        workerId: params.workerId,
        error: params.error,
        retryPolicy: params.retryPolicy,
        ...(params.attempts === undefined ? {} : { attempts: params.attempts }),
        ...(params.deadlineAt === undefined
          ? {}
          : { deadlineAt: params.deadlineAt?.toISOString() ?? null }),
      },
    );
  }

  async rescheduleWorkflowRunAfterFailedStepAttempt(
    params: Readonly<RescheduleWorkflowRunAfterFailedStepAttemptParams>,
  ): Promise<WorkflowRun> {
    return this.postWorkflowRun(
      `/v0/workflow-runs/${params.workflowRunId}:reschedule`,
      {
        workerId: params.workerId,
        error: params.error,
        availableAt: params.availableAt.toISOString(),
      },
    );
  }

  async cancelWorkflowRun(
    params: Readonly<CancelWorkflowRunParams>,
  ): Promise<WorkflowRun> {
    return this.postWorkflowRun(
      `/v0/workflow-runs/${params.workflowRunId}:cancel`,
      {},
    );
  }

  // -----------------------------------------------------------------------
  // Step Attempts
  // -----------------------------------------------------------------------

  async createStepAttempt(
    params: Readonly<CreateStepAttemptParams>,
  ): Promise<StepAttempt> {
    return this.postStepAttempt(
      `/v0/workflow-runs/${params.workflowRunId}/step-attempts`,
      {
        workerId: params.workerId,
        stepName: params.stepName,
        kind: params.kind,
        config: params.config,
        context: params.context,
      },
    );
  }

  async getStepAttempt(
    params: Readonly<GetStepAttemptParams>,
  ): Promise<StepAttempt | null> {
    const res = await this.fetch(`/v0/step-attempts/${params.stepAttemptId}`);
    if (res.status === 404) return null;
    await this.assertOk(res);
    return parseStepAttempt((await res.json()) as Record<string, unknown>);
  }

  async listStepAttempts(
    params: Readonly<ListStepAttemptsParams>,
  ): Promise<PaginatedResponse<StepAttempt>> {
    const path = `/v0/workflow-runs/${params.workflowRunId}/step-attempts${buildPaginationQuery(params)}`;
    const res = await this.fetch(path);
    await this.assertOk(res);
    return parsePaginatedResponse(res, parseStepAttempt);
  }

  async completeStepAttempt(
    params: Readonly<CompleteStepAttemptParams>,
  ): Promise<StepAttempt> {
    return this.postStepAttempt(
      `/v0/step-attempts/${params.stepAttemptId}:complete`,
      {
        workflowRunId: params.workflowRunId,
        workerId: params.workerId,
        output: params.output,
      },
    );
  }

  async failStepAttempt(
    params: Readonly<FailStepAttemptParams>,
  ): Promise<StepAttempt> {
    return this.postStepAttempt(
      `/v0/step-attempts/${params.stepAttemptId}:fail`,
      {
        workflowRunId: params.workflowRunId,
        workerId: params.workerId,
        error: params.error,
      },
    );
  }

  async setStepAttemptChildWorkflowRun(
    params: Readonly<SetStepAttemptChildWorkflowRunParams>,
  ): Promise<StepAttempt> {
    return this.postStepAttempt(
      `/v0/step-attempts/${params.stepAttemptId}:setChildWorkflowRun`,
      {
        workflowRunId: params.workflowRunId,
        workerId: params.workerId,
        childWorkflowRunNamespaceId: params.childWorkflowRunNamespaceId,
        childWorkflowRunId: params.childWorkflowRunId,
      },
    );
  }

  // -----------------------------------------------------------------------
  // Signals
  // -----------------------------------------------------------------------

  async sendSignal(
    params: Readonly<SendSignalParams>,
  ): Promise<SendSignalResult> {
    const res = await this.fetchPost("/v0/signals:send", params);
    await this.assertOk(res);
    return (await res.json()) as SendSignalResult;
  }

  async getSignalDelivery(
    params: Readonly<GetSignalDeliveryParams>,
  ): Promise<JsonValue | undefined> {
    const res = await this.fetch(
      `/v0/signal-deliveries/${params.stepAttemptId}`,
    );
    if (res.status === 204) return undefined;
    await this.assertOk(res);
    return (await res.json()) as JsonValue;
  }

  // -----------------------------------------------------------------------
  // Lifecycle
  // -----------------------------------------------------------------------

  async stop(): Promise<void> {
    // No-op — HTTP client has no persistent connection to close.
  }

  // -----------------------------------------------------------------------
  // Internal helpers
  // -----------------------------------------------------------------------

  private async fetch(path: string): Promise<Response> {
    return this._fetch(`${this.baseUrl}${path}`);
  }

  private async fetchPost(
    path: string,
    body: Record<string, unknown>,
  ): Promise<Response> {
    return this._fetch(`${this.baseUrl}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  private async postWorkflowRun(
    path: string,
    body: Record<string, unknown>,
  ): Promise<WorkflowRun> {
    const res = await this.fetchPost(path, body);
    await this.assertOk(res);
    return parseWorkflowRun((await res.json()) as Record<string, unknown>);
  }

  private async postStepAttempt(
    path: string,
    body: Record<string, unknown>,
  ): Promise<StepAttempt> {
    const res = await this.fetchPost(path, body);
    await this.assertOk(res);
    return parseStepAttempt((await res.json()) as Record<string, unknown>);
  }

  private async assertOk(res: Response): Promise<void> {
    if (res.ok) return;
    const body = await res.text();
    let message = body;
    let code: string | undefined;
    try {
      const parsed = JSON.parse(body) as {
        error?: { message?: string; code?: string };
      };
      if (parsed.error?.message) message = parsed.error.message;
      code = parsed.error?.code;
    } catch {
      // body was not JSON; fall through with the raw text as the message
    }
    if (code !== undefined && isBackendErrorCode(code)) {
      throw new BackendError(code, message);
    }
    throw new Error(message);
  }
}
