import {
  errorToResponse,
  HttpValidationError,
  parseJsonBody,
  type ServerErrorHook,
} from "./errors.js";
import {
  claimWorkflowRunSchema,
  completeStepAttemptSchema,
  completeWorkflowRunSchema,
  createStepAttemptSchema,
  createWorkflowRunSchema,
  extendWorkflowRunLeaseSchema,
  failStepAttemptSchema,
  failWorkflowRunSchema,
  rescheduleWorkflowRunSchema,
  sendSignalSchema,
  setStepAttemptChildWorkflowRunSchema,
  sleepWorkflowRunSchema,
} from "./schemas.js";
import { serve as honoServe } from "@hono/node-server";
import type { Context } from "hono";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { logger } from "hono/logger";
import type {
  Backend,
  CancelWorkflowRunParams,
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
  RescheduleWorkflowRunAfterFailedStepAttemptParams,
  RetryPolicy,
  SerializedError,
  SetStepAttemptChildWorkflowRunParams,
  SleepWorkflowRunParams,
} from "openworkflow/internal";

/**
 * The OpenWorkflow HTTP server handle. Public API is the Web Standard `fetch`.
 */
export interface OpenWorkflowServer {
  /** Handle an incoming HTTP request (Web Standard fetch signature). */
  fetch(request: Request): Response | Promise<Response>;
}

/**
 * Options for {@link createServer}.
 */
export interface CreateServerOptions {
  /** Maximum request body size, in bytes. Defaults to 1 MiB. */
  maxBodyBytes?: number;
  /** Attach Hono's request logger middleware. Defaults to `false`. */
  logRequests?: boolean;
  /** Hook invoked for unexpected server-side errors (not validation/`BackendError`). */
  onError?: ServerErrorHook;
  /**
   * Include the message of unexpected backend errors in the 500 response.
   * Defaults to `false`; leaks implementation details if enabled in production.
   */
  exposeInternalErrors?: boolean;
}

/**
 * Create an OpenWorkflow HTTP server backed by the given Backend.
 * @param backend - Backend implementation to proxy
 * @param options - Server options
 * @returns Server with a Web Standard `fetch` handler
 */
export function createServer(
  backend: Backend,
  options: CreateServerOptions = {},
): OpenWorkflowServer {
  const app = new Hono();

  if (options.logRequests) {
    app.use("*", logger());
  }
  app.use("*", bodyLimit({ maxSize: options.maxBodyBytes ?? 1_048_576 }));
  app.onError((error, c) =>
    errorToResponse(error, c, {
      ...(options.onError === undefined ? {} : { onError: options.onError }),
      ...(options.exposeInternalErrors === undefined
        ? {}
        : { exposeInternalErrors: options.exposeInternalErrors }),
    }),
  );

  // cspell:ignore healthz readyz
  // /healthz is liveness (process is up). /readyz pings the backend so load
  // balancers don't route traffic to a replica whose DB connection is broken.
  app.get("/healthz", (c) => c.json({ status: "ok" }));
  app.get("/readyz", async (c) => {
    try {
      await backend.countWorkflowRuns();
    } catch (error) {
      options.onError?.(error, { path: c.req.path, method: c.req.method });
      return c.json({ status: "unavailable" }, 503);
    }
    return c.json({ status: "ok" });
  });

  registerWorkflowRunRoutes(app, backend);
  registerStepAttemptRoutes(app, backend);
  registerSignalRoutes(app, backend);

  return app;
}

// Hono doesn't support a literal `:` inside a route that also has a `:param`,
// so `POST /resource/:id:verb` is captured as a single segment and dispatched
// via the `VerbHandler` tables below.

type VerbHandler = (
  backend: Backend,
  id: string,
  c: Context,
) => Promise<Response>;

