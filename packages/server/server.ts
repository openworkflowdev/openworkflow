import {
  errorToResponse,
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
  SendSignalParams,
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
  /**
   * Maximum allowed request body size, in bytes. Requests exceeding this
   * limit are rejected with HTTP 413 before the handler is invoked.
   * Defaults to 1 MiB.
   */
  maxBodyBytes?: number;
  /**
   * Whether to attach Hono's request logger middleware.
   * Defaults to `false` so tests stay quiet; enable in production.
   */
  logRequests?: boolean;
  /**
   * Hook invoked for every unexpected server-side error. Intended for
   * structured logging or error reporting. Not called for expected 4xx
   * conditions (validation errors, `BackendError`, body-limit rejection).
   */
  onError?: ServerErrorHook;
  /**
   * If `true`, the `message` of unexpected `Error`s thrown from the backend
   * is included in the 500 response body. Useful during development and for
   * the shared test suite; dangerous in production because it can leak
   * implementation details (SQL fragments, connection URIs, etc.).
   * `BackendError` messages and validation errors are always exposed
   * regardless of this flag.
   * Defaults to `false` (production-safe).
   */
  exposeInternalErrors?: boolean;
}

const DEFAULT_MAX_BODY_BYTES = 1_048_576; // 1 MiB

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
  app.use(
    "*",
    bodyLimit({ maxSize: options.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES }),
  );
  app.onError((error, c) =>
    errorToResponse(error, c, {
      onError: options.onError,
      exposeInternalErrors: options.exposeInternalErrors,
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

// ---------------------------------------------------------------------------
// Verb dispatch — POST /...:{verb} and POST /.../:id:{verb}
//
// Hono doesn't support literal colons inside a route that also has a `:param`,
// so we capture `id:verb` as a single segment and dispatch via table. Shared
// between workflow-run and step-attempt instance methods.
// ---------------------------------------------------------------------------

type VerbHandler = (
  backend: Backend,
  id: string,
  c: Context,
) => Promise<Response>;

/**
 * Register `POST {pathPrefix}/:idVerb` with the given verb dispatch table.
 * @param app - Hono app instance
 * @param pathPrefix - Collection path (e.g. "/v0/workflow-runs")
 * @param backend - Backend implementation to proxy
 * @param verbs - Verb-name → handler map
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

// ---------------------------------------------------------------------------
// Route registration — Workflow Runs
// ---------------------------------------------------------------------------

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
      error: body.error,
      retryPolicy: body.retryPolicy,
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
      error: body.error,
      availableAt: new Date(body.availableAt),
    };
    const run = await backend.rescheduleWorkflowRunAfterFailedStepAttempt(
      params,
    );
    return c.json(run);
  },
  cancel: async (backend, id, c) => {
    const params: CancelWorkflowRunParams = { workflowRunId: id };
    const run = await backend.cancelWorkflowRun(params);
    return c.json(run);
  },
};

/**
 * Register workflow-run routes on the given app.
 * @param app - Hono app instance
 * @param backend - Backend implementation to proxy
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

// ---------------------------------------------------------------------------
// Route registration — Step Attempts
// ---------------------------------------------------------------------------

const STEP_ATTEMPT_VERBS: Readonly<Record<string, VerbHandler>> = {
  complete: async (backend, id, c) => {
    const body = await parseJsonBody(c, completeStepAttemptSchema);
    const params: CompleteStepAttemptParams = { stepAttemptId: id, ...body };
    const step = await backend.completeStepAttempt(params);
    return c.json(step);
  },
  fail: async (backend, id, c) => {
    const body = await parseJsonBody(c, failStepAttemptSchema);
    const params: FailStepAttemptParams = { stepAttemptId: id, ...body };
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
 * Register step-attempt routes on the given app.
 * @param app - Hono app instance
 * @param backend - Backend implementation to proxy
 */
function registerStepAttemptRoutes(app: Hono, backend: Backend): void {
  app.post("/v0/workflow-runs/:id/step-attempts", async (c) => {
    const body = await parseJsonBody(c, createStepAttemptSchema);
    const params: CreateStepAttemptParams = {
      workflowRunId: c.req.param("id"),
      ...body,
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
    return c.json(step);
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

// ---------------------------------------------------------------------------
// Route registration — Signals
// ---------------------------------------------------------------------------

/**
 * Register signal routes on the given app.
 * @param app - Hono app instance
 * @param backend - Backend implementation to proxy
 */
function registerSignalRoutes(app: Hono, backend: Backend): void {
  app.post("/v0/signals:send", async (c) => {
    const body = await parseJsonBody(c, sendSignalSchema);
    const params: SendSignalParams = body;
    const result = await backend.sendSignal(params);
    return c.json(result);
  });

  app.get("/v0/signal-deliveries/:stepAttemptId", async (c) => {
    const params: GetSignalDeliveryParams = {
      stepAttemptId: c.req.param("stepAttemptId"),
    };
    const result = await backend.getSignalDelivery(params);
    if (result === undefined) return c.body(null, 204);
    return c.json(result);
  });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Extract pagination query params from a Hono context.
 * @param c - Hono context
 * @returns Pagination params object
 */
function paginationQuery(c: Context): {
  limit?: number;
  after?: string;
  before?: string;
} {
  const { limit, after, before } = c.req.query();
  return {
    ...(limit ? { limit: Number(limit) } : {}),
    ...(after ? { after } : {}),
    ...(before ? { before } : {}),
  };
}

/**
 * Split a path segment of the form `id:verb` into its parts.
 * Returns `[id, verb]` or `null` if no colon is present, or if the verb is
 * empty (e.g. `id:`).
 * @param segment - The path segment to split
 * @returns Tuple of [id, verb] or null
 */
function splitIdVerb(segment: string): [id: string, verb: string] | null {
  const idx = segment.lastIndexOf(":");
  if (idx === -1) return null;
  const id = segment.slice(0, idx);
  const verb = segment.slice(idx + 1);
  if (!id || !verb) return null;
  return [id, verb];
}

// ---------------------------------------------------------------------------
// Node.js HTTP server
// ---------------------------------------------------------------------------

/**
 * Options for {@link serve}.
 */
export interface ServeOptions {
  /** Port to listen on (default: 3000). */
  port?: number;
  /**
   * Host/interface to bind to. Defaults to `127.0.0.1` so the server is not
   * unexpectedly exposed to the network. Set to `0.0.0.0` (or an explicit
   * interface) to accept remote connections.
   */
  hostname?: string;
}

/**
 * A handle for a running Node.js HTTP server. Call `close()` to stop
 * accepting new connections and wait for in-flight requests to complete.
 */
export interface ServeHandle {
  /** Gracefully close the server. Resolves when the socket is closed. */
  close(): Promise<void>;
}

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
  /* v8 ignore start -- infrastructure: starts a real Node.js HTTP server */
  const port = options.port ?? 3000;
  const hostname = options.hostname ?? "127.0.0.1";
  const httpServer = honoServe({
    fetch: (request) => server.fetch(request),
    port,
    hostname,
  });
  return {
    close: () =>
      new Promise<void>((resolve, reject) => {
        httpServer.close((err) => {
          if (err) {
            reject(err);
            return;
          }
          resolve();
        });
      }),
  };
  /* v8 ignore stop */
}