/**
 * Register `POST {pathPrefix}/:id:verb` routes that dispatch through `verbs`.
 * @param app - The Hono app to mount on
 * @param pathPrefix - Path prefix preceding the `:id:verb` segment
 * @param backend - Backend instance passed to each verb handler
 * @param verbs - Verb name → handler map
 */
function registerVerbRoute(
  app: Hono,
  pathPrefix: string,
  backend: Backend,
  verbs: Readonly<Record<string, VerbHandler>>,
): void {
  app.post(`${pathPrefix}/:idVerb`, async (c) => {
    const parts = splitIdVerb(c.req.param("idVerb"));
    if (!parts) return c.notFound();
    const [id, verb] = parts;
    const handler = verbs[verb];
    if (!handler) return c.notFound();
    return handler(backend, id, c);
  });
}

const WORKFLOW_RUN_VERBS: Readonly<Record<string, VerbHandler>> = {
  extendLease: async (backend, id, c) => {
    const body = await parseJsonBody(c, extendWorkflowRunLeaseSchema);
    const params: ExtendWorkflowRunLeaseParams = { workflowRunId: id, ...body };
    const run = await backend.extendWorkflowRunLease(params);
    return c.json(run);
  },
  sleep: async (backend, id, c) => {
    const body = await parseJsonBody(c, sleepWorkflowRunSchema);
    const params: SleepWorkflowRunParams = {
      workflowRunId: id,
      workerId: body.workerId,
      availableAt: new Date(body.availableAt),
    };
    const run = await backend.sleepWorkflowRun(params);
    return c.json(run);
  },
  complete: async (backend, id, c) => {
    const body = await parseJsonBody(c, completeWorkflowRunSchema);
    const params: CompleteWorkflowRunParams = { workflowRunId: id, ...body };
    const run = await backend.completeWorkflowRun(params);
    return c.json(run);
  },
  fail: async (backend, id, c) => {
    const body = await parseJsonBody(c, failWorkflowRunSchema);
    const params: FailWorkflowRunParams = {
      workflowRunId: id,
      workerId: body.workerId,
      error: toSerializedError(body.error),
      retryPolicy: body.retryPolicy as RetryPolicy,
      ...(body.attempts === undefined ? {} : { attempts: body.attempts }),
      ...(body.deadlineAt === undefined
        ? {}
        : { deadlineAt: body.deadlineAt ? new Date(body.deadlineAt) : null }),
    };
    const run = await backend.failWorkflowRun(params);
    return c.json(run);
  },
  reschedule: async (backend, id, c) => {
    const body = await parseJsonBody(c, rescheduleWorkflowRunSchema);
    const params: RescheduleWorkflowRunAfterFailedStepAttemptParams = {
      workflowRunId: id,
      workerId: body.workerId,
      error: toSerializedError(body.error),
      availableAt: new Date(body.availableAt),
    };
    const run =
      await backend.rescheduleWorkflowRunAfterFailedStepAttempt(params);
    return c.json(run);
  },
  cancel: async (backend, id, c) => {
    const params: CancelWorkflowRunParams = { workflowRunId: id };
    const run = await backend.cancelWorkflowRun(params);
    return c.json(run);
  },
};

/**
 * Mount workflow-run routes under `/v0/workflow-runs`.
 * @param app - The Hono app to mount on
 * @param backend - Backend instance to delegate to
 */
function registerWorkflowRunRoutes(app: Hono, backend: Backend): void {
  app.post("/v0/workflow-runs", async (c) => {
    const body = await parseJsonBody(c, createWorkflowRunSchema);
    const params: CreateWorkflowRunParams = {
      workflowName: body.workflowName,
      version: body.version,
      idempotencyKey: body.idempotencyKey,
      config: body.config,
      context: body.context,
      input: body.input,
      parentStepAttemptNamespaceId: body.parentStepAttemptNamespaceId,
      parentStepAttemptId: body.parentStepAttemptId,
      availableAt: body.availableAt ? new Date(body.availableAt) : null,
      deadlineAt: body.deadlineAt ? new Date(body.deadlineAt) : null,
    };
    const run = await backend.createWorkflowRun(params);
    return c.json(run, 201);
  });

  app.get("/v0/workflow-runs/:id", async (c) => {
    const params: GetWorkflowRunParams = { workflowRunId: c.req.param("id") };
    const run = await backend.getWorkflowRun(params);
    if (!run) {
      return c.json({ error: { message: "Workflow run not found" } }, 404);
    }
    return c.json(run);
  });

  app.get("/v0/workflow-runs", async (c) => {
    const params: ListWorkflowRunsParams = paginationQuery(c);
    const result = await backend.listWorkflowRuns(params);
    return c.json(result);
  });

  app.get("/v0/workflow-runs:count", async (c) => {
    const counts = await backend.countWorkflowRuns();
    return c.json(counts);
  });

  app.post("/v0/workflow-runs:claim", async (c) => {
    const body = await parseJsonBody(c, claimWorkflowRunSchema);
    const run = await backend.claimWorkflowRun(body);
    if (!run) return c.body(null, 204);
    return c.json(run);
  });

  registerVerbRoute(app, "/v0/workflow-runs", backend, WORKFLOW_RUN_VERBS);
}

const STEP_ATTEMPT_VERBS: Readonly<Record<string, VerbHandler>> = {
  complete: async (backend, id, c) => {
    const body = await parseJsonBody(c, completeStepAttemptSchema);
    const params: CompleteStepAttemptParams = { stepAttemptId: id, ...body };
    const step = await backend.completeStepAttempt(params);
    return c.json(step);
  },
  fail: async (backend, id, c) => {
    const body = await parseJsonBody(c, failStepAttemptSchema);
    const params: FailStepAttemptParams = {
      stepAttemptId: id,
      workflowRunId: body.workflowRunId,
      workerId: body.workerId,
      error: toSerializedError(body.error),
    };
    const step = await backend.failStepAttempt(params);
    return c.json(step);
  },
  setChildWorkflowRun: async (backend, id, c) => {
    const body = await parseJsonBody(c, setStepAttemptChildWorkflowRunSchema);
    const params: SetStepAttemptChildWorkflowRunParams = {
      stepAttemptId: id,
      ...body,
    };
    const step = await backend.setStepAttemptChildWorkflowRun(params);
    return c.json(step);
  },
};

/**
 * Mount step-attempt routes under `/v0/workflow-runs/:id/step-attempts` and `/v0/step-attempts`.
 * @param app - The Hono app to mount on
 * @param backend - Backend instance to delegate to
 */
function registerStepAttemptRoutes(app: Hono, backend: Backend): void {
  app.post("/v0/workflow-runs/:id/step-attempts", async (c) => {
    const body = await parseJsonBody(c, createStepAttemptSchema);
    const params: CreateStepAttemptParams = {
      workflowRunId: c.req.param("id"),
      workerId: body.workerId,
      stepName: body.stepName,
      kind: body.kind,
      config: body.config,
      context: body.context,
    };
    const step = await backend.createStepAttempt(params);
    return c.json(step, 201);
  });

  app.get("/v0/step-attempts/:id", async (c) => {
    const params: GetStepAttemptParams = { stepAttemptId: c.req.param("id") };
    const step = await backend.getStepAttempt(params);
    if (!step) {
      return c.json({ error: { message: "Step attempt not found" } }, 404);
    }
    return c.json(step as unknown);
  });

  app.get("/v0/workflow-runs/:id/step-attempts", async (c) => {
    const params: ListStepAttemptsParams = {
      workflowRunId: c.req.param("id"),
      ...paginationQuery(c),
    };
    const result = await backend.listStepAttempts(params);
    return c.json(result);
  });

  registerVerbRoute(app, "/v0/step-attempts", backend, STEP_ATTEMPT_VERBS);
}

/**
 * Mount signal routes under `/v0/signals` and `/v0/signal-deliveries`.
 * @param app - The Hono app to mount on
 * @param backend - Backend instance to delegate to
 */
function registerSignalRoutes(app: Hono, backend: Backend): void {
  app.post("/v0/signals:send", async (c) => {
    const body = await parseJsonBody(c, sendSignalSchema);
    const result = await backend.sendSignal(body);
    return c.json(result);
  });

  app.get("/v0/signal-deliveries/:stepAttemptId", async (c) => {
    const params: GetSignalDeliveryParams = {
      stepAttemptId: c.req.param("stepAttemptId"),
    };
    const result = await backend.getSignalDelivery(params);
    if (result === undefined) return c.body(null, 204);
    return c.json(result as unknown);
  });
}

/**
 * Extract pagination query params.
 * @param c - Hono context
 * @returns Pagination params
 * @throws {HttpValidationError} On invalid `limit` or conflicting `after`/`before`.
 */
function paginationQuery(c: Context): {
  limit?: number;
  after?: string;
  before?: string;
} {
  const { limit, after, before } = c.req.query();
  if (after && before) {
    throw new HttpValidationError(
      "Query parameters `after` and `before` are mutually exclusive.",
    );
  }
  const result: { limit?: number; after?: string; before?: string } = {};
  if (limit) {
    const parsed = Number(limit);
    if (!Number.isInteger(parsed) || parsed <= 0) {
      throw new HttpValidationError(
        "Query parameter `limit` must be a positive integer.",
      );
    }
    result.limit = parsed;
  }
  if (after) result.after = after;
  if (before) result.before = before;
  return result;
}

/**
 * Drop undefined name/stack to satisfy `exactOptionalPropertyTypes`.
 * @param err - Validated error payload from a request body
 * @param err.name - Optional error name
 * @param err.message - Error message
 * @param err.stack - Optional stack trace
 * @returns A {@link SerializedError} with no `undefined` properties
 */
function toSerializedError(err: {
  name?: string | undefined;
  message: string;
  stack?: string | undefined;
}): SerializedError {
  return {
    message: err.message,
    ...(err.name === undefined ? {} : { name: err.name }),
    ...(err.stack === undefined ? {} : { stack: err.stack }),
  };
}

/**
 * Split an `{id}:{verb}` path segment; returns null if either side is empty.
 * @param segment - Path segment of the form `id:verb`
 * @returns A `[id, verb]` tuple, or null if the segment is malformed
 */
function splitIdVerb(segment: string): [id: string, verb: string] | null {
  const idx = segment.lastIndexOf(":");
  if (idx === -1) return null;
  const id = segment.slice(0, idx);
  const verb = segment.slice(idx + 1);
  if (!id || !verb) return null;
  return [id, verb];
}

/**
 * Options for {@link serve}.
 */
export interface ServeOptions {
  /** Port to listen on (default: 3000). */
  port?: number;
  /** Host/interface to bind to (default: `127.0.0.1`). */
  hostname?: string;
}

/**
 * Handle for a running Node.js HTTP server.
 */
export interface ServeHandle {
  /** Gracefully close the server. Resolves when the socket is closed. */
  close(): Promise<void>;
}

/* v8 ignore start -- infrastructure: starts a real Node.js HTTP server */
/**
 * Start a Node.js HTTP server for the given OpenWorkflow server.
 * @param server - OpenWorkflow server instance
 * @param options - Server options
 * @returns A handle for stopping the server gracefully
 */
export function serve(
  server: OpenWorkflowServer,
  options: ServeOptions = {},
): ServeHandle {
  const httpServer = honoServe({
    fetch: (request) => server.fetch(request),
    port: options.port ?? 3000,
    hostname: options.hostname ?? "127.0.0.1",
  });
  return {
    close: () =>
      new Promise<void>((resolve, reject) => {
        httpServer.close((err) => {
          if (err) reject(err);
          else resolve();
        });
      }),
  };
}
/* v8 ignore stop */
